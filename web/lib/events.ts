// The agents' own logs — the page shows their verbatim reasoning rather than a
// retelling of it.
//
// Two sources, because the web app and the agent no longer share a machine:
// AGENT_EVENTS_URL fetches them from the agent's read-only /events endpoint,
// which is how this works in production. With it unset the files are read off
// disk, so a local checkout still renders without running an agent.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type AgentEvent = {
  at: string;
  event: string;
  /** Which contract this judgment was made against. One agent serves many
   *  streams, so a per-stream page MUST filter on this or it shows another
   *  employer's decisions. */
  workStream?: string;
  repo?: string;
  pr: number;
  title?: string;
  milestone?: string;
  model?: string;
  inferenceCostUsd?: number;
  reason?: string;
  verdict?: {
    satisfies_milestone: boolean;
    confidence: number;
    tranche_fraction: number;
    reasoning: string;
    concerns: string[];
  };
  verifier?: {
    model: string;
    satisfies_milestone: boolean;
    confidence: number;
    tranche_fraction: number;
    reasoning: string;
    red_flags: string[];
  };
  verificationFeeUsdc?: string;
  gatewayTransfer?: string;
  agreedFraction?: number;
  trancheUsdc?: string;
  txHash?: string;
  explorer?: string;
};

export type Review = {
  at: string;
  event: string;
  /** Which stream the review was bought for. The verifier records this, and a
   *  per-stream page MUST filter on it — the log is fleet-wide. */
  workStream?: string;
  pr: number;
  inferenceCostUsd?: number;
  feeUsdc?: string;
  gatewayTransfer?: string;
};

function readJsonl<T>(relative: string): T[] {
  try {
    const raw = readFileSync(join(process.cwd(), '..', relative), 'utf8');
    return raw
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as T;
        } catch {
          return null;
        }
      })
      .filter((x): x is T => x !== null);
  } catch {
    return [];
  }
}

/// Bounding the payload did not help: the cost is the round trip to the agent
/// through the tunnel, not the bytes. So cache it briefly instead. Verdicts
/// arrive minutes apart at best — a merged PR has to be judged first — so a few
/// seconds of staleness is invisible, while the saving is a second per view.
let logsCache: { at: number; value: { verdicts: AgentEvent[]; reviews: Review[] } } | null = null;
const LOGS_TTL_MS = 15_000;

/// One round trip for both logs. Verdicts come back newest-first, because the
/// feed reads top-down as most-recent-decision-first.
export async function readAgentLogs(): Promise<{ verdicts: AgentEvent[]; reviews: Review[] }> {
  const endpoint = process.env.AGENT_EVENTS_URL;

  if (endpoint) {
    if (logsCache && Date.now() - logsCache.at < LOGS_TTL_MS) return logsCache.value;
    try {
      // Bounded: the feed shows recent decisions, and the full log is 300KB+
      // of JSON that costs a second on every page view to transfer and parse.
      const url = new URL(endpoint);
      if (!url.searchParams.has('limit')) url.searchParams.set('limit', '120');
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { verdicts?: AgentEvent[]; reviews?: Review[] };
      const value = { verdicts: (body.verdicts ?? []).reverse(), reviews: body.reviews ?? [] };
      logsCache = { at: Date.now(), value };
      return value;
    } catch {
      // A dashboard that 500s because the agent is briefly unreachable is worse
      // than one that renders the chain state with an empty feed.
      return { verdicts: [], reviews: [] };
    }
  }

  return {
    verdicts: readJsonl<AgentEvent>('agent/verdicts.jsonl').reverse(),
    reviews: readJsonl<Review>('agent/reviews.jsonl'),
  };
}

/** What the agent has spent to earn the right to move money. */
export function totalSpend(verdicts: AgentEvent[], reviews: Review[]) {
  const attestorInference = verdicts.reduce((s, v) => s + (v.inferenceCostUsd ?? 0), 0);
  const verifierInference = reviews.reduce((s, r) => s + (r.inferenceCostUsd ?? 0), 0);
  const verificationFees = verdicts.reduce((s, v) => s + Number(v.verificationFeeUsdc ?? 0), 0);
  return {
    attestorInference,
    verifierInference,
    verificationFees,
    paidReviews: reviews.filter((r) => r.gatewayTransfer).length,
    total: attestorInference + verifierInference + verificationFees,
  };
}
