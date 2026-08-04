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

export type Coverage =
  | { served: true }
  | { served: false; expected: true; title: string; detail: string }
  | { served: false; expected: false; title: string; detail: string };

/// Why this stream is not being watched, in terms the reader can act on.
///
/// `expected: true` means the silence is correct and needs no alarm — a settled
/// milestone is finished, so of course nobody is watching it.
export function diagnose(
  address: string,
  repo: string,
  settled: boolean,
  agentOnChain: string,
  health: AgentHealth,
  allStreams: StreamSummary[],
): Coverage {
  if (health.serving.has(address.toLowerCase())) return { served: true };

  if (settled) {
    return {
      served: false,
      expected: true,
      title: 'Finished — the agent has stopped watching',
      detail: 'Open a new milestone to put this stream back to work.',
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

  // Another LIVE stream on the same repository — the ambiguity the agent
  // refuses to guess its way through.
  const rivals = allStreams.filter(
    (s) =>
      s.address.toLowerCase() !== address.toLowerCase() &&
      s.repo.toLowerCase() === repo.toLowerCase() &&
      s.state !== 'settled',
  );
  if (rivals.length > 0) {
    return {
      served: false,
      expected: false,
      title: 'Another stream claims this repository',
      detail: `${rivals.map((r) => r.address).join(' and ')} also watches ${repo}. Rather than guess which one a merged pull request should pay, the agent serves neither. Close or repoint one and this resumes within a minute.`,
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
