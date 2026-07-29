import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from './env';

/// Verifies GitHub's HMAC over the raw body. Without this anyone who learns
/// the ingress URL could forge a merge event and trigger a payout.
export function verifySignature(rawBody: string, header: string | undefined): boolean {
  if (!header) return false;
  const expected = `sha256=${createHmac('sha256', env.webhookSecret).update(rawBody).digest('hex')}`;
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
  };
}

/// The raw unified diff — the actual evidence the agent judges (T5a).
export async function fetchDiff(prNumber: number): Promise<string> {
  const res = await fetch(`https://api.github.com/repos/${env.githubRepo}/pulls/${prNumber}`, {
    headers: {
      Authorization: `Bearer ${env.githubToken}`,
      Accept: 'application/vnd.github.v3.diff',
      'User-Agent': 'proofstream-attestor',
    },
  });
  if (!res.ok) throw new Error(`GitHub diff fetch failed: ${res.status} ${await res.text()}`);
  return res.text();
}
