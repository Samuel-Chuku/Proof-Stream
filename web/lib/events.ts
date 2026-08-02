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

/// One round trip for both logs. Verdicts come back newest-first, because the
/// feed reads top-down as most-recent-decision-first.
export async function readAgentLogs(): Promise<{ verdicts: AgentEvent[]; reviews: Review[] }> {
  const endpoint = process.env.AGENT_EVENTS_URL;

  if (endpoint) {
    try {
      const res = await fetch(endpoint, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { verdicts?: AgentEvent[]; reviews?: Review[] };
      return { verdicts: (body.verdicts ?? []).reverse(), reviews: body.reviews ?? [] };
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
