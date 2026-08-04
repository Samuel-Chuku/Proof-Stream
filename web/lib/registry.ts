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
  { type: 'function', name: 'milestoneEndsAt', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'milestoneClosed', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] },
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
  /** `ended` is NOT the same as `settled`. isActive() stays true until the
   *  employer closes, so a milestone whose duration has run was reporting
   *  "accruing" while nothing was accruing at all. */
  state: 'awaiting deposit' | 'accruing' | 'paused' | 'ended' | 'settled';
};

const client = () =>
  createPublicClient({
    chain: arcTestnet,
    transport: http(process.env.ARC_RPC_URL, { batch: { wait: 8 } }),
    // Multicall3 is deployed on Arc, so each stream's nine reads collapse into
    // one request instead of nine round trips.
    batch: { multicall: true },
  });

/// The registry log scan is the expensive half of this page: a paged sweep from
/// the deploy block on every request. Streams are announced rarely, so a short
/// process-level cache turns that into one sweep a minute instead of one per
/// visitor. Deliberately not Next's cache — this must also work when the page
/// is force-dynamic, which it is because the STREAM STATE must stay live.
let discoveryCache: { at: number; streams: { stream: `0x${string}`; employer: `0x${string}` }[] } | null = null;
const DISCOVERY_TTL_MS = 60_000;

export async function listStreams(): Promise<StreamSummary[]> {
  const registry = process.env.NEXT_PUBLIC_REGISTRY_ADDRESS as `0x${string}` | undefined;
  if (!registry) return [];

  const rpc = client();
  let discovered = discoveryCache && Date.now() - discoveryCache.at < DISCOVERY_TTL_MS
    ? discoveryCache.streams
    : null;

  if (!discovered) {
    const from = BigInt(process.env.REGISTRY_DEPLOY_BLOCK ?? '54593230');
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

    discovered = [...seen.values()];
    discoveryCache = { at: Date.now(), streams: discovered };
  }

  const summaries: StreamSummary[] = [];
  for (const { stream, employer } of discovered) {
    try {
      const read = <T>(functionName: string) =>
        rpc.readContract({ address: stream, abi: WORK_STREAM_ABI, functionName: functionName as never }) as Promise<T>;

      const [repo, milestone, budget, funded, unlocked, index, fullyFunded, paused, endsAt, closed] =
        await Promise.all([
          read<string>('repo'),
          read<string>('milestone'),
          read<bigint>('budget'),
          read<bigint>('funded'),
          read<bigint>('milestoneUnlocked'),
          read<bigint>('milestoneIndex'),
          read<boolean>('fullyFunded'),
          read<boolean>('paused'),
          read<bigint>('milestoneEndsAt'),
          read<boolean>('milestoneClosed'),
        ]);

      const now = BigInt(Math.floor(Date.now() / 1000));
      const state: StreamSummary['state'] = closed
        ? 'settled'
        : !fullyFunded
          ? 'awaiting deposit'
          : paused
            ? 'paused'
            : endsAt > 0n && now >= endsAt
              ? 'ended'
              : 'accruing';

      summaries.push({
        address: stream,
        employer,
        repo,
        milestone,
        budget: budget.toString(),
        funded: funded.toString(),
        unlocked: unlocked.toString(),
        milestoneIndex: Number(index),
        state,
      });
    } catch {
      // A registered address that no longer answers is not worth breaking the
      // page over — omit it rather than rendering a broken row.
    }
  }

  return summaries.sort((a, b) => a.repo.localeCompare(b.repo));
}
