// Server-only. Reads the StreamRegistry to find every announced stream.
//
// Same discovery the agent uses, and the same constraint: Arc's RPC enforces a
// hard 100,000-block ceiling on eth_getLogs and rejects anything wider with
// `-32602: query exceeds max block range`. Do not "verify" that limit with
// `cast logs --to-block latest` and conclude it is soft — passing the string
// `latest` takes a different validation path on the node, while viem resolves
// it to a number first and the real request IS capped.
import { WORK_STREAM_ABI } from '@proofstream/config';
import { type ContractFunctionName, createPublicClient, http, parseAbiItem } from 'viem';
import { arcTestnet } from 'viem/chains';

/// The names below are checked against the GENERATED ABI at compile time.
///
/// This used to take a bare `string`, and `readContract` is called with
/// `functionName as never`, so tsc could not see a name the contract does not
/// have. That is exactly how `activatedAt` was read with no matching ABI entry
/// on 2026-08-05: it compiled, the agent started, discovered zero streams, and
/// looked like a registry fault. Now that the ABI is generated `as const`, viem
/// can name every readable function and a typo fails the build instead.
type ReadFn = ContractFunctionName<typeof WORK_STREAM_ABI, 'view' | 'pure'>;


const STREAM_REGISTERED = parseAbiItem(
  'event StreamRegistered(address indexed stream, address indexed employer, address indexed agent, string repo)',
);

const MAX_LOG_WINDOW = 45_000n;

/// How many log windows to request at once. Enough to collapse the sweep,
/// few enough not to trip Arc's rate limiter.
const SWEEP_CONCURRENCY = 4;

export type StreamSummary = {
  address: string;
  employer: string;
  /** Read from the CONTRACT, never the event: setRepo can move a stream with
   *  no new registration, so the event's copy goes stale. */
  repo: string;
  milestone: string;
  budget: string;
  funded: string;
  /** What has reached, or is owed to, the contributor. While a milestone runs
   *  this is `min(accrued, target)`. Once it closes `earned()` reads 0 because
   *  the credit moved to `settledCredit`, so the certified figure stands in —
   *  otherwise a fully paid stream reports zero. */
  earned: string;
  /** Actually paid out, all milestones. */
  withdrawn: string;
  /** What the agent certified is owed. The gap to `earned` is certified work
   *  the stream has not delivered yet. */
  target: string;
  milestoneIndex: number;
  /** `ended` is NOT the same as `settled`. isActive() stays true until the
   *  employer closes, so a milestone whose duration has run was reporting
   *  "accruing" while nothing was accruing at all. */
  state: 'awaiting deposit' | 'accruing' | 'paused' | 'ended' | 'settled';
  /** Unix seconds when the milestone stopped accruing; 0 if never started.
   *  The agent stops certifying a fixed grace period after this. */
  endsAt: number;
  /** Block the stream was announced in. Anchors a log scan for this one
   *  stream's own history — scanning from the registry's deploy block instead
   *  costs a window per 45k blocks of chain, forever, and grows daily. */
  registeredAtBlock: string;
};

/// Is the agent expected to be watching this stream?
///
/// Only while the arrangement is still running. A SETTLED milestone is closed
/// and an ENDED one has run its course — the agent stops certifying a few hours
/// after the end date by design, so flagging either as "not being watched"
/// reports the intended behaviour as a fault. The warning is for a stream that
/// should be watched and is not.
export const isOpen = (s: StreamSummary) => s.state !== 'settled' && s.state !== 'ended';

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
let discoveryCache:
  | { at: number; streams: { stream: `0x${string}`; employer: `0x${string}`; block: bigint }[] }
  | null = null;
const DISCOVERY_TTL_MS = 60_000;

