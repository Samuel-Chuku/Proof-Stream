import { createPublicClient, defineChain, http, getAddress, formatUnits, type Abi } from 'viem';
import workstreamAbi from '../generated/workstream.abi.json' with { type: 'json' };

const chain = defineChain({ id: 5042002, name: 'Arc Testnet', nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 6 }, rpcUrls: { default: { http: ['https://rpc.testnet.arc.network'] } } });
const stream = getAddress(process.argv[2] || '0x0000000000000000000000000000000000000000');
const client = createPublicClient({ chain, transport: http() });
const abi = workstreamAbi as Abi;

async function read(functionName: string) {
  return client.readContract({ address: stream, abi, functionName: functionName as never }) as Promise<unknown>;
}

const [employer, contributor, claimAuthority, isPublic, milestoneIndex, funded, certifiedBps, accrued, earned, withdrawable] = await Promise.all([
  read('employer'), read('contributor'), read('claimAuthority'), read('isPublic'), read('milestoneIndex'), read('funded'), read('certifiedBps'), read('accrued'), read('earned'), read('withdrawable'),
]);
const mode = isPublic ? 'public' : contributor !== '0x0000000000000000000000000000000000000000' ? 'named-or-claimed' : 'awaiting-claim';
console.log(JSON.stringify({ chainId: chain.id, stream, mode, employer, contributor, claimAuthority, milestoneIndex, funded: formatUnits(funded as bigint, 6), certifiedBps, accrued: formatUnits(accrued as bigint, 6), earned: formatUnits(earned as bigint, 6), namedWithdrawable: isPublic ? null : formatUnits(withdrawable as bigint, 6) }, null, 2));
