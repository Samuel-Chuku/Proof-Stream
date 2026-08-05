// Dry run for reclaiming USDC left in finished demo runs (§5.10). Read-only.
//
// Three separate pots, three different mechanisms:
//   1. the WorkStream's own balance  -> closeMilestone() refunds it to employer
//   2. the contributor fixture wallet -> plain ERC-20 transfer (pnpm sweep)
//   3. the vesting vault fixture      -> plain ERC-20 transfer (pnpm sweep)
//
// THE TRAP THIS CHECKS FOR: on Arc the native gas balance and the ERC-20 USDC
// balance are the SAME money, exposed twice (18dp vs 6dp, 1e12 apart), so a
// sweep must leave enough behind to pay for itself. Worse, the node debits
// `gasLimit * maxFeePerGas` before executing and defaults that to the BLOCK gas
// limit — 0.87 USDC on Arc, versus 0.00143 for the transfer itself. A flat
// buffer under that reverts with "ERC20: transfer amount exceeds balance",
// which reads like a balance bug. This prices the real reserve instead.
import { EXPLORER_URL, USDC_ADDRESS, formatUsdc, parseUsdc } from '@proofstream/config';
import { createPublicClient, erc20Abi, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arcTestnet } from 'viem/chains';

type Check = { name: string; ok: boolean; detail: string };
const checks: Check[] = [];
const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

async function withRetry<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (err) {
      const rateLimited = String((err as Error).message).includes('request limit reached');
      if (!rateLimited || i >= attempts - 1) throw err;
      await new Promise((r) => setTimeout(r, 500 * 2 ** i));
    }
  }
}

/// 18dp native : 6dp ERC-20 — the same USDC at two scales.
const NATIVE_PER_USDC = 1_000_000_000_000n;

/// Kept for wallets that must keep WORKING after the sweep. The contributor
/// sends withdraw() transactions and pays gas in this same USDC, so draining it
/// to dust bricks the payout leg. Must match sweep.ts.
const OPERATING_RESERVE: Record<string, bigint> = {
  contributor: parseUsdc('2'),
  vault: 0n,
};

/// Must match sweep.ts. Duplicated rather than imported: no file in scripts/
/// may import another (this one runs its checks and exits at import time).
function reserveInUsdc(wei: bigint): bigint {
  return wei / NATIVE_PER_USDC + 1n;
}

