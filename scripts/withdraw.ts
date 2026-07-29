// The payout leg: the contributor moves unlocked USDC out of the stream to the
// policy's allowlisted payee. This is the third on-chain transaction in the
// demo cycle (unlock, its vault split, then this).
//
// LIVE — run `pnpm preflight:withdraw` first (§5.10).
//
//   pnpm withdraw          # withdraw everything available
//   pnpm withdraw 5        # withdraw 5 USDC
//
// The contributor key is a demo fixture. In the real product the contributor
// connects their own wallet; the repo holds this one only so Phase 5 can seed
// unattended.
import { EXPLORER_URL, formatUsdc, parseUsdc } from '@proofstream/config';
import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arcTestnet } from 'viem/chains';
import { WORK_STREAM_ABI } from './preflight-withdraw';

const workStream = process.env.WORKSTREAM_ADDRESS as `0x${string}`;
if (!workStream) throw new Error('WORKSTREAM_ADDRESS is not set — see .env.example');
if (!process.env.CONTRIBUTOR_PRIVATE_KEY) throw new Error('CONTRIBUTOR_PRIVATE_KEY is not set');

const account = privateKeyToAccount(process.env.CONTRIBUTOR_PRIVATE_KEY as `0x${string}`);
const transport = http(process.env.ARC_RPC_URL);
const publicClient = createPublicClient({ chain: arcTestnet, transport });
const walletClient = createWalletClient({ account, chain: arcTestnet, transport });

const read = <T>(functionName: string) =>
  publicClient.readContract({ address: workStream, abi: WORK_STREAM_ABI, functionName: functionName as never }) as Promise<T>;

const withdrawable = await read<bigint>('withdrawable');
const [, , payee] = await read<[bigint, bigint, `0x${string}`]>('policy');

const requested = process.argv[2] ? parseUsdc(process.argv[2]) : withdrawable;
if (requested <= 0n) throw new Error('nothing to withdraw');
if (requested > withdrawable) {
  throw new Error(`requested ${formatUsdc(requested)} but only ${formatUsdc(withdrawable)} USDC is withdrawable`);
}

console.log(`withdrawing ${formatUsdc(requested)} USDC`);
console.log(`  from:  ${workStream}`);
console.log(`  to:    ${payee} (policy-allowlisted payee)`);
console.log(`  by:    ${account.address} (contributor)\n`);

const hash = await walletClient.writeContract({
  address: workStream,
  abi: WORK_STREAM_ABI,
  functionName: 'withdraw',
  args: [payee, requested],
});

console.log(`tx ${hash}`);
const receipt = await publicClient.waitForTransactionReceipt({ hash });
console.log(`status ${receipt.status}, block ${receipt.blockNumber}`);
console.log(`${EXPLORER_URL}/tx/${hash}`);

const remaining = await read<bigint>('withdrawable');
console.log(`\nstill withdrawable: ${formatUsdc(remaining)} USDC`);
