// Sweeps the demo fixture wallets (contributor, vesting vault) back to the
// deployer so their USDC can fund the next stream instead of sitting idle.
//
// LIVE — moves real testnet USDC. Run `pnpm preflight:drain` first (§5.10).
//
// It does NOT touch the attestor or verifier wallets: those hold their own
// operating funds and Gateway balances, and draining them would stop the agents
// working. It does not touch the WorkStream either — the contract's own balance
// comes back via closeMilestone(), which only the employer can call.
//
//   pnpm sweep            # sweep both fixture wallets
//   pnpm sweep contributor
//   pnpm sweep vault
import { EXPLORER_URL, USDC_ADDRESS, formatUsdc, parseUsdc } from '@proofstream/config';
import { createPublicClient, createWalletClient, erc20Abi, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arcTestnet } from 'viem/chains';

// On Arc the native gas balance and the ERC-20 USDC balance are the same money
// seen at two scales (18dp vs 6dp, 1e12 apart), so a sweep has to leave enough
// behind to pay for itself.
//
// The subtlety that cost a reverted transaction: the node debits
// `gasLimit * maxFeePerGas` from that shared balance BEFORE running the call,
// and when no gas limit is supplied it uses the BLOCK gas limit. Measured on
// Arc that reservation is 0.87 USDC (30,000,000 * 29 gwei) even though the
// transfer actually costs 0.00143. A flat buffer under 0.87 therefore fails
// with "ERC20: transfer amount exceeds balance", which reads like a balance bug
// rather than a gas one.
//
// So: send an EXPLICIT gas limit and fee, and size the buffer from those.
const NATIVE_PER_USDC = 1_000_000_000_000n; // 18dp native : 6dp ERC-20

/// Round a wei-denominated gas reserve up into whole 6-dp USDC units.
function reserveInUsdc(wei: bigint): bigint {
  return wei / NATIVE_PER_USDC + 1n;
}

const to = process.env.DEPLOYER_ADDRESS as `0x${string}` | undefined;
if (!to) {
  console.error('DEPLOYER_ADDRESS is not set — nowhere to sweep to');
  process.exit(1);
}

// Reserve enough to keep WORKING, not merely enough to pay for this transfer.
// The contributor still has to send withdraw() transactions, and on Arc that
// gas comes out of this same USDC — draining it to dust bricks the payout leg
// and fails `pnpm preflight:deploy` on "contributor native gas >= 1". The vault
// only ever receives (nothing in this repo holds it as a sender), so gas-dust
// is the right answer there.
const OPERATING_RESERVE: Record<string, bigint> = {
  contributor: parseUsdc('2'),
  vault: 0n,
};

const only = process.argv[2];
const wallets = [
  { label: 'contributor', keyVar: 'CONTRIBUTOR_PRIVATE_KEY' },
  // No vault entry. WorkStream stopped diverting 15% to a "vesting vault" that
  // vested nothing, so nothing pays that wallet any more; what is left in it is
  // historical dust worth less than the gas to move it.
].filter((w) => !only || w.label === only);

if (wallets.length === 0) {
  console.error('usage: pnpm sweep [contributor|vault]');
  process.exit(1);
}

const transport = http(process.env.ARC_RPC_URL);
const pub = createPublicClient({ chain: arcTestnet, transport });

let moved = 0n;

for (const { label, keyVar } of wallets) {
  const key = process.env[keyVar];
  if (!key) {
    console.log(`${label}: ${keyVar} not set — skipped`);
    continue;
  }

  const account = privateKeyToAccount(key as `0x${string}`);
  const balance = await pub.readContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [account.address],
  });

  // Price this specific transfer, then reserve twice that. The probe uses 1
  // unit so it cannot itself revert for want of balance.
  const fees = await pub.estimateFeesPerGas();
  const maxFeePerGas = fees.maxFeePerGas ?? 0n;
  const maxPriorityFeePerGas = fees.maxPriorityFeePerGas ?? 0n;
  const probeGas = await pub.estimateContractGas({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'transfer',
    args: [to, 1n],
    account,
  });

  const gas = (probeGas * 3n) / 2n; // 50% headroom on the limit itself
  const reserve = reserveInUsdc(gas * maxFeePerGas * 2n) + (OPERATING_RESERVE[label] ?? 0n);

  if (balance <= reserve) {
    console.log(`${label}: ${formatUsdc(balance)} USDC — under the ${formatUsdc(reserve)} reserve, nothing to take`);
    continue;
  }

  const amount = balance - reserve;
  console.log(
    `${label}: sending ${formatUsdc(amount)} USDC → ${to}  (gas ${gas}, reserve ${formatUsdc(reserve)})`,
  );

  const wallet = createWalletClient({ account, chain: arcTestnet, transport });
  // gas and fees passed EXPLICITLY so the node reserves what we budgeted for
  // rather than the block gas limit. This is the whole fix.
  const hash = await wallet.writeContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'transfer',
    args: [to, amount],
    gas,
    maxFeePerGas,
    maxPriorityFeePerGas,
  });
  const receipt = await pub.waitForTransactionReceipt({ hash });

  if (receipt.status !== 'success') {
    console.error(`  FAILED — ${EXPLORER_URL}/tx/${hash}`);
    continue;
  }

  moved += amount;
  console.log(`  ok  ${EXPLORER_URL}/tx/${hash}`);
}

const after = await pub.readContract({
  address: USDC_ADDRESS,
  abi: erc20Abi,
  functionName: 'balanceOf',
  args: [to],
});

console.log(`\nswept ${formatUsdc(moved)} USDC; deployer now holds ${formatUsdc(after)} USDC`);
