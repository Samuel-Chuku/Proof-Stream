// CONSENT AND RATIONING, which are the two things email must get right.
// Nothing here reaches a provider. The env is fake and required only because
// agent/src/env.ts validates at import.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

Object.assign(process.env, {
  PROOFSTREAM_LOG_DIR: mkdtempSync(join(tmpdir(), 'ps-email-')),
  REGISTRY_ADDRESS: '0x0000000000000000000000000000000000000001',
  CIRCLE_API_KEY: 'x',
  ENTITY_SECRET: 'x',
  AGENT_WALLET_ID: 'x',
  AGENT_ADDRESS: '0x0000000000000000000000000000000000000002',
  GITHUB_TOKEN: 'x',
  GITHUB_WEBHOOK_SECRET: 'a-secret-that-signs-the-links',
  LLM_API_KEY: 'x',
  LLM_BASE_URL: 'https://example.invalid/v1',
  AGENT_MODEL: 'test/model',
  VERIFIER_MODEL: 'test/other-model',
  VERIFIER_ADDRESS: '0x0000000000000000000000000000000000000003',
  PUBLIC_APP_URL: 'https://app.example.test',
});

const { EMAIL_JUDGMENT_EVENTS, EMAIL_TIMED_KINDS, MAX_EMAILS_PER_STREAM, actOnToken, emailBody, emailSubject, emailWindowKey, looksLikeEmail, signToken, verifyToken } =
  await import('../src/email');
const { countEmailSubscribers, emailRecipients, emailSubscriptions, emailsSentToday, emailsSentTodayFor, foldEmails } =
  await import('../src/subscriptions');

const A = '0x26B8379cCB664f94fCAC4837D0FcB62136a8dcE8';
const EARNER = `0x${'ab'.repeat(32)}`;
const quiet = () => {};
const soon = () => Math.floor(Date.now() / 1000) + 3600;

// --- the token IS the pending state ------------------------------------------

test('a token round-trips, and its signature is what makes it ours', () => {
  const t = signToken('confirm', { kind: 'stream', id: A }, 'Ada@Example.com', soon());
  const out = verifyToken(t);
  assert.equal('error' in out, false);
  if ('error' in out) return;
  assert.equal(out.action, 'confirm');
  assert.equal(out.address, 'ada@example.com', 'addresses fold to lower case');
  assert.equal(out.target.id, A.toLowerCase());

  const tampered = t.replace(/\.[^.]+$/, '.notarealsignature');
  assert.ok('error' in verifyToken(tampered), 'a forged signature is refused');
});

test('an address with a dot in it survives the token, because it is encoded', () => {
  const t = signToken('confirm', { kind: 'earner', id: EARNER }, 'first.last@example.co.uk', soon());
  const out = verifyToken(t);
  assert.equal('error' in out ? '' : out.address, 'first.last@example.co.uk');
});

test('an expired link is refused, and says so', () => {
  const t = signToken('confirm', { kind: 'stream', id: A }, 'ada@example.com', Math.floor(Date.now() / 1000) - 1);
  const out = verifyToken(t);
  assert.ok('error' in out && /expired/.test(out.error));
});

test('addresses are checked before anything is signed', () => {
  assert.equal(looksLikeEmail('ada@example.com'), true);
  for (const bad of ['ada', 'ada@', '@example.com', 'ada example.com', `${'a'.repeat(250)}@example.com`]) {
    assert.equal(looksLikeEmail(bad), false, bad);
  }
});

// --- confirming, and the cap --------------------------------------------------

test('NOTHING IS STORED UNTIL THE LINK IS CLICKED', () => {
  signToken('confirm', { kind: 'stream', id: A }, 'stranger@example.com', soon());
  assert.equal(emailSubscriptions().length, 0, 'asking wrote nothing');

  const out = actOnToken(quiet, signToken('confirm', { kind: 'stream', id: A }, 'ada@example.com', soon()));
  assert.equal(out.ok, true);
  assert.equal(countEmailSubscribers(A), 1);
});

test('two addresses per stream, and the third is told plainly', () => {
  actOnToken(quiet, signToken('confirm', { kind: 'stream', id: A }, 'bob@example.com', soon()));
  assert.equal(countEmailSubscribers(A), MAX_EMAILS_PER_STREAM);
  const third = actOnToken(quiet, signToken('confirm', { kind: 'stream', id: A }, 'carol@example.com', soon()));
  assert.equal(third.ok, false);
  assert.ok(/full/i.test(third.title));
  assert.equal(countEmailSubscribers(A), MAX_EMAILS_PER_STREAM);
});

test('a stop link removes one subscription and nothing else', () => {
  const out = actOnToken(quiet, signToken('stop', { kind: 'stream', id: A }, 'bob@example.com', soon()));
  assert.equal(out.ok, true);
  assert.equal(countEmailSubscribers(A), 1);
  assert.equal(emailSubscriptions().some((s) => s.address === 'ada@example.com'), true);
});

