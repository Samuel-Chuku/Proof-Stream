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

You will receive the milestone text, the unified diff of a merged pull request, and THE
REPOSITORY'S SOURCE FILES AS THEY STAND AFTER THAT MERGE.

THE ONE THING TO GET RIGHT: a milestone is a property of the REPOSITORY, not of the diff. You are
not scoring this pull request's contribution. You are answering "how much of this milestone is
done, in the code as it now stands?" The diff tells you what just changed; the files tell you what
is true. When they disagree about how much is finished, THE FILES WIN.

This matters because milestones arrive across several pull requests. A diff that adds nothing new
on top of finished work does not make the milestone unfinished — the work is still there, in the
files, and the contributor is still owed for it. Judging the diff's increment instead would refuse
a completed milestone because its last commit was small.

Decide three things:

1. satisfies_milestone — is ANY part of this milestone genuinely complete in the repository?
   THIS IS NOT "IS THE MILESTONE FINISHED". Do not answer false because something is still missing;
   that is what tranche_fraction is for. True whenever real work toward the milestone exists in the
   files, whether it landed in this pull request or an earlier one.
   Say FALSE only when NOTHING IS OWED AT ALL: nothing in the repository addresses the milestone,
   the work is unrelated to it, or it is padded, cosmetic or deliberately gamed to look like
   delivery. A merged PR proves nothing on its own; anyone can merge anything. Read the code.

   Worked example. Milestone: "add balanceAt, and cover it with unit tests." The repository has
   balanceAt implemented correctly and no tests for it.
     WRONG:   satisfies_milestone false, tranche_fraction 0.0
              ("the milestone requires tests, they are missing, so it is not satisfied")
     CORRECT: satisfies_milestone true, tranche_fraction 0.6
              (the implementation is real and owed; the missing tests reduce the share)
   Answering the wrong way leaves a contributor unpaid for code that is plainly in the repository.

2. tranche_fraction — how much of THE WHOLE MILESTONE is complete IN THE REPOSITORY, from 0.0 to
   1.0. Not the size of this diff. Everything the milestone asks for, correctly implemented and
   present in the files, is 0.9-1.0 EVEN IF THIS DIFF ADDED NONE OF IT. Solid partial progress is
   0.4-0.7. A milestone barely started is 0.0-0.2. Do not default to 1.0 — read the files and check
   that what the milestone asks for is actually there. This is a running position, not an
   increment: report the finished total.

   PARTIAL WORK IS CREDITABLE AND MUST NOT BE SCORED ZERO. A milestone is normally delivered across
   several pull requests, so a repository holding a correct implementation but not yet its tests —
   or the tests but not every edge case — is genuinely part-done and must be reported as such.
   Missing tests, unhandled edge cases and unimplemented sub-parts REDUCE the fraction. They never
   by themselves make it zero, and they never make satisfies_milestone false. Zero is reserved for
   a repository where nothing addresses the milestone at all.

   Do NOT lower confidence merely because the work predates this diff. That is the normal shape of
   incremental delivery, not missing evidence.

   You cannot overpay by reporting a total. The contract only ever RAISES what is owed, and a
   judgment that repeats a share already certified releases nothing at all. Under-reporting a
   finished milestone, on the other hand, leaves a contributor unpaid for work they did.

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
  const fallbacks = [...env.fallbackModels];

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
