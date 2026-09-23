// ONE COMMENT ON THE PULL REQUEST, when a certification lands.
//
// The earner page exists and nobody is told about it. A contributor whose merge
// the agent accepted has money accruing and no signal, unless they already knew
// to look. The place they already are is the pull request, so that is where the
// one sentence goes.
//
// WHAT IT DELIBERATELY IS NOT. No amounts, no percentages, no verdict text, no
// second comment on the same pull request, ever. A bot that posts figures on
// other people's repositories is spam whatever it says, and a comment that
// names a sum is a claim the chain may have moved past by the time it is read.
// The comment says one thing: there may be something to collect, here.
//
// POSTED AS THE APP, never as a person. The read token in GITHUB_TOKEN belongs
// to a human account, and a comment from it would put words in their mouth.
// An installation token signs as `<app>[bot]`, which is what this is. That
// needs the App to hold Pull requests: write, which is one permission change
// in GitHub's console; until then GitHub answers 403 and this logs it once.
import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { env } from './env';

type Logger = (entry: Record<string, unknown>) => void;

/// Hidden in the body, and what keeps this to one comment per pull request:
/// before posting, the existing comments are read and any that carries it
/// means we have already spoken.
export const MARKER = '<!-- proofstream:certified -->';

/// The comment. Pure, so the tests can hold it to the rules above.
export function commentBody(streamAddress: string): string {
  return [
    MARKER,
    'This pull request was certified against a ProofStream milestone. If you wrote it, there may be something for you to collect.',
    '',
    `Collect it: ${env.appUrl}/earnings`,
    `The stream: ${env.appUrl}/stream/${streamAddress}`,
    '',
    '_Posted once per pull request. Nothing here asks for a signature or an approval._',
  ].join('\n');
}

/// A signed App JWT, good for ten minutes. RS256 over `header.payload`, no
/// library: node's crypto does the signing and base64url is a string encoding.
export function appJwt(appId: string, privateKeyPem: string, now = Math.floor(Date.now() / 1000)): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  // Issued a minute in the past, because GitHub rejects a token whose clock is
  // ahead of theirs, and clocks drift.
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iat: now - 60, exp: now + 540, iss: appId })}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(privateKeyPem, 'base64url');
  return `${unsigned}.${signature}`;
}

/// Whether any of these comments is ours.
export function alreadyCommented(comments: { body?: string | null }[]): boolean {
  return comments.some((c) => typeof c.body === 'string' && c.body.includes(MARKER));
}

const API = 'https://api.github.com';
const headers = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'proofstream-attestor',
});

/// An installation token for one repository, cached until shortly before it
/// expires. One per repository, because installations are per account.
const tokens = new Map<string, { token: string; until: number }>();

async function installationToken(repo: string): Promise<string> {
  const hit = tokens.get(repo);
  if (hit && Date.now() < hit.until) return hit.token;

  const pem = readFileSync(env.githubAppPrivateKeyPath as string, 'utf8');
  const jwt = appJwt(env.githubAppId as string, pem);

  const inst = await fetch(`${API}/repos/${repo}/installation`, { headers: headers(jwt) });
  if (!inst.ok) throw new Error(`no installation for ${repo}: ${inst.status}`);
  const { id } = (await inst.json()) as { id: number };

  const res = await fetch(`${API}/app/installations/${id}/access_tokens`, {
    method: 'POST',
    headers: headers(jwt),
    // Only what the comment needs. A token that could do more is a token
    // that could be misused more.
    body: JSON.stringify({ repositories: [repo.split('/')[1]], permissions: { pull_requests: 'write' } }),
  });
  if (!res.ok) throw new Error(`installation token refused: ${res.status} ${await res.text()}`);
  const { token, expires_at } = (await res.json()) as { token: string; expires_at: string };
  tokens.set(repo, { token, until: Date.parse(expires_at) - 60_000 });
  return token;
}

let saidNotConfigured = false;

/// Leave the comment, once. Never throws: a failed comment is a log line, not
/// a failed certification, and the certification has already happened.
export async function notifyCertified(log: Logger, repo: string, prNumber: number, streamAddress: string): Promise<void> {
  if (!env.notifyGithub) return;
  if (!env.githubAppId || !env.githubAppPrivateKeyPath) {
    if (!saidNotConfigured) {
      saidNotConfigured = true;
      log({ event: 'notify_skipped', reason: 'GITHUB_APP_ID or GITHUB_APP_PRIVATE_KEY_PATH is not set; no comment is posted on certified pull requests' });
    }
    return;
  }

  try {
    const token = await installationToken(repo);
    const existing = await fetch(`${API}/repos/${repo}/issues/${prNumber}/comments?per_page=100`, { headers: headers(token) });
    if (!existing.ok) throw new Error(`could not read comments: ${existing.status}`);
    if (alreadyCommented((await existing.json()) as { body?: string }[])) {
      log({ event: 'notify_skipped', repo, pr: prNumber, reason: 'already commented on this pull request' });
      return;
    }

    const res = await fetch(`${API}/repos/${repo}/issues/${prNumber}/comments`, {
      method: 'POST',
      headers: { ...headers(token), 'content-type': 'application/json' },
      body: JSON.stringify({ body: commentBody(streamAddress) }),
    });
    if (!res.ok) throw new Error(`comment refused: ${res.status} ${(await res.text()).slice(0, 200)}`);
    const { html_url } = (await res.json()) as { html_url?: string };
    log({ event: 'notified', repo, pr: prNumber, workStream: streamAddress, url: html_url });
  } catch (err) {
    log({ event: 'notify_failed', repo, pr: prNumber, message: err instanceof Error ? err.message : String(err) });
  }
}