test('an earner subscription reaches the streams that credit them', () => {
  actOnToken(quiet, signToken('confirm', { kind: 'earner', id: EARNER }, 'earner@example.com', soon()));
  const rows = emailRecipients(A, [EARNER]);
  assert.equal(rows.some((r) => r.address === 'earner@example.com'), true);
  assert.equal(emailRecipients(A, []).some((r) => r.address === 'earner@example.com'), false, 'a stream that never credited them says nothing');
});

// --- rationing ----------------------------------------------------------------

test('the coalescing window is one hour, and it is per hour of the clock', () => {
  const noon = Date.parse('2026-09-23T12:30:00Z');
  assert.equal(emailWindowKey(noon), emailWindowKey(noon + 20 * 60_000), 'same hour');
  assert.notEqual(emailWindowKey(noon), emailWindowKey(noon + 40 * 60_000), 'the next hour is a new window');
});

test("the day's count only counts today", () => {
  const rows = [
    { event: 'emailed', at: '2026-09-23T01:00:00.000Z' },
    { event: 'emailed', at: '2026-09-23T02:00:00.000Z' },
    { event: 'emailed', at: '2026-09-22T23:59:00.000Z' },
    { event: 'subscribed', at: '2026-09-23T03:00:00.000Z' },
  ];
  assert.equal(emailsSentToday(rows, '2026-09-23'), 2);
});

test('EMAIL SAYS LESS THAN TELEGRAM, deliberately', () => {
  assert.deepEqual([...EMAIL_TIMED_KINDS].sort(), ['ended', 'ends-12h', 'ends-24h']);
  assert.deepEqual([...EMAIL_JUDGMENT_EVENTS].sort(), ['declined', 'unlocked']);
  for (const noisy of ['grace-1h', 'grace-2h', 'closable']) {
    assert.equal(EMAIL_TIMED_KINDS.has(noisy), false, `${noisy} is Telegram's alone`);
  }
  for (const noisy of ['vetoed', 'escalated', 'unlock_failed']) {
    assert.equal(EMAIL_JUDGMENT_EVENTS.has(noisy), false, `${noisy} is Telegram's alone`);
  }
});

test('the fold is per address AND per target', () => {
  const rows = [
    { event: 'subscribed', channel: 'email', address: 'ada@example.com', stream: A },
    { event: 'subscribed', channel: 'email', address: 'ada@example.com', earner: EARNER },
    { event: 'unsubscribed', channel: 'email', address: 'ada@example.com', stream: A },
  ];
  const live = foldEmails(rows);
  assert.equal(live.length, 1);
  assert.equal(live[0].earner, EARNER.toLowerCase());
});

// --- the two ceilings ---------------------------------------------------------
//
// They answer different failures. The fleet-wide one keeps a free sending tier
// intact. The per-stream one is what stops one busy stream spending the day's
// whole budget and leaving every other stream's deadline unannounced.

test("a stream's own sends are counted apart from the fleet's", () => {
  const rows = [
    { event: 'emailed', at: '2026-09-23T01:00:00.000Z', stream: A },
    { event: 'emailed', at: '2026-09-23T02:00:00.000Z', stream: A },
    { event: 'emailed', at: '2026-09-23T03:00:00.000Z', stream: '0xF5Ee20FbB318eFeC036276791F207D086C09B386' },
    { event: 'emailed', at: '2026-09-22T23:00:00.000Z', stream: A },
  ];
  assert.equal(emailsSentToday(rows, '2026-09-23'), 3, 'the fleet sent three today');
  assert.equal(emailsSentTodayFor(A, rows, '2026-09-23'), 2, 'this stream sent two of them');
  assert.equal(emailsSentTodayFor(A.toLowerCase(), rows, '2026-09-23'), 2, 'addresses match case-insensitively');
});

// --- what an email actually says ----------------------------------------------

test('the subject names the repository, because an inbox holds several streams', () => {
  assert.equal(emailSubject('ends-24h', 'owner/repo'), 'ProofStream: 24 hours left · owner/repo');
  assert.equal(emailSubject('unlocked', 'owner/repo'), 'ProofStream: work certified · owner/repo');
  assert.ok(!emailSubject('ends-24h').includes('·'), 'a stream with no repo still has a subject');
});

test('the body says what happened, which stream, where to look, and how to stop', () => {
  const body = emailBody({
    sentence: 'Certified: PR #4 brings the milestone to 50%.',
    repo: 'owner/repo',
    milestoneIndex: 2,
    link: 'https://app.example.test/stream/0xabc',
    because: 'this stream',
    stopUrl: 'https://app.example.test/alerts/confirm?t=tok',
  });
  const lines = body.split('\n');
  assert.equal(lines[0], 'Certified: PR #4 brings the milestone to 50%.', 'the news comes first');
  assert.ok(body.includes('owner/repo · milestone 2'), 'which stream');
  assert.ok(body.includes('https://app.example.test/stream/0xabc'), 'where to look');
  assert.ok(/because somebody confirmed alerts about this stream/.test(body), 'why it arrived');
  assert.ok(body.includes('Stop them: https://app.example.test/alerts/confirm?t=tok'), 'the way out');
  assert.ok(!/<[a-z]/i.test(body), 'plain text, no markup');
});
