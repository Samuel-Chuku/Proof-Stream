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
  };
}

/// The raw unified diff — the actual evidence the agent judges (T5a). `repo`
/// comes from the stream's on-chain `repo()`, never from this process's env:
/// the employer decides what their agent watches.
export async function fetchDiff(repo: string, prNumber: number): Promise<string> {
  const res = await fetch(`https://api.github.com/repos/${repo}/pulls/${prNumber}`, {
    headers: {
      Authorization: `Bearer ${env.githubToken}`,
      Accept: 'application/vnd.github.v3.diff',
      'User-Agent': 'proofstream-attestor',
    },
  });
  if (!res.ok) throw new Error(`GitHub diff fetch failed: ${res.status} ${await res.text()}`);
  return res.text();
}