const WORK_STREAM_ABI = [
  { type: 'function', name: 'withdrawable', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'milestoneClosed', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'milestoneEndsAt', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'activatedAt', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint64' }] },
  { type: 'function', name: 'employer', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'closeMilestone', stateMutability: 'nonpayable', inputs: [], outputs: [] },
] as const;

const requiredVars = ['ARC_RPC_URL', 'DEPLOYER_ADDRESS', 'WORKSTREAM_ADDRESS'] as const;
let envOk = true;
for (const name of requiredVars) {
  const present = Boolean(process.env[name]);
  if (!present) envOk = false;
  add(`env ${name}`, present, present ? 'set' : 'MISSING');
}
if (!envOk) report();

const workStream = process.env.WORKSTREAM_ADDRESS as `0x${string}`;
const employer = process.env.DEPLOYER_ADDRESS as `0x${string}`;
const client = createPublicClient({ chain: arcTestnet, transport: http(process.env.ARC_RPC_URL) });

const read = <T>(functionName: string) =>
  withRetry(
    () => client.readContract({ address: workStream, abi: WORK_STREAM_ABI, functionName: functionName as never }) as Promise<T>,
  );

const usdcOf = (who: `0x${string}`) =>
  withRetry(() => client.readContract({ address: USDC_ADDRESS, abi: erc20Abi, functionName: 'balanceOf', args: [who] }));

let total = 0n;
/// Set inside the checks; report() uses it to decide which commands to print.
let contractRefund = 0n;

try {
  const chainId = await withRetry(() => client.getChainId());
  add('chain is Arc testnet', chainId === 5042002, `chain id ${chainId}`);

  // ---- pot 1: the contract ------------------------------------------------
  const onChainEmployer = await read<`0x${string}`>('employer');
  const isEmployer = onChainEmployer.toLowerCase() === employer.toLowerCase();
  add('DEPLOYER_ADDRESS is the employer', isEmployer, isEmployer ? employer : `contract says ${onChainEmployer}`);

  const closed = await read<boolean>('milestoneClosed');
  const activatedAt = await read<bigint>('activatedAt');
  const endsAt = await read<bigint>('milestoneEndsAt');
  const now = BigInt(Math.floor(Date.now() / 1000));
  // closeMilestone reverts with MilestoneStillRunning unless the duration has
  // run out (or the milestone never started). That is deliberate: an employer
  // must not be able to close mid-work and reclaim earned money.
  const runOut = activatedAt === 0n || now >= endsAt;

  const owed = await read<bigint>('withdrawable');
  add('nothing still owed to contributor', owed === 0n, `${formatUsdc(owed)} USDC withdrawable`);

  const held = await usdcOf(workStream);
  const refund = closed ? 0n : held > owed ? held - owed : 0n;
  contractRefund = refund;
  total += refund;

  // An already-settled contract is the DONE state, not a failure — this
  // preflight has to stay green after step 1 so the sweep can still be run.
  // The only genuinely blocking case is money sitting in a milestone that has
  // not run its course: closing it would revert.
  const stuck = !closed && !runOut && held > owed;
  add(
    'contract pot',
    !stuck,
    closed
      ? 'already closed and refunded — nothing left to reclaim'
      : refund > 0n
        ? `${formatUsdc(refund)} USDC refundable via closeMilestone()`
        : stuck
          ? `${formatUsdc(held - owed)} USDC locked for another ${Number(endsAt - now)}s — closing now would revert`
          : 'open, but holds nothing to refund',
  );

  if (!closed && runOut && refund > 0n) {
    try {
      await withRetry(() =>
        client.simulateContract({ address: workStream, abi: WORK_STREAM_ABI, functionName: 'closeMilestone', account: employer }),
      );
      add('closeMilestone WOULD succeed (simulated)', true, 'not sent');
    } catch (err) {
      const msg = (err as Error).message;
      const precompile = /StackUnderflow|blocklist|0x1800/i.test(msg);
      add(
        precompile ? 'closeMilestone simulation (skipped — Arc precompile)' : 'closeMilestone simulates cleanly',
        precompile,
        msg.split('\n')[0].slice(0, 90),
      );
    }
  }

  // ---- pots 2 and 3: the fixture wallets ----------------------------------
  // Contributor only. The vault wallet was dropped when the 15% split was
  // removed from the contract — nothing credits it any more.
  for (const [label, keyVar] of [['contributor', 'CONTRIBUTOR_PRIVATE_KEY']] as const) {
    const key = process.env[keyVar];
    if (!key) {
      add(`${label} key present`, false, `${keyVar} not set — that wallet's USDC cannot be swept`);
      continue;
    }

    const account = privateKeyToAccount(key as `0x${string}`);
    const balance = await usdcOf(account.address);

    // Price it exactly as sweep.ts will. A flat buffer is not safe here: with
    // no explicit gas limit the node reserves BLOCK gasLimit * maxFeePerGas
    // (measured: 0.87 USDC) out of the same balance, which is what reverted
    // the first attempt with "ERC20: transfer amount exceeds balance".
    const fees = await withRetry(() => client.estimateFeesPerGas());
    const maxFeePerGas = fees.maxFeePerGas ?? 0n;
    const probeGas = await withRetry(() =>
      client.estimateContractGas({
        address: USDC_ADDRESS,
        abi: erc20Abi,
        functionName: 'transfer',
        args: [employer, 1n],
        account,
      }),
    );
    const gas = (probeGas * 3n) / 2n;
    const reserve = reserveInUsdc(gas * maxFeePerGas * 2n) + (OPERATING_RESERVE[label] ?? 0n);
    const sweepable = balance > reserve ? balance - reserve : 0n;
    total += sweepable;
    add(
      `${label} sweepable`,
      sweepable > 0n,
      sweepable > 0n
        ? `${formatUsdc(sweepable)} USDC of ${formatUsdc(balance)} (reserve ${formatUsdc(reserve)}, gas ${gas})`
        : `${formatUsdc(balance)} USDC — under the ${formatUsdc(reserve)} reserve, nothing to take`,
    );
  }

  const before = await usdcOf(employer);
  console.log(`\nemployer holds ${formatUsdc(before)} USDC now`);
  console.log(`reclaimable    ${formatUsdc(total)} USDC`);
  console.log(`after          ${formatUsdc(before + total)} USDC\n`);
  console.log(`contract ${EXPLORER_URL}/address/${workStream}\n`);
} catch (err) {
  add('chain readable', false, (err as Error).message.split('\n')[0]);
}

report();

function report(): never {
  let allOk = true;
  for (const c of checks) {
    if (!c.ok) allOk = false;
    console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name.padEnd(44)} ${c.detail}`);
  }
  if (allOk) {
    console.log('\nALL GREEN — nothing has moved. Run:\n');
    if (contractRefund > 0n) {
      console.log(`  # 1. refund the contract's unspent budget to the employer`);
      console.log(`  bash -c 'set -a; source .env; set +a
  cast send "$WORKSTREAM_ADDRESS" "closeMilestone()" \\
    --rpc-url "$ARC_RPC_URL" --account proofstream-deployer'`);
      console.log(`\n  # 2. sweep the fixture wallets back to the deployer`);
    } else {
      console.log(`  # the contract is already settled; only the wallets are left`);
    }
    console.log(`  pnpm sweep\n`);
  } else {
    console.log('\nNOT READY — fix the FAIL lines first.');
  }
  process.exit(allOk ? 0 : 1);
}
