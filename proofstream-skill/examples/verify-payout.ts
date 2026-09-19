import { createPublicClient, defineChain, http, getAddress, type Abi, type Hash } from 'viem';
import workstreamAbi from '../generated/workstream.abi.json' with { type: 'json' };

export async function verifyPayout(txHash: Hash, streamAddress: string) {
  const chain = defineChain({ id: 5042002, name: 'Arc Testnet', nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 6 }, rpcUrls: { default: { http: ['https://rpc.testnet.arc.network'] } } });
  const client = createPublicClient({ chain, transport: http() });
  const receipt = await client.getTransactionReceipt({ hash: txHash });
  if (receipt.status !== 'success') return { confirmed: false, reason: 'transaction-reverted', txHash };
  const getLogs = client.getLogs as unknown as (args: Record<string, unknown>) => Promise<Array<{ transactionHash?: string }>>;
  const range = { address: getAddress(streamAddress), abi: workstreamAbi as Abi, fromBlock: receipt.blockNumber, toBlock: receipt.blockNumber };
  const [named, publicPayout] = await Promise.all([
    getLogs({ ...range, eventName: 'Withdrawn' }),
    getLogs({ ...range, eventName: 'PaidOut' }),
  ]);
  const payoutEvent = named.some((log) => log.transactionHash === txHash)
    ? 'Withdrawn'
    : publicPayout.some((log) => log.transactionHash === txHash)
      ? 'PaidOut'
      : null;
  return { confirmed: payoutEvent !== null, payoutEvent, txHash, blockNumber: receipt.blockNumber.toString() };
}
