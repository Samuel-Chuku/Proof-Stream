import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from './env';

/// Each stream gets its OWN webhook secret, derived rather than stored.
///
/// One endpoint cannot serve many repos under one shared secret: every employer
/// would hold a key that forges events for every other employer's stream. The
/// obvious fix is a secrets table, but deriving them means there is no table to
/// leak, no migration, and no state to keep in sync — the agent can always
/// recompute a stream's secret from the master and the address alone.
///
/// GITHUB_WEBHOOK_SECRET is therefore a MASTER secret. It must never be handed
/// to an employer; give them the output of this function for their stream.
export function webhookSecretFor(streamAddress: string): string {
  return createHmac('sha256', env.webhookSecret).update(streamAddress.toLowerCase()).digest('hex');
}

/// Verifies GitHub's HMAC over the raw body. Without this anyone who learns
/// the ingress URL could forge a merge event and trigger a payout.
export function verifySignature(
  rawBody: string,
  header: string | undefined,
  secret: string = env.webhookSecret,
): boolean {
  if (!header) return false;
  const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(header);
  return a.length === b.length && timingSafeEqual(a, b);
}

export type MergedPr = {
  number: number;
  title: string;
  body: string;
  commitSha: string;
  author: string;
  /** `owner/name` the event came from, checked against the stream's on-chain
   *  repo so one agent can serve many streams without crossing wires. */
  repo?: string;
  /** The branch this was merged INTO. Checked against the branch named in the
   *  stream's on-chain repo spec — a merge into anything else is not work the
   *  employer accepted. Undefined means we could not read it, which fails
   *  closed rather than open. */
  baseBranch?: string;
};

/// Extracts what we need from a `pull_request` event, or null if it is not a
/// merge we should act on (opened, closed-without-merge, etc.).
export function parseMergedPr(payload: any): MergedPr | null {
  if (payload?.action !== 'closed' || !payload?.pull_request?.merged) return null;
  const pr = payload.pull_request;
  return {
    number: pr.number,
    title: pr.title ?? '',
    body: pr.body ?? '',
    commitSha: pr.merge_commit_sha ?? pr.head?.sha ?? '',
    author: pr.user?.login ?? 'unknown',
    repo: payload?.repository?.full_name,
    baseBranch: pr.base?.ref,
  };
}

/// How much file content to attach alongside the diff. Whole files are small in
/// the repos this judges; the cap is a guard against someone pointing it at a
/// vendored bundle, not an expected limit.
const MAX_FILE_CHARS = 24_000;

const gh = (path: string, accept = 'application/vnd.github+json') =>
  fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${env.githubToken}`,
      Accept: accept,
      'User-Agent': 'proofstream-attestor',
    },
  });

/// The evidence the agents judge (T5a): the unified diff, plus the FULL current
/// content of every file it touched. `repo` comes from the stream's on-chain
/// `repo()`, never from this process's env — the employer decides what their
/// agent watches.
///
/// Why the whole file and not just the diff: `tranche_fraction` asks how much of
/// the MILESTONE is complete, and a milestone is delivered across several pull
/// requests. Earlier instalments are already in the base branch, so a diff of
/// the last one shows only the last slice — the agents were being asked a
/// cumulative question while shown an incremental answer. Measured on a real
/// two-part milestone: from the diff alone the verifier scored a finished
/// milestone 0.55 and said outright it could not see the earlier work; the
/// final state makes that verifiable instead of guessable.
export async function fetchDiff(repo: string, prNumber: number): Promise<string> {
  const res = await gh(`/repos/${repo}/pulls/${prNumber}`, 'application/vnd.github.v3.diff');
  if (!res.ok) throw new Error(`GitHub diff fetch failed: ${res.status} ${await res.text()}`);
  const diff = await res.text();

  // Best-effort. The diff alone is still a judgeable answer, so a failure here
  // degrades the evidence rather than blocking a payout.
  let context = '';
  try {
    const filesRes = await gh(`/repos/${repo}/pulls/${prNumber}/files?per_page=50`);
    if (filesRes.ok) {
      const files = (await filesRes.json()) as { filename: string; status: string }[];
      for (const f of files) {
        if (f.status === 'removed') continue;
        const raw = await gh(
          `/repos/${repo}/contents/${encodeURI(f.filename)}`,
          'application/vnd.github.raw',
        );
        if (!raw.ok) continue;
        const body = await raw.text();
        context +=
          `\n----- ${f.filename} (current contents after the merge) -----\n` +
          (body.length > MAX_FILE_CHARS
            ? `${body.slice(0, MAX_FILE_CHARS)}\n[truncated at ${MAX_FILE_CHARS} characters]`
            : body);
      }
    }
  } catch {
    // Leave `context` empty and judge on the diff alone.
  }

  return context
    ? `${diff}\n\n===== FILES AFTER THIS MERGE =====\nThe milestone is judged on this FINAL STATE. ` +
        `Work from earlier pull requests appears here even though it is not in the diff above.\n${context}`
    : diff;
}
