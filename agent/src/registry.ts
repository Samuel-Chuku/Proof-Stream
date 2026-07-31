// Which streams does this agent serve?
//
// One agent process, many employers. The StreamRegistry contract is the
// discovery layer: employers deploy their own WorkStream and announce it, and
// this module folds those logs into a repo -> stream routing table.
//
// Two rules govern everything here:
//
//   1. The LOG says which streams exist. The CHAIN says what they are.
//      `setRepo` changes a stream's repo with no registry event, so the event's
//      repo field can be stale the moment after it is emitted. We read `repo()`
//      and `agent()` from each stream instead, every refresh.
//   2. An agent signs only for streams that appointed it. The log filter does
//      this by topic, and we re-check on chain, because signing for a stream
//      that named someone else is the one mistake with no recovery.
import { createPublicClient, http, parseAbiItem } from 'viem';
import { arcTestnet } from 'viem/chains';
import { readIdentity } from './chain';
import { env } from './env';

const STREAM_REGISTERED = parseAbiItem(
  'event StreamRegistered(address indexed stream, address indexed employer, address indexed agent, string repo)',
);

// ALWAYS send explicit fromBlock/toBlock. A getLogs call that omits them is
// rejected outright with `-32602: query exceeds max block range 100000` — which
// misleadingly reads like a 100k cap on all queries. Measured against the live
// node, it is not: explicit windows of 100,001, 500,000, 1,000,000 and even
// 2,000,000 blocks all return fine, and only ~5,000,000 starts timing out.
// So the window below is about bounding query TIME, not dodging a hard cap.
const MAX_LOG_WINDOW = 500_000n;

export type StreamEntry = {
  stream: `0x${string}`;
  employer: `0x${string}`;
  /** Read from the contract, not the event. */
  repo: string;
};

const publicClient = createPublicClient({ chain: arcTestnet, transport: http(env.arcRpcUrl) });

/** stream -> entry. Keyed by stream because a stream is the durable identity;
 *  the repo is a mutable property of it. */
const streams = new Map<string, StreamEntry>();
/** repo (lowercased) -> entry. Rebuilt from scratch every refresh so a rename
 *  cannot leave the old repo pointing at the stream. */
let repoIndex = new Map<string, StreamEntry>();
/** Highest block already scanned; the next scan starts after it. */
let cursor: bigint | null = null;
/** Streams that named a different agent. Remembered so the refusal is logged
 *  once rather than every refresh. */
const refused = new Set<string>();

type Logger = (entry: Record<string, unknown>) => void;

/// Discover newly registered streams, then refresh every known stream's
/// identity from the chain. Safe to call repeatedly.
export async function refresh(log: Logger): Promise<void> {
  if (env.registryAddress) await scanForNewStreams(log);

  // The single-stream fallback (non-negotiable #4): an existing deployment with
  // no registry keeps working untouched, and one WITH a registry still gets its
  // original stream even if it was never announced.
  if (env.workStream && !streams.has(env.workStream.toLowerCase())) {
    streams.set(env.workStream.toLowerCase(), {
      stream: env.workStream,
      employer: '0x0000000000000000000000000000000000000000',
      repo: '',
    });
  }

  const next = new Map<string, StreamEntry>();

  for (const entry of streams.values()) {
    let identity: { agent: `0x${string}`; repo: string };
    try {
      identity = await readIdentity(entry.stream);
    } catch (err) {
      log({
        event: 'registry_read_failed',
        stream: entry.stream,
        message: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    // Rule 2. Loud, because an employer who registers a stream naming the wrong
    // agent will otherwise just see nothing ever happen.
    if (identity.agent.toLowerCase() !== env.agentAddress.toLowerCase()) {
      if (!refused.has(entry.stream.toLowerCase())) {
        refused.add(entry.stream.toLowerCase());
        log({
          event: 'registry_refused',
          stream: entry.stream,
          reason: `stream appoints ${identity.agent}, this agent is ${env.agentAddress} — it will not be served`,
        });
      }
      continue;
    }

    if (!identity.repo) {
      log({ event: 'registry_skipped', stream: entry.stream, reason: 'stream names no repo' });
      continue;
    }

    entry.repo = identity.repo;
    const key = identity.repo.toLowerCase();

    // Two streams claiming one repo is ambiguous, and guessing would route a
    // payout to whichever happened to register last. Refuse both.
    const clash = next.get(key);
    if (clash && clash.stream.toLowerCase() !== entry.stream.toLowerCase()) {
      log({
        event: 'registry_conflict',
        repo: identity.repo,
        streams: [clash.stream, entry.stream],
        reason: 'two streams claim the same repo — neither will be served until one is retired',
      });
      next.delete(key);
      continue;
    }

    next.set(key, entry);
  }

  repoIndex = next;
}

/// Paged so a window never exceeds Arc's cap, and cursored so a steady-state
/// refresh reads only the handful of blocks since the last one.
async function scanForNewStreams(log: Logger): Promise<void> {
  const latest = await publicClient.getBlockNumber();
  let from = cursor === null ? env.registryDeployBlock : cursor + 1n;
  if (from > latest) return;

  const firstScan = cursor === null;
  let found = 0;

  while (from <= latest) {
    const to = from + MAX_LOG_WINDOW - 1n > latest ? latest : from + MAX_LOG_WINDOW - 1n;

    const logs = await publicClient.getLogs({
      address: env.registryAddress,
      event: STREAM_REGISTERED,
      // Rule 2, first pass: never even fetch other agents' streams.
      args: { agent: env.agentAddress },
      fromBlock: from,
      toBlock: to,
    });

    // Ascending block order, so a later registration of the same stream simply
    // overwrites the earlier one.
    for (const entry of logs) {
      const stream = entry.args.stream as `0x${string}`;
      const employer = entry.args.employer as `0x${string}`;
      if (!streams.has(stream.toLowerCase())) found += 1;
      streams.set(stream.toLowerCase(), { stream, employer, repo: '' });
    }

    from = to + 1n;
  }

  cursor = latest;
  if (firstScan || found > 0) {
    log({
      event: 'registry_scanned',
      registry: env.registryAddress,
      throughBlock: Number(latest),
      newStreams: found,
      totalStreams: streams.size,
    });
  }
}

/// The routing decision: which stream, if any, owns this repo.
export function resolveStream(repo: string): StreamEntry | undefined {
  return repoIndex.get(repo.toLowerCase());
}

export function knownStreams(): StreamEntry[] {
  return [...repoIndex.values()];
}

/// Look a stream up by address — the webhook route carries one, and it must be
/// checked against what we actually serve rather than trusted.
export function isServed(streamAddress: string): StreamEntry | undefined {
  return [...repoIndex.values()].find(
    (e) => e.stream.toLowerCase() === streamAddress.toLowerCase(),
  );
}

/// Refresh now, then keep refreshing. Returns once the first scan is done so
/// startup can report what it found.
export async function startRegistry(log: Logger): Promise<void> {
  await refresh(log);
  const timer = setInterval(() => {
    refresh(log).catch((err) =>
      log({ event: 'registry_refresh_failed', message: err instanceof Error ? err.message : String(err) }),
    );
  }, env.registryRefreshMs);
  timer.unref();
}
