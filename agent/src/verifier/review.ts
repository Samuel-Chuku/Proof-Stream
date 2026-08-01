import { VERIFIER_MAX_TOKENS } from '@proofstream/config';
import { env } from '../env';

export type Review = {
  satisfies_milestone: boolean;
  confidence: number; // 0-1
  tranche_fraction: number; // 0-1 of the policy's maxTranche
  reasoning: string;
  red_flags: string[];
};

export type ReviewResult = {
  review: Review;
  costUsd: number;
  model: string;
};

const MAX_DIFF_CHARS = 60_000;

// Deliberately NOT the attestor's prompt. The attestor asks "did this earn the
// money"; the auditor asks "would this survive scrutiny". Different question,
// different vendor's model, and it never sees the attestor's verdict — an
// opinion that has been shown the answer is not independent.
const SYSTEM_PROMPT = `You are an independent verification agent. A separate attestor agent is about to
release real money against the merged pull request below. You are paid per review to be the second
pair of eyes. You have NOT been told what the attestor concluded, and you should not try to guess it.

Your job is to answer, from the diff alone: would this release survive scrutiny from someone who
wanted to argue it was wrong?

Weigh these, in this order:

1. Evidence. Does the diff contain the claimed work, or only the appearance of it? Renamed symbols,
   restated comments, dead scaffolding, a function that is defined but never reachable, and tests
   that assert nothing are all appearance without substance. Judge what the code does, not what the
   title or description says it does.

2. Gaming. You are the control on a payer who is also the author's counterparty. Look specifically
   for work padded to look larger, milestone-adjacent changes that do not actually implement the
   milestone, logic that passes a check without satisfying its intent, and anything that would let
   the same work be submitted twice. Report these in red_flags even when you still approve.

3. Completeness against the milestone TEXT, not its topic. Partial work is normal and should be
   scored as partial, not rejected. Missing error handling, unhandled edge cases, and absent tests
   reduce the fraction; they do not by themselves make it zero.

Then report:

- satisfies_milestone: whether this diff genuinely implements what the milestone asks.
- tranche_fraction (0.0-1.0): the share of the tranche this work has earned. The attestor takes the
  LOWER of your number and its own, so this is a real cap on the payout, not advice. Complete and
  correct is 0.9-1.0; solid partial is 0.4-0.7; cosmetic or padded is 0.0-0.2.
- confidence (0.0-1.0): how certain you are. If the diff is truncated, the milestone is vague, or
  you cannot see enough context to judge correctness, say so with a LOW number. Low confidence
  blocks the release and escalates to a human, which is the safe outcome and costs nobody anything.

Do not approve merely because the pull request was merged. Whoever merged it is the party who pays.

Reply with ONLY a JSON object, no prose or code fences:
{"satisfies_milestone": boolean, "confidence": number, "tranche_fraction": number,
 "reasoning": "2-4 sentences citing specifics from the diff", "red_flags": ["..."]}`;

export async function review(
  prNumber: number,
  milestone: string,
  diff: string,
): Promise<ReviewResult> {
  const truncated =
    diff.length > MAX_DIFF_CHARS
      ? `${diff.slice(0, MAX_DIFF_CHARS)}\n\n[diff truncated at ${MAX_DIFF_CHARS} characters]`
      : diff;

  const userPrompt = `MILESTONE (read by this agent directly from the WorkStream contract, not supplied by the payer):
${milestone}

PULL REQUEST #${prNumber}
UNIFIED DIFF (fetched by this agent directly from GitHub, not supplied by the payer):
${truncated}`;

  const body: any = await callLlm(
    {
      model: env.verifierModel,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: VERIFIER_MAX_TOKENS,
      temperature: 0,
    },
    env.llmApiKey,
  );

  const choice = body.choices?.[0];
  const content: string = choice?.message?.content ?? '';
  const finishReason: string = choice?.finish_reason ?? 'unknown';

  const json = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let parsed: Review;
  try {
    parsed = JSON.parse(json);
  } catch {
    // finish_reason is the difference between "the model wrote nonsense" and
    // "we cut it off mid-sentence" — without it this looks like a bad prompt.
    throw new Error(
      `Review was not valid JSON (finish_reason=${finishReason}, ` +
        `${body.usage?.completion_tokens ?? '?'} completion tokens of which ` +
        `${body.usage?.completion_tokens_details?.reasoning_tokens ?? '?'} reasoning): ` +
        content.slice(0, 300),
    );
  }

  return {
    review: {
      satisfies_milestone: Boolean(parsed.satisfies_milestone),
      confidence: clamp01(parsed.confidence),
      tranche_fraction: clamp01(parsed.tranche_fraction),
      reasoning: String(parsed.reasoning ?? ''),
      red_flags: Array.isArray(parsed.red_flags) ? parsed.red_flags.map(String) : [],
    },
    costUsd: Number(body.usage?.cost ?? 0),
    model: body.model ?? env.verifierModel,
  };
}

function clamp01(n: unknown): number {
  const v = Number(n);
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}

/// Any OpenAI-compatible endpoint — see callLlm in verdict.ts. The verifier
/// reads the SAME LLM_BASE_URL but its own VERIFIER_MODEL, so a second opinion
/// can come from a different model on the same provider or, by pointing the
/// two processes at different .env values, a different provider entirely.
///
/// Free model pools are shared and return 429 under load. One retry with a
/// pause costs nothing and saves a long unattended run from dying.
async function callLlm(body: unknown, key: string): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    // A wrong LLM_BASE_URL fails at the socket, not with an HTTP status, so the
    // raw ECONNREFUSED/ENOTFOUND never mentions the endpoint. Name it — that is
    // the whole diagnosis when someone points this at a local model.
    let res: Response;
    try {
      res = await fetch(`${env.llmBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new Error(
        `LLM endpoint unreachable at ${env.llmBaseUrl} — ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (res.ok) return res.json();

    const text = await res.text();
    if (res.status === 429 && attempt < 3) {
      await new Promise((r) => setTimeout(r, 5_000 * 2 ** attempt));
      continue;
    }
    throw new Error(`LLM call failed (${env.llmBaseUrl}): ${res.status} ${text}`);
  }
}
