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
import { parseRepoSpec } from '@proofstream/config';
import { createPublicClient, http, parseAbiItem } from 'viem';
import { arcTestnet } from 'viem/chains';
import { readIdentity } from './chain';
import { env } from './env';

const STREAM_REGISTERED = parseAbiItem(
  'event StreamRegistered(address indexed stream, address indexed employer, address indexed agent, string repo)',
);

// Arc's RPC enforces a hard 100,000-block ceiling on eth_getLogs and answers
// `-32602: query exceeds max block range 100000`. Stay well under it.
//
// Do NOT "verify" this with `cast logs --to-block latest` and conclude the cap
// is soft. Passing the string `latest` takes a different validation path on the
// node and wide ranges appear to succeed; viem resolves `latest` to a concrete
// number first, so the real request is numeric on both ends and IS capped.
// A probe that does not send the same request the code sends proves nothing.
const MAX_LOG_WINDOW = 45_000n;

/// How many live streams one repository may have judged per merge. Each costs
/// an inference call and a verifier fee, so this is a spend bound, not a
/// correctness one.
const MAX_STREAMS_PER_REPO = 5;

export type StreamEntry = {
  stream: `0x${string}`;
  employer: `0x${string}`;
  /** Read from the contract, not the event. */
  repo: string;
  /** Unix seconds this milestone's clock started; 0 if not yet funded in full.
   *  Carried here so reconciliation can refuse work that predates it. */
  activatedAt: bigint;
};

const publicClient = createPublicClient({ chain: arcTestnet, transport: http(env.arcRpcUrl) });

/** stream -> entry. Keyed by stream because a stream is the durable identity;
 *  the repo is a mutable property of it. */
const streams = new Map<string, StreamEntry>();
/** repo (lowercased) -> EVERY live stream watching it. Rebuilt from scratch
 *  each refresh so a rename cannot leave an old repo pointing at a stream.
 *
 *  Several streams on one repository is normal, not a conflict: two
 *  contributors can be paid from two budgets against two different milestones
 *  in the same codebase. An earlier version refused to serve any of them,
 *  which made a perfectly ordinary arrangement look broken — and blocked a new
 *  stream whenever an old one on the same repo had merely run out of time. */
let repoIndex = new Map<string, StreamEntry[]>();
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
      activatedAt: 0n,
    });
  }

  const next = new Map<string, StreamEntry[]>();

  for (const entry of streams.values()) {
    // Derived, not restated: a hand-written copy of this shape silently went
    // stale the moment readIdentity learned a new field.
    let identity: Awaited<ReturnType<typeof readIdentity>>;
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

    // A settled milestone cannot pay: the pipeline skips it on isActive, so
    // serving it does nothing. More importantly it must not COMPETE — a closed
    // stream was blocking a live one on the same repo, which is the strictness
    // being wrong rather than safe.
    //
    // Closing is the PERMANENT end. Nothing below can bring a settled stream
    // back, and nothing should: `closeMilestone` has already refunded the
    // unspent budget to the employer.
    if (identity.closed) {
      log({
        event: 'registry_settled',
        stream: entry.stream,
        repo: identity.repo,
        reason: 'milestone is settled — not served, and it no longer claims the repo',
      });
      continue;
    }

    // Past its end date plus the grace window. The contract's `unlock` has no
    // end-date check, so a stream stays armed until the employer closes it —
    // this is what stops an unrelated merge, weeks later, releasing from a
    // milestone everyone considered over. Retiring it here also frees the repo
    // slot and costs no inference.
    //
    // Uses the contract's own `milestoneEndsAt()` — activation plus duration.
    // It deliberately ignores paused time, exactly as `accrued()` does: pausing
    // stops the earning clock but never moves the end date, so nothing accrues
    // past this instant either way.
    const graceEndsAt = identity.endsAt + BigInt(Math.round(env.milestoneGraceHours * 3600));
    const now = BigInt(Math.floor(Date.now() / 1000));
    if (identity.endsAt > 0n && now > graceEndsAt) {
      log({
        event: 'registry_expired',
        stream: entry.stream,
        repo: identity.repo,
        endedAt: new Date(Number(identity.endsAt) * 1000).toISOString(),
        reason: `milestone ended more than ${env.milestoneGraceHours}h ago — no longer certified; close it to reclaim the unspent budget`,
      });
      continue;
    }

    entry.repo = identity.repo;
    entry.activatedAt = identity.activatedAt;
    // Keyed on the REPOSITORY ONLY, never the full spec. A webhook arrives with
    // `repository.full_name` and no branch, so an index keyed on
    // `owner/name#branch` would never be found and the stream would silently go
    // unserved. The branch is enforced in the pipeline, where the event's own
    // base ref is available to compare against.
    const key = parseRepoSpec(identity.repo).repo.toLowerCase();
    const existing = next.get(key) ?? [];

    // A runaway repo would otherwise cost one judgment — and one verifier fee —
    // per stream per merge. Settled streams are already excluded above, so
    // reaching this bound means someone is funding a lot of live streams.
    if (existing.length >= MAX_STREAMS_PER_REPO) {
      log({
        event: 'registry_repo_crowded',
        repo: identity.repo,
        skipped: entry.stream,
        reason: `more than ${MAX_STREAMS_PER_REPO} live streams watch this repo — the rest are not served`,
      });
      continue;
    }

    next.set(key, [...existing, entry]);
  }

  repoIndex = next;
}

