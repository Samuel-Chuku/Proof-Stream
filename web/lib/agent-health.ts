// Server-only. Asks the agent what it is actually serving.
//
// THE PROBLEM THIS EXISTS TO SOLVE: a stream page can look completely healthy —
// funded, accruing, agent appointed — while the agent is silently refusing to
// serve it. A contributor could then do a week of work against a stream nobody
// was watching, and nothing on screen would say so. That is worse than the
// refusal itself.
//
// This deliberately ASKS THE AGENT rather than re-deriving its rules here. A
// second implementation of "which streams are served" would drift from the
// first, and the drift would be invisible for exactly the same reason.
import type { StreamSummary } from './registry';

export type AgentHealth = {
  reachable: boolean;
  agent?: string;
  /** Lowercased stream addresses the agent will act on. */
  serving: Set<string>;
};

/// The agent exposes /events for the dashboard and /health beside it.
function healthUrl(): string | null {
  const events = process.env.AGENT_EVENTS_URL;
  if (!events) return null;
  return events.replace(/\/events\b.*$/, '/health');
}

let cache: { at: number; value: AgentHealth } | null = null;
const TTL_MS = 15_000;

export async function readAgentHealth(): Promise<AgentHealth> {
  const url = healthUrl();
  if (!url) return { reachable: false, serving: new Set() };
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;

  try {
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(String(res.status));
    const body = (await res.json()) as { agent?: string; streams?: { stream: string }[] };
    const value: AgentHealth = {
      reachable: true,
      agent: body.agent,
      serving: new Set((body.streams ?? []).map((s) => s.stream.toLowerCase())),
    };
    cache = { at: Date.now(), value };
    return value;
  } catch {
    return { reachable: false, serving: new Set() };
  }
}

/// Mirrors MAX_STREAMS_PER_REPO in agent/src/registry.ts. Duplicated rather
/// than imported because the web app does not depend on the agent package — if
/// the bound moves there, move it here.
const MAX_STREAMS_PER_REPO = 5;

/// Mirrors MILESTONE_GRACE_HOURS in agent/src/env.ts, and reads the same
/// variable so a host running both stays consistent.
const GRACE_HOURS = Number(process.env.MILESTONE_GRACE_HOURS || 4);

export type Coverage =
  | { served: true }
  | { served: false; expected: true; title: string; detail: string }
  | { served: false; expected: false; title: string; detail: string };

/// Why this stream is not being watched, in terms the reader can act on.
///
/// `expected: true` means the silence is correct and needs no alarm — a settled
/// or long-ended milestone is finished, so of course nobody is watching it.
export function diagnose(s: {
  address: string;
  repo: string;
  /** milestoneClosed — the permanent end. */
  settled: boolean;
  /** Unix seconds the milestone stopped accruing; 0 if it never started. */
  endsAt: number;
  /** What closeMilestone would send back, already formatted. */
  reclaimableUsdc: string;
  agentOnChain: string;
  health: AgentHealth;
  allStreams: StreamSummary[];
}): Coverage {
  const { address, repo, settled, endsAt, agentOnChain, health, allStreams } = s;
  if (health.serving.has(address.toLowerCase())) return { served: true };

  if (settled) {
    return {
      served: false,
      expected: true,
      title: 'Finished — the agent has stopped watching',
      detail: 'Open a new milestone to put this stream back to work.',
    };
  }

  // Ended, and past the window the agent keeps certifying in. Checked before
  // reachability because "this milestone is over" is the true explanation even
  // when the agent also happens to be down — and it is not a fault.
  const graceEnds = endsAt > 0 ? (endsAt + GRACE_HOURS * 3600) * 1000 : 0;
  if (graceEnds > 0 && Date.now() > graceEnds) {
    return {
      served: false,
      expected: true,
      // "Close it to reclaim 0 USDC" is a nonsense instruction, and it is the
      // state a SUCCESSFUL stream ends in: everything was earned, so there is
      // nothing left to take back. Closing is still worth doing — it frees the
      // stream for a new milestone — but that is a different sentence.
      title:
        Number(s.reclaimableUsdc) > 0
          ? `Ended — close it to reclaim ${s.reclaimableUsdc} USDC`
          : 'Ended — fully earned, nothing to reclaim',
      detail:
        `This milestone stopped accruing on ${new Date(endsAt * 1000).toLocaleString()}, and the agent certifies work for ${GRACE_HOURS} more hours after that so nothing merged near the deadline is stranded. That window has passed, so no further merge will release from this stream. ` +
        (Number(s.reclaimableUsdc) > 0
          ? `Closing the milestone is the permanent end: it sends the ${s.reclaimableUsdc} USDC nobody earned back to the employer and frees the stream to open a new milestone.`
          : 'The contributor earned the whole budget, so closing returns nothing — it simply settles this milestone and frees the stream to open another.'),
    };
  }

  if (!health.reachable) {
    return {
      served: false,
      expected: false,
      title: 'The agent cannot be reached',
      detail:
        'Merged work will not be judged or paid until it is back. The stream is unaffected and keeps accruing — this is the agent being down, not the money.',
    };
  }

  if (health.agent && agentOnChain.toLowerCase() !== health.agent.toLowerCase()) {
    return {
      served: false,
      expected: false,
      title: 'Appointed a different agent',
      detail: `The contract names ${agentOnChain}; the agent here is ${health.agent}. An agent only signs for streams that appointed it, and the appointment is fixed at creation — so this stream will never be served.`,
    };
  }

  // Sharing a repository with other streams is NORMAL — a merged pull request
  // is judged against each one separately, against its own milestone and out of
  // its own budget. The only failure is crowding past the agent's bound, which
  // exists because every extra stream costs another inference call and another
  // verifier fee per merge.
  const alsoLive = allStreams.filter(
    (other) => other.repo.toLowerCase() === repo.toLowerCase() && other.state !== 'settled',
  );
  if (alsoLive.length > MAX_STREAMS_PER_REPO) {
    return {
      served: false,
      expected: false,
      title: 'Too many live streams on this repository',
      detail: `${alsoLive.length} streams watch ${repo}, and the agent judges at most ${MAX_STREAMS_PER_REPO} of them per merge — each one it takes on costs another inference call and another verifier fee. Close or repoint a finished stream and this resumes within a minute.`,
    };
  }

  return {
    served: false,
    expected: false,
    title: 'Not picked up yet',
    detail:
      'The agent re-reads the registry about once a minute. If this persists, the announcement transaction may never have landed — the stream would exist but have been registered nowhere.',
  };
}
