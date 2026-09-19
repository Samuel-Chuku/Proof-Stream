import { type WalletClient, type PublicClient, type Abi, type Address } from 'viem';
import workstreamAbi from '../generated/workstream.abi.json' with { type: 'json' };

export async function withdrawConfirmed(publicClient: PublicClient, wallet: WalletClient, stream: Address, to: Address, amount: bigint) {
  const abi = workstreamAbi as Abi;
  const withdrawable = await publicClient.readContract({ address: stream, abi, functionName: 'withdrawable' as never }) as bigint;
  if (amount <= 0n || amount > withdrawable) throw new Error('Amount exceeds current withdrawable balance');
  const [account] = await wallet.getAddresses();
  if (!account) throw new Error('Wallet has no account');
  const hash = await wallet.writeContract({ account, chain: null, address: stream, abi, functionName: 'withdraw' as never, args: [to, amount] as never });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error(`Withdrawal reverted: ${hash}`);
  return { hash, receipt };
}