export async function listStreams(): Promise<StreamSummary[]> {
  const registry = process.env.NEXT_PUBLIC_REGISTRY_ADDRESS as `0x${string}` | undefined;
  if (!registry) return [];

  const rpc = client();
  let discovered = discoveryCache && Date.now() - discoveryCache.at < DISCOVERY_TTL_MS
    ? discoveryCache.streams
    : null;

  if (!discovered) {
    const from = BigInt(process.env.REGISTRY_DEPLOY_BLOCK || '54593230');
    const latest = await rpc.getBlockNumber();

    // Every window up front, then run them a few at a time. Sequentially this
    // was fourteen round trips end to end and growing by one every seven hours
    // — the single largest cost of loading any page in this app. Concurrency is
    // capped rather than unbounded because Arc's public RPC rate-limits, and a
    // burst of fourteen is exactly what trips it.
    const windows: [bigint, bigint][] = [];
    for (let cursor = from; cursor <= latest; ) {
      const to = cursor + MAX_LOG_WINDOW - 1n > latest ? latest : cursor + MAX_LOG_WINDOW - 1n;
      windows.push([cursor, to]);
      cursor = to + 1n;
    }

    // Named so the return type keeps the event's decoded `args`; inferring it
    // from `rpc.getLogs` in the abstract loses them.
    const fetchWindow = (fromBlock: bigint, toBlock: bigint) =>
      rpc.getLogs({ address: registry, event: STREAM_REGISTERED, fromBlock, toBlock });

    const batches: Awaited<ReturnType<typeof fetchWindow>>[] = [];
    for (let i = 0; i < windows.length; i += SWEEP_CONCURRENCY) {
      const slice = windows.slice(i, i + SWEEP_CONCURRENCY);
      batches.push(...(await Promise.all(slice.map(([f, t]) => fetchWindow(f, t)))));
    }

    // Sorted by block so a later registration of the same stream — after
    // `setRepo` — still overwrites the earlier one. The windows come back in
    // request order, not necessarily block order, so this cannot be skipped.
    const seen = new Map<string, { stream: `0x${string}`; employer: `0x${string}`; block: bigint }>();
    for (const entry of batches.flat().sort((a, b) => Number((a.blockNumber ?? 0n) - (b.blockNumber ?? 0n)))) {
      seen.set((entry.args.stream as string).toLowerCase(), {
        stream: entry.args.stream as `0x${string}`,
        employer: entry.args.employer as `0x${string}`,
        block: entry.blockNumber ?? 0n,
      });
    }

    discovered = [...seen.values()];
    discoveryCache = { at: Date.now(), streams: discovered };
  }

  // Across streams as well as within one. This loop used to await each stream
  // in turn, so ten multicalled reads became six round trips end to end — the
  // whole list took as long as the slowest stream times the number of streams.
  // The multicall batcher also has more to work with when they overlap.
  const settled = await Promise.all(
    discovered.map(async ({ stream, employer, block }): Promise<StreamSummary | null> => {
    try {
      const read = <T>(functionName: ReadFn) =>
        rpc.readContract({ address: stream, abi: WORK_STREAM_ABI, functionName: functionName as never }) as Promise<T>;

      const [repo, milestone, budget, funded, earned, target, index, fullyFunded, paused, endsAt, closed, withdrawn] =
        await Promise.all([
          read<string>('repo'),
          read<string>('milestone'),
          read<bigint>('budget'),
          read<bigint>('funded'),
          read<bigint>('earned'),
          read<bigint>('target'),
          read<bigint>('milestoneIndex'),
          read<boolean>('fullyFunded'),
          read<boolean>('paused'),
          read<bigint>('milestoneEndsAt'),
          read<boolean>('milestoneClosed'),
          read<bigint>('withdrawn'),
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

      return {
        address: stream,
        employer,
        repo,
        milestone,
        budget: budget.toString(),
        funded: funded.toString(),
        // WHAT REACHED THE CONTRIBUTOR, whatever state the milestone is in.
        //
        // `earned()` returns 0 the moment a milestone closes — the credited
        // amount moves into `settledCredit` and the accrual view stops
        // describing it. Reading it raw made a closed stream that had paid a
        // contributor in full report "0.000000 of 100", which says the opposite
        // of what happened, and made the PAID OUT status fall back to CLOSED.
        //
        // For a closed milestone the credited figure is what the agent
        // certified, which `target()` still holds; `withdrawn` is the floor
        // under it, in case a later milestone ever moves `target`.
        earned: (closed ? (target > withdrawn ? target : withdrawn) : earned).toString(),
        target: target.toString(),
        withdrawn: withdrawn.toString(),
        milestoneIndex: Number(index),
        state,
        endsAt: Number(endsAt),
        registeredAtBlock: block.toString(),
      };
    } catch {
      // A registered address that no longer answers is not worth breaking the
      // page over — omit it rather than rendering a broken row.
      return null;
    }
    }),
  );

  // Newest announcement first. Sorting by repository name read as stable but
  // collapsed exactly where it mattered: every stream on ONE repository compares
  // equal, so the order fell through to discovery order — which is block
  // ASCENDING — and a stream created a minute ago sorted below three dead ones
  // on the same repo. Registration block is the only recency signal the registry
  // gives us, and it is monotonic, so it orders these correctly by construction.
  return settled
    .filter((s): s is StreamSummary => s !== null)
    .sort((a, b) => {
      const byBlock = BigInt(b.registeredAtBlock) - BigInt(a.registeredAtBlock);
      return byBlock > 0n ? 1 : byBlock < 0n ? -1 : 0;
    });
}
