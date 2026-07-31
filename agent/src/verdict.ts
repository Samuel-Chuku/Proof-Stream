import { env } from './env';
import type { MergedPr } from './github';

export type Verdict = {
  satisfies_milestone: boolean;
  confidence: number; // 0-1
  tranche_fraction: number; // 0-1 of the policy's maxTranche
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

1. satisfies_milestone — does this diff actually implement what the milestone describes? A merged PR
   proves nothing on its own; anyone can merge anything. Read the code. A PR that only touches
   comments, docs, formatting, or tests unrelated to the milestone does NOT satisfy it.

2. tranche_fraction — how much of the available tranche this work has earned, from 0.0 to 1.0. This
   MUST vary with the substance of the work. Complete, correct implementation of everything the
   milestone asks for earns 0.9-1.0. Solid partial progress earns 0.4-0.7. A token or cosmetic
   change earns 0.0-0.2. Do not default to 1.0 — that would make this system a rubber stamp.

3. confidence — how certain you are in this judgment, from 0.0 to 1.0. Be honest. If the diff is
   ambiguous, if the milestone is vague, if you cannot see enough context to tell whether the code
   is correct, or if something looks deliberately gamed, report LOW confidence. Low confidence
   escalates to a human rather than releasing funds, which is the correct and safe outcome.

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

  const body: any = await callOpenRouter(
    {
      model: env.model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 1200,
      temperature: 0,
    },
    env.openRouterKey,
  );

  const content: string = body.choices?.[0]?.message?.content ?? '';

  // Models occasionally wrap JSON in fences despite instructions.
  const json = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let verdict: Verdict;
  try {
    verdict = JSON.parse(json);
  } catch {
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

/// Free model pools are shared and return 429 under load. One retry with a
/// pause costs nothing and saves a long unattended run from dying.
async function callOpenRouter(body: unknown, key: string): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) return res.json();

    const text = await res.text();
    if (res.status === 429 && attempt < 3) {
      await new Promise((r) => setTimeout(r, 5_000 * 2 ** attempt));
      continue;
    }
    throw new Error(`OpenRouter call failed: ${res.status} ${text}`);
  }
}
