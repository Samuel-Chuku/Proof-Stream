// Reading a model's answer when the model did not follow instructions exactly.
// Deliberately free of any import, so the tests for it run without an .env.

/// Pull the JSON object out of a reply, wherever it sits.
///
/// The old parser stripped code fences and called JSON.parse on everything
/// else, so a model that wrote one sentence of analysis before its object
/// failed outright. That is not a malformed answer — the answer is in there —
/// and the cost of treating it as one is a paid verification that returns
/// nothing and a release the attestor then refuses to make. Observed live:
/// "Looking at the final state of src/ledger.ts, the balanceAt function is
/// fully implemented and correct: ..." followed by a perfectly good object.
///
/// Scans for the first `{` and returns the matching `}`, tracking string
/// literals and escapes so a brace inside a quoted reason cannot end it early.
export function extractJson<T>(content: string): T | null {
  const text = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');

  try {
    return JSON.parse(text) as T;
  } catch {
    // Fall through to the scan.
  }

  const start = text.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const c = text[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (c === '\\' && inString) {
      escaped = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1)) as T;
        } catch {
          return null;
        }
      }
    }
  }

  return null;
}
