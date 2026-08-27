import { createPublicClient, defineChain, http, getAddress, type Abi, type Hash } from 'viem';
import workstreamAbi from '../generated/workstream.abi.json' with { type: 'json' };

export async function verifyPayout(txHash: Hash, streamAddress: string) {
  const chain = defineChain({ id: 5042002, name: 'Arc Testnet', nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 6 }, rpcUrls: { default: { http: ['https://rpc.testnet.arc.network'] } } });
  const client = createPublicClient({ chain, transport: http() });
  const receipt = await client.getTransactionReceipt({ hash: txHash });
  if (receipt.status !== 'success') return { confirmed: false, reason: 'transaction-reverted', txHash };
  const getLogs = client.getLogs as unknown as (args: Record<string, unknown>) => Promise<Array<{ transactionHash?: string }>>;
  const logs = await getLogs({ address: getAddress(streamAddress), abi: workstreamAbi as Abi, eventName: 'Withdrawn', fromBlock: receipt.blockNumber, toBlock: receipt.blockNumber });
  return { confirmed: logs.some((log) => log.transactionHash === txHash), txHash, blockNumber: receipt.blockNumber.toString() };
}
