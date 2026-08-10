import { VERIFIER_MAX_TOKENS, REASONING } from '@proofstream/config';
import { extractJson } from '../json';
import { env } from '../env';

export type Review = {
  /** Creditable work toward the milestone, NOT milestone completion. A false
   *  here vetoes the release outright, so it must mean "this earns nothing". */
  satisfies_milestone: boolean;
  confidence: number; // 0-1
  /** 0-1 of the WHOLE milestone completed. */
  tranche_fraction: number;
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

Your job is to answer, from the diff alone: how much of this milestone has genuinely been delivered,
and would that valuation survive scrutiny from someone who wanted to argue it was too generous?

A milestone is normally delivered across several pull requests. You are pricing the work, not
signing off a finished project — so INCOMPLETE IS NOT A REJECTION. Incompleteness belongs in
tranche_fraction and nowhere else.

Weigh these, in this order:

1. Evidence. Does the diff contain the claimed work, or only the appearance of it? Renamed symbols,
   restated comments, dead scaffolding, a function that is defined but never reachable, and tests
   that assert nothing are all appearance without substance. Judge what the code does, not what the
   title or description says it does.

2. Gaming. You are the control on a payer who is also the author's counterparty. Look specifically
   for work padded to look larger, milestone-adjacent changes that do not actually implement the
   milestone, logic that passes a check without satisfying its intent, and anything that would let
   the same work be submitted twice. Report these in red_flags even when you still approve.

3. Completeness against the milestone TEXT, not its topic — and completeness OF THE REPOSITORY, not
   of the diff. You are given the source files as they stand after this merge. The fraction is how
   much of the milestone those FILES satisfy, whether the work landed in this pull request or an
   earlier one. A small diff on top of finished work is a finished milestone, and scoring it as
   incomplete would refuse a contributor payment for work plainly present in the code.
   Partial work is normal and should be scored as partial, not rejected. Missing error handling,
   unhandled edge cases, absent tests and unimplemented parts of the milestone REDUCE THE FRACTION.
   They never make satisfies_milestone false and they do not by themselves make the fraction zero.

Then report:

- satisfies_milestone: does this diff contain GENUINE, CREDITABLE WORK toward the milestone? Read
  it as "does this earn anything at all", NOT "is the milestone finished". Answering false vetoes
  the release outright and pays the contributor nothing, so reserve it for work that deserves
  nothing: unrelated to the milestone, cosmetic, docs-only, padded to look larger, deliberately
  gamed, or claiming in its title what the diff does not do.
  Half-finished work that does what it says is TRUE with a fraction near 0.5. If your reasoning is
  "it does X but not yet Y", that is true with a partial fraction — never false.
- tranche_fraction (0.0-1.0): how much of THE WHOLE MILESTONE is complete once this work is counted
  — the milestone's total state, not the size of this one diff. The attestor takes the LOWER of your
  number and its own, and the contract pays the contributor budget × that number on the stream's
  schedule, so this is a real cap on the payout, not advice. Complete and correct is 0.9-1.0; solid
  partial is 0.4-0.7; cosmetic or padded is 0.0-0.2.
- confidence (0.0-1.0): how certain you are IN YOUR JUDGMENT — not how complete the work is. Work
  you can clearly see is half done is a CONFIDENT judgment of a partial fraction, so report high
  confidence with a low tranche_fraction. Lower it only when you genuinely cannot tell: the diff is
  truncated, the milestone is vague, or you cannot see enough context to judge correctness. Low
  confidence blocks the release outright, which is the safe outcome and costs nobody anything.

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
      // Omitted entirely: this provider REFUSES a request that tries to disable
      // reasoning, so sending the field guaranteed a 400 and a retry on every
      // call. VERIFIER_MAX_TOKENS is what bounds it now — see REASONING.
      reasoning: REASONING,
      temperature: 0,
    },
    env.llmApiKey,
  );

  const choice = body.choices?.[0];
  const content: string = choice?.message?.content ?? '';
  const finishReason: string = choice?.finish_reason ?? 'unknown';

  let parsed: Review | null = extractJson<Review>(content);
  if (parsed === null) {
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

/// How long the provider asked us to wait, in ms. OpenRouter puts it in the
/// Retry-After header and again inside the error body; either will do.
function retryAfterMs(res: Response, body: string): number {
  const header = Number(res.headers.get('retry-after'));
  if (Number.isFinite(header) && header > 0) return header * 1000;
  const m = body.match(/"retry_after_seconds"\s*:\s*(\d+)/);
  return m ? Number(m[1]) * 1000 : 0;
}

async function callLlm(body: unknown, key: string): Promise<any> {
  // Sent as a PREFERENCE. Some endpoints refuse it outright —
  // `openai/gpt-oss-20b:free` answers 400 "Reasoning is mandatory for this
  // endpoint and cannot be disabled" — so a blanket demand breaks any model
  // that reasons by design. Dropped and retried once if refused.
  let payload: any = body;
  // Copied so a fallback consumed on one call does not shrink the next call's list.
  const fallbacks = [...env.verifierFallbackModels];

  for (let attempt = 0; ; attempt++) {
    // A wrong LLM_BASE_URL fails at the socket, not with an HTTP status, so the
    // raw ECONNREFUSED/ENOTFOUND never mentions the endpoint. Name it — that is
    // the whole diagnosis when someone points this at a local model.
    let res: Response;
    try {
      res = await fetch(`${env.llmBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      throw new Error(
        `LLM endpoint unreachable at ${env.llmBaseUrl} — ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    // A 200 is not a promise of a body. Providers under load return an empty
    // 200, and `res.json()` then throws "Unexpected end of JSON input" — which
    // reads like a bad prompt and is actually a transient blip worth retrying.
    // Worth handling rather than tolerating: x402 settles the verifier's fee
    // BEFORE the handler runs, so every one of these is paid for and returns
    // nothing.
    if (res.ok) {
      const raw = await res.text();
      if (raw.trim()) {
        let parsedBody: any;
        try {
          parsedBody = JSON.parse(raw);
        } catch {
          throw new Error(
            `LLM returned ${res.status} with an unparseable body (${env.llmBaseUrl}): ${raw.slice(0, 200)}`,
          );
        }
        // A WELL-FORMED 200 CARRYING NO ANSWER. The model spends its budget
        // reasoning and emits nothing, so `content` is ''. That is not a bad
        // prompt and not a bad model — it is a blip, and treating it as fatal
        // blocked a payout on PR #9 with the message "Verdict was not valid
        // JSON:" and nothing after the colon. Retry it like any other blip.
        const answered = (parsedBody?.choices?.[0]?.message?.content ?? '').trim();
        if (!answered && attempt < 3) {
          await new Promise((r) => setTimeout(r, 2_000 * 2 ** attempt));
          continue;
        }
        return parsedBody;
      }
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, 2_000 * 2 ** attempt));
        continue;
      }
      throw new Error(
        `LLM returned an empty 200 from ${env.llmBaseUrl} after ${attempt + 1} attempts — the provider accepted the request and sent no body`,
      );
    }

    const text = await res.text();

    // RATE LIMITED. The free pools are shared across every OpenRouter user, so
    // this says nothing about our usage and everything about who else is busy.
    //
    // Honour the provider's own Retry-After when it sends one. It told us 24
    // seconds and the old fixed backoff waited 5, then 10, then 20 — three
    // requests that could not possibly succeed, and then a hard failure that
    // cost a stream its judgment.
    if (res.status === 429) {
      const after = retryAfterMs(res, text);
      if (attempt < 3 && after <= 60_000) {
        await new Promise((r) => setTimeout(r, after || 5_000 * 2 ** attempt));
        continue;
      }
      // Still limited after backing off: move to the next model rather than
      // give up. A judgment from a different model beats no judgment at all.
      const next = fallbacks.shift();
      if (next) {
        payload = { ...payload, model: next };
        attempt = -1; // fresh budget for the new model
        continue;
      }
    }
    if (res.status === 400 && payload?.reasoning && /reasoning is mandatory/i.test(text)) {
      const { reasoning: _dropped, ...rest } = payload;
      payload = rest;
      continue;
    }
    throw new Error(`LLM call failed (${env.llmBaseUrl}): ${res.status} ${text}`);
  }
}