/// One getLogs call, splitting itself in half if the provider rejects the range.
///
/// MAX_LOG_WINDOW is a guess about someone else's node. If a provider enforces
/// a tighter ceiling — or starts to — the agent should degrade into more, smaller
/// requests rather than refusing to start. Every other error propagates: only a
/// range complaint is worth retrying differently.
async function getLogsInWindow(from: bigint, to: bigint, log: Logger): Promise<any[]> {
  try {
    return await publicClient.getLogs({
      address: env.registryAddress,
      event: STREAM_REGISTERED,
      // Rule 2, first pass: never even fetch other agents' streams.
      args: { agent: env.agentAddress },
      fromBlock: from,
      toBlock: to,
    });
  } catch (err) {
    const rangeRejected = /max block range|block range|range is too large/i.test(
      String((err as Error).message),
    );
    if (!rangeRejected || to <= from) throw err;

    const mid = from + (to - from) / 2n;
    log({
      event: 'registry_window_halved',
      from: Number(from),
      to: Number(to),
      reason: 'provider rejected the block range — retrying in halves',
    });
    const left = await getLogsInWindow(from, mid, log);
    const right = await getLogsInWindow(mid + 1n, to, log);
    return [...left, ...right];
  }
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

    const logs = await getLogsInWindow(from, to, log);

    // Ascending block order, so a later registration of the same stream simply
    // overwrites the earlier one.
    for (const entry of logs) {
      const stream = entry.args.stream as `0x${string}`;
      const employer = entry.args.employer as `0x${string}`;
      if (!streams.has(stream.toLowerCase())) found += 1;
      streams.set(stream.toLowerCase(), { stream, employer, repo: '', activatedAt: 0n });
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

/// Every stream watching this repo. A merged pull request is judged against
/// each of them separately, because each carries its own milestone and pays
/// from its own budget.
export function resolveStreams(repo: string): StreamEntry[] {
  return repoIndex.get(repo.toLowerCase()) ?? [];
}

export function knownStreams(): StreamEntry[] {
  return [...repoIndex.values()].flat();
}

/// Look a stream up by address — the webhook route carries one, and it must be
/// checked against what we actually serve rather than trusted.
export function isServed(streamAddress: string): StreamEntry | undefined {
  return knownStreams().find((e) => e.stream.toLowerCase() === streamAddress.toLowerCase());
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
