// The agent's own logs, read straight off disk. These are the same JSONL files
// the agents append to at runtime — the page shows their verbatim reasoning
// rather than a retelling of it.
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

/** Newest first — the feed reads top-down as most-recent-decision-first. */
export function readVerdicts(): AgentEvent[] {
  return readJsonl<AgentEvent>('agent/verdicts.jsonl').reverse();
}

export function readReviews(): Review[] {
  return readJsonl<Review>('agent/reviews.jsonl');
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
