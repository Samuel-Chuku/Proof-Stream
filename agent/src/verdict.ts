import { AGENT_MAX_TOKENS, REASONING } from '@proofstream/config';
import { extractJson } from './json';
import { env } from './env';
import type { MergedPr } from './github';

export type Verdict = {
  /** Does this diff contain creditable work toward the milestone? NOT "is the
   *  milestone finished" — a milestone is delivered across several PRs and
   *  honest partial work must be creditable, or `tranche_fraction` could never
   *  express a partial position. False means the work earns nothing at all. */
  satisfies_milestone: boolean;
  confidence: number; // 0-1
  /** 0-1 of the WHOLE milestone completed, not of any per-release ceiling. */
  tranche_fraction: number;
  reasoning: string;
  concerns: string[];
};

export type VerdictResult = {
  verdict: Verdict;
  costUsd: number;
  model: string;
};

// Large diffs cost real money and add little signal past a point.
const MAX_DIFF_CHARS = 60_000;

const SYSTEM_PROMPT = `You are the attestor agent for ProofStream, a payroll system where a contributor's
salary accrues every second but stays locked until you certify that real work satisfied a specific
milestone. Your signature releases actual money. Judge accordingly.

You will receive the milestone text and the unified diff of a merged pull request.

Decide three things:

1. satisfies_milestone — does this diff contain GENUINE, CREDITABLE WORK toward the milestone? This
   is NOT "is the milestone finished". A milestone is normally delivered across several pull
   requests, and honest half-done work must be creditable as half — say true and report the partial
   position in tranche_fraction below.
   Say FALSE only when the work earns nothing: it is unrelated to the milestone, it only touches
   comments, docs or formatting, it is cosmetic or padded to look larger, it claims in its title or
   description something the diff does not do, or it appears deliberately gamed. A merged PR proves
   nothing on its own; anyone can merge anything. Read the code.

2. tranche_fraction — how much of THE WHOLE MILESTONE is complete once this work is counted, from
   0.0 to 1.0. Judge the milestone's total state, not the size of this one diff: this is a running
   position, so a later PR that finishes the job reports the finished total rather than its own
   increment. It MUST vary with the substance of the work. Everything the milestone asks for,
   correctly implemented, is 0.9-1.0. Solid partial progress is 0.4-0.7. A token or cosmetic change
   is 0.0-0.2. Do not default to 1.0 — that would make this system a rubber stamp.

   THE DIFF IS ONE INSTALMENT, NOT THE WHOLE STORY. Earlier pull requests against this milestone
   have already landed in the base branch, so parts of it may be finished and invisible here —
   visible only as unchanged context lines, or not at all. Judge the milestone's TOTAL state using
   the diff plus whatever the surrounding context shows, and credit work that is evidently already
   in place. Do NOT lower confidence merely because earlier instalments are not in this diff; that
   is the normal shape of incremental delivery, not missing evidence.

   This number sets what the contributor is owed: the contract pays out budget × tranche_fraction,
   released on the stream's schedule. It can only ever be raised by a later judgment, never lowered,
   so do not inflate it in the expectation of correcting it.

3. confidence — how certain you are IN THIS JUDGMENT, from 0.0 to 1.0. This is NOT how complete the
   work is: a diff you can clearly see is half done is a CONFIDENT judgment of 0.5, so report high
   confidence with a partial tranche_fraction. Lower it only when you genuinely cannot tell — the
   diff is truncated or unreadable, the milestone is vague, you cannot see enough context to judge
   correctness, or something looks deliberately gamed. Low confidence RELEASES NOTHING and stops,
   which is the correct and safe outcome — nobody is paid on a judgment you were unsure of.

Reply with ONLY a JSON object, no prose or code fences:
{"satisfies_milestone": boolean, "confidence": number, "tranche_fraction": number,
 "reasoning": "2-4 sentences citing specifics from the diff", "concerns": ["..."]}`;

export async function judge(pr: MergedPr, milestone: string, diff: string): Promise<VerdictResult> {
  const truncated =
    diff.length > MAX_DIFF_CHARS
      ? `${diff.slice(0, MAX_DIFF_CHARS)}\n\n[diff truncated at ${MAX_DIFF_CHARS} characters]`
      : diff;

  const userPrompt = `MILESTONE (current, read from the WorkStream contract):
${milestone}

PULL REQUEST #${pr.number} by ${pr.author}
Title: ${pr.title}
Description: ${pr.body || '(none)'}
Merge commit: ${pr.commitSha}

UNIFIED DIFF:
${truncated}`;

  const body: any = await callLlm(
    {
      model: env.model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: AGENT_MAX_TOKENS,
      // Omitted entirely: this provider REFUSES a request that tries to disable
      // reasoning, so sending the field guaranteed a 400 and a retry on every
      // call. AGENT_MAX_TOKENS is what bounds it now — see REASONING.
      reasoning: REASONING,
      temperature: 0,
    },
    env.llmApiKey,
  );

  const content: string = body.choices?.[0]?.message?.content ?? '';

  // Models wrap JSON in fences, and sometimes write a sentence of analysis
  // before it. Both are answers; only a reply with no object at all is not.
  const verdict = extractJson<Verdict>(content);
  if (verdict === null) {
    throw new Error(`Verdict was not valid JSON: ${content.slice(0, 300)}`);
  }

  return {
    verdict: {
      satisfies_milestone: Boolean(verdict.satisfies_milestone),
      confidence: clamp01(verdict.confidence),
      tranche_fraction: clamp01(verdict.tranche_fraction),
      reasoning: String(verdict.reasoning ?? ''),
      concerns: Array.isArray(verdict.concerns) ? verdict.concerns.map(String) : [],
    },
    costUsd: Number(body.usage?.cost ?? 0),
    model: body.model ?? env.model,
  };
}

function clamp01(n: unknown): number {
  const v = Number(n);
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}

/// Any OpenAI-compatible endpoint: OpenRouter, Ollama, Together, Groq, vLLM,
/// a local model. Only LLM_BASE_URL changes.
///
/// Free model pools are shared and return 429 under load. One retry with a
/// pause costs nothing and saves a long unattended run from dying.
async function callLlm(body: unknown, key: string): Promise<any> {
  // Sent as a PREFERENCE. Some endpoints refuse it outright —
  // `openai/gpt-oss-20b:free` answers 400 "Reasoning is mandatory for this
  // endpoint and cannot be disabled" — so a blanket demand breaks any model
  // that reasons by design. Dropped and retried once if refused.
  let payload: any = body;

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
    if (res.status === 429 && attempt < 3) {
      await new Promise((r) => setTimeout(r, 5_000 * 2 ** attempt));
      continue;
    }
    if (res.status === 400 && payload?.reasoning && /reasoning is mandatory/i.test(text)) {
      const { reasoning: _dropped, ...rest } = payload;
      payload = rest;
      continue;
    }
    throw new Error(`LLM call failed (${env.llmBaseUrl}): ${res.status} ${text}`);
  }
}
