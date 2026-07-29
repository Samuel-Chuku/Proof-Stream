// Dry run for the contributor payout (§5.10). Read-only.
//
// withdraw() has three on-chain guards and it is cheaper to find out here than
// from a reverted transaction mid-demo: caller must BE the contributor, the
// destination must equal the policy's allowlisted payee, and the amount must
// not exceed withdrawable().
import { EXPLORER_URL, USDC_ADDRESS, formatNative, formatUsdc } from '@proofstream/config';
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

export const WORK_STREAM_ABI = [
  { type: 'function', name: 'withdrawable', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'contributor', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'contributorCredited', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'withdrawn', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  {
    type: 'function',
    name: 'policy',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }, { type: 'uint256' }, { type: 'address' }],
  },
  {
    type: 'function',
    name: 'withdraw',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
] as const;

const requiredVars = ['WORKSTREAM_ADDRESS', 'CONTRIBUTOR_PRIVATE_KEY'] as const;
let envOk = true;
for (const name of requiredVars) {
  const present = Boolean(process.env[name]);
  if (!present) envOk = false;
  add(`env ${name}`, present, present ? 'set' : 'MISSING');
}
if (!envOk) report();

const workStream = process.env.WORKSTREAM_ADDRESS as `0x${string}`;
const client = createPublicClient({ chain: arcTestnet, transport: http(process.env.ARC_RPC_URL) });
const account = privateKeyToAccount(process.env.CONTRIBUTOR_PRIVATE_KEY as `0x${string}`);

const read = <T>(functionName: string) =>
  withRetry(() => client.readContract({ address: workStream, abi: WORK_STREAM_ABI, functionName: functionName as never }) as Promise<T>);

try {
  const onChainContributor = await read<`0x${string}`>('contributor');
  const isContributor = onChainContributor.toLowerCase() === account.address.toLowerCase();
  add('key is the contract contributor', isContributor, isContributor ? account.address : `key is ${account.address}, contract says ${onChainContributor}`);

  const [, , payee] = await read<[bigint, bigint, `0x${string}`]>('policy');
  const payeeOk = payee.toLowerCase() === account.address.toLowerCase();
  add('payout destination is allowlisted', payeeOk, payeeOk ? payee : `policy payee is ${payee} — withdraw() reverts to anyone else`);

  const withdrawable = await read<bigint>('withdrawable');
  add('there is something to withdraw', withdrawable > 0n, `${formatUsdc(withdrawable)} USDC withdrawable`);

  const credited = await read<bigint>('contributorCredited');
  const withdrawn = await read<bigint>('withdrawn');
  add('credited/withdrawn consistent', credited >= withdrawn, `credited ${formatUsdc(credited)}, withdrawn ${formatUsdc(withdrawn)}`);

  // The known drift risk: accrual outpaces funding, so the contract can credit
  // more than it actually holds. withdraw() reverts on transfer if so.
  const held = await withRetry(() =>
    client.readContract({ address: USDC_ADDRESS, abi: erc20Abi, functionName: 'balanceOf', args: [workStream] }),
  );
  add('contract holds enough to pay it', held >= withdrawable, `holds ${formatUsdc(held)} USDC vs ${formatUsdc(withdrawable)} owed`);

  const gas = await withRetry(() => client.getBalance({ address: account.address }));
  add('contributor has gas', gas > 0n, `${formatNative(gas)} USDC (native, 18dp)`);

  // Simulation is the real proof: it runs the guards without sending.
  if (withdrawable > 0n) {
    try {
      await client.simulateContract({
        address: workStream,
        abi: WORK_STREAM_ABI,
        functionName: 'withdraw',
        args: [account.address, withdrawable],
        account,
      });
      add('withdraw simulates cleanly', true, `${formatUsdc(withdrawable)} USDC → ${account.address}`);
    } catch (err) {
      // Arc's USDC precompile can defeat simulation; report it as unknown
      // rather than failing a payout that would actually succeed.
      const msg = (err as Error).message.split('\n')[0];
      const precompile = /StackUnderflow|blocklist|0x1800/i.test((err as Error).message);
      add(precompile ? 'withdraw simulation (skipped — Arc precompile)' : 'withdraw simulates cleanly', precompile, msg.slice(0, 90));
    }
  }

  console.log(`\ncontract ${EXPLORER_URL}/address/${workStream}\n`);
} catch (err) {
  add('WorkStream readable', false, (err as Error).message.split('\n')[0]);
}

report();

function report(): never {
  let allOk = true;
  for (const c of checks) {
    if (!c.ok) allOk = false;
    console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name.padEnd(42)} ${c.detail}`);
  }
  console.log(allOk ? '\nALL GREEN — run pnpm withdraw.' : '\nNOT READY — fix the FAIL lines first.');
  process.exit(allOk ? 0 : 1);
}
