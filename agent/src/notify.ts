// ONE COMMENT ON THE PULL REQUEST, when a certification lands.
//
// The earner page exists and nobody is told about it. A contributor whose merge
// the agent accepted has money accruing and no signal, unless they already knew
// to look. The place they already are is the pull request, so that is where the
// notice goes.
//
// WHAT IT DELIBERATELY IS NOT. No amounts, no percentages, no verdict text, no
// second comment on the same pull request, ever. A bot that posts figures on
// other people's repositories is spam whatever it says, and a comment that
// names a sum is a claim the chain may have moved past by the time it is read.
//
// WHAT STOPS IT READING AS SPAM is that it is specific. A generic notice with
// two links is a bot however politely it is worded; the same notice that quotes
// the milestone this diff was actually judged against, and says what the agents
// did to reach it, is a record of something that happened.
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

/// Long enough for a real milestone, short enough that a comment stays a
/// comment. The stream page has the whole thing, and it is linked below.
const LIMIT = 400;

/// Where the milestone is wrapped. A fenced block does not soft-wrap, so a
/// milestone written as one long line gives the whole comment a horizontal
/// scrollbar, which is the one thing that would make it look thrown together.
const COLUMNS = 76;

/// The milestone, fenced.
///
/// A FENCE, NOT A QUOTE, because the employer writes this text and we post it
/// on somebody else's repository under our App's name. Inside a fence GitHub
/// renders it verbatim: no links, no images, no headings, nothing that could
/// turn our comment into someone else's message. The fence is made longer than
/// the longest run of backticks in the text, which is the only way out of one.
///
/// Wrapping is the ONLY thing done to the words. They are broken at spaces and
/// never rewritten, so the block still reads as the text that is on chain.
export function fenced(milestone: string): string {
  const trimmed = milestone.trim();
  const text = wrap(trimmed.length > LIMIT ? `${trimmed.slice(0, LIMIT).trimEnd()}…` : trimmed);
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}\n${text}\n${fence}`;
}

/// Break at spaces, keeping the author's own line breaks. A word longer than
/// the column count, such as a URL or a long identifier, is left whole rather
/// than cut in half, because a broken identifier reads as a different one.
function wrap(text: string): string {
  return text
    .split('\n')
    .map((line) =>
      line
        .split(/\s+/)
        .reduce<string[]>((out, word) => {
          const last = out[out.length - 1];
          if (last === undefined) return [word];
          return last.length + 1 + word.length > COLUMNS ? [...out, word] : [...out.slice(0, -1), `${last} ${word}`];
        }, [])
        .join('\n'),
    )
    .join('\n');
}

/// The comment. Pure, so the tests can hold it to the rules above.
///
/// ONE LINE PER PARAGRAPH. GitHub renders a single newline as a hard break, so
/// prose split across source lines keeps those breaks in the rendered comment
/// and will not reflow to the reader's width.
export function commentBody(streamAddress: string, milestone: string): string {
  return [
    MARKER,
    '### Certified on chain',
    '',
    "An agent read this diff, judged it against the milestone below, paid a second agent for an independent review, and signed the attestation that raised the contributor's claim on the stream. No human approved it.",
    '',
    fenced(milestone),
    '',
    'If you wrote this, the claim is yours to collect.',
    '',
    `**[Collect it](${env.appUrl}/earnings)** · [The stream](${env.appUrl}/stream/${streamAddress})`,
    '',
    '<sub>ProofStream · one comment per pull request. Nothing here asks you to sign or approve anything.</sub>',
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
export async function notifyCertified(
  log: Logger,
  repo: string,
  prNumber: number,
  streamAddress: string,
  milestone: string,
): Promise<void> {
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
      body: JSON.stringify({ body: commentBody(streamAddress, milestone) }),
    });
    if (!res.ok) throw new Error(`comment refused: ${res.status} ${(await res.text()).slice(0, 200)}`);
    const { html_url } = (await res.json()) as { html_url?: string };
    log({ event: 'notified', repo, pr: prNumber, workStream: streamAddress, url: html_url });
  } catch (err) {
    log({ event: 'notify_failed', repo, pr: prNumber, message: err instanceof Error ? err.message : String(err) });
  }
}
