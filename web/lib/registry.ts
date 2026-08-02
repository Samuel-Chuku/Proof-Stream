// Server-only. Reads the StreamRegistry to find every announced stream.
//
// Same discovery the agent uses, and the same constraint: Arc's RPC enforces a
// hard 100,000-block ceiling on eth_getLogs and rejects anything wider with
// `-32602: query exceeds max block range`. Do not "verify" that limit with
// `cast logs --to-block latest` and conclude it is soft — passing the string
// `latest` takes a different validation path on the node, while viem resolves
// it to a number first and the real request IS capped.
import { createPublicClient, http, parseAbiItem } from 'viem';
import { arcTestnet } from 'viem/chains';

const STREAM_REGISTERED = parseAbiItem(
  'event StreamRegistered(address indexed stream, address indexed employer, address indexed agent, string repo)',
);

const MAX_LOG_WINDOW = 45_000n;

const WORK_STREAM_ABI = [
  { type: 'function', name: 'repo', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'milestone', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'budget', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'funded', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'milestoneUnlocked', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'milestoneIndex', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'fullyFunded', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'isActive', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'paused', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] },
] as const;

export type StreamSummary = {
  address: string;
  employer: string;
  /** Read from the CONTRACT, never the event: setRepo can move a stream with
   *  no new registration, so the event's copy goes stale. */
  repo: string;
  milestone: string;
  budget: string;
  funded: string;
  unlocked: string;
  milestoneIndex: number;
  state: 'accruing' | 'awaiting deposit' | 'settled' | 'paused';
};

const client = () =>
  createPublicClient({ chain: arcTestnet, transport: http(process.env.ARC_RPC_URL) });

export async function listStreams(): Promise<StreamSummary[]> {
  const registry = process.env.NEXT_PUBLIC_REGISTRY_ADDRESS as `0x${string}` | undefined;
  if (!registry) return [];

  const from = BigInt(process.env.REGISTRY_DEPLOY_BLOCK ?? '54593230');
  const rpc = client();

  let cursor = from;
  const latest = await rpc.getBlockNumber();
  const seen = new Map<string, { stream: `0x${string}`; employer: `0x${string}` }>();

  while (cursor <= latest) {
    const to = cursor + MAX_LOG_WINDOW - 1n > latest ? latest : cursor + MAX_LOG_WINDOW - 1n;
    const logs = await rpc.getLogs({
      address: registry,
      event: STREAM_REGISTERED,
      fromBlock: cursor,
      toBlock: to,
    });
    // Ascending, so a later registration of the same stream simply overwrites.
    for (const entry of logs) {
      seen.set((entry.args.stream as string).toLowerCase(), {
        stream: entry.args.stream as `0x${string}`,
        employer: entry.args.employer as `0x${string}`,
      });
    }
    cursor = to + 1n;
  }

  const summaries: StreamSummary[] = [];
  for (const { stream, employer } of seen.values()) {
    try {
      const read = <T>(functionName: string) =>
        rpc.readContract({ address: stream, abi: WORK_STREAM_ABI, functionName: functionName as never }) as Promise<T>;

      const [repo, milestone, budget, funded, unlocked, index, fullyFunded, isActive, paused] =
        await Promise.all([
          read<string>('repo'),
          read<string>('milestone'),
          read<bigint>('budget'),
          read<bigint>('funded'),
          read<bigint>('milestoneUnlocked'),
          read<bigint>('milestoneIndex'),
          read<boolean>('fullyFunded'),
          read<boolean>('isActive'),
          read<boolean>('paused'),
        ]);

      summaries.push({
        address: stream,
        employer,
        repo,
        milestone,
        budget: budget.toString(),
        funded: funded.toString(),
        unlocked: unlocked.toString(),
        milestoneIndex: Number(index),
        state: !fullyFunded ? 'awaiting deposit' : paused ? 'paused' : isActive ? 'accruing' : 'settled',
      });
    } catch {
      // A registered address that no longer answers is not worth breaking the
      // page over — omit it rather than rendering a broken row.
    }
  }

  return summaries.sort((a, b) => a.repo.localeCompare(b.repo));
}
