import { createPublicClient, defineChain, http, getAddress, type Abi } from 'viem';
import workstreamAbi from '../generated/workstream.abi.json' with { type: 'json' };

const chain = defineChain({ id: 5042002, name: 'Arc Testnet', nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 6 }, rpcUrls: { default: { http: ['https://rpc.testnet.arc.network'] } } });
const stream = getAddress(process.argv[2] || '0x0000000000000000000000000000000000000000');
const client = createPublicClient({ chain, transport: http() });
const unwatch = client.watchContractEvent({ address: stream, abi: workstreamAbi as Abi, eventName: 'MilestoneCertified', onLogs: (logs) => { for (const log of logs) console.log(JSON.stringify({ kind: 'certification-observed', log })); } });
process.on('SIGINT', () => { unwatch(); process.exit(0); });
console.error(`Watching ${stream} on chain ${chain.id}. Persist a cursor and dedupe logs in production.`);
