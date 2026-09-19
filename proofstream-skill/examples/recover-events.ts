import { createPublicClient, defineChain, http, getAddress, type Abi } from 'viem';
import workstreamAbi from '../generated/workstream.abi.json' with { type: 'json' };

const [addressArg, fromArg, toArg] = process.argv.slice(2);
if (!addressArg || !fromArg || !toArg) throw new Error('Usage: recover-events <stream> <fromBlock> <toBlock>');
const chain = defineChain({ id: 5042002, name: 'Arc Testnet', nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 6 }, rpcUrls: { default: { http: ['https://rpc.testnet.arc.network'] } } });
const client = createPublicClient({ chain, transport: http() });
const getLogs = client.getLogs as unknown as (args: Record<string, unknown>) => Promise<Array<{ transactionHash?: string; logIndex?: number; [key: string]: unknown }>>;
const logs = await getLogs({ address: getAddress(addressArg), abi: workstreamAbi as Abi, eventName: 'MilestoneCertified', fromBlock: BigInt(fromArg), toBlock: BigInt(toArg) });
const seen = new Set<string>();
for (const log of logs) { const key = `${log.transactionHash}:${log.logIndex}`; if (!seen.has(key)) { seen.add(key); console.log(JSON.stringify(log)); } }
