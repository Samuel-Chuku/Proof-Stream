// WHO IS TOLD, AND WHEN. The subscription fold and the alert clock are pure
// and are pinned here; nothing reaches Telegram. The env is fake and required
// only because agent/src/env.ts validates at import.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

Object.assign(process.env, {
  PROOFSTREAM_LOG_DIR: mkdtempSync(join(tmpdir(), 'ps-alerts-')),
  REGISTRY_ADDRESS: '0x0000000000000000000000000000000000000001',
  CIRCLE_API_KEY: 'x',
  ENTITY_SECRET: 'x',
  AGENT_WALLET_ID: 'x',
  AGENT_ADDRESS: '0x0000000000000000000000000000000000000002',
  GITHUB_TOKEN: 'x',
  GITHUB_WEBHOOK_SECRET: 'x',
  LLM_API_KEY: 'x',
  LLM_BASE_URL: 'https://example.invalid/v1',
  AGENT_MODEL: 'test/model',
  VERIFIER_MODEL: 'test/other-model',
  VERIFIER_ADDRESS: '0x0000000000000000000000000000000000000003',
  PUBLIC_APP_URL: 'https://app.example.test',
});

const { alertsSent, fold, subscribe, subscriptions, unsubscribe } = await import('../src/subscriptions');
const { dueAlerts, judgmentText, timedAlerts } = await import('../src/alerts');
const { reply } = await import('../src/telegram');

const A = '0x26B8379cCB664f94fCAC4837D0FcB62136a8dcE8';
const B = '0xF5Ee20FbB318eFeC036276791F207D086C09B386';
const H = 3600;

// --- subscriptions ---------------------------------------------------------------

test('subscribe, then unsubscribe from one, then from all', () => {
  const rows = [
    { event: 'subscribed', channel: 'telegram', chatId: '7', stream: A },
    { event: 'subscribed', channel: 'telegram', chatId: '7', stream: B },
    { event: 'subscribed', channel: 'telegram', chatId: '8', stream: A },
  ];
  assert.equal(fold(rows).length, 3);
  assert.equal(fold([...rows, { event: 'unsubscribed', channel: 'telegram', chatId: '7', stream: A }]).length, 2);
  const left = fold([...rows, { event: 'unsubscribed', channel: 'telegram', chatId: '7', stream: '*' }]);
  assert.deepEqual(left.map((s) => s.chatId), ['8']);
});

test('subscribing twice is one subscription, and addresses fold case-insensitively', () => {
  const rows = [
    { event: 'subscribed', channel: 'telegram', chatId: '7', stream: A },
    { event: 'subscribed', channel: 'telegram', chatId: '7', stream: A.toLowerCase() },
  ];
  assert.equal(fold(rows).length, 1);
});

test('the ledger round-trips through the real file', () => {
  subscribe('9', A);
  assert.equal(subscriptions().some((s) => s.chatId === '9'), true);
  unsubscribe('9', '*');
  assert.equal(subscriptions().some((s) => s.chatId === '9'), false);
});

// --- the clock -------------------------------------------------------------------

test('the schedule is a day out, twelve hours out, the end, each grace hour, then closable', () => {
  assert.deepEqual(
    timedAlerts(4).map((a) => a.kind),
    ['ends-24h', 'ends-12h', 'ended', 'grace-1h', 'grace-2h', 'grace-3h', 'closable'],
  );
});

test('an alert fires once, in its window, and never late', () => {
  const endsAt = 1_800_000_000;
  const none = new Set<string>();
  assert.deepEqual(dueAlerts(endsAt, endsAt - 24 * H + 30, none, 4, 300).map((a) => a.kind), ['ends-24h']);
  assert.deepEqual(dueAlerts(endsAt, endsAt - 24 * H + 30, new Set(['ends-24h']), 4, 300), [], 'already sent');
  assert.deepEqual(dueAlerts(endsAt, endsAt - 24 * H + 3600, none, 4, 300), [], 'an hour late is not sent at all');
  assert.deepEqual(dueAlerts(endsAt, endsAt + 2 * H + 10, none, 4, 300).map((a) => a.kind), ['grace-2h']);
  assert.deepEqual(dueAlerts(endsAt, endsAt + 4 * H + 10, none, 4, 300).map((a) => a.kind), ['closable']);
});

test('a milestone that has not started has no clock', () => {
  assert.deepEqual(dueAlerts(0, 1_800_000_000, new Set(), 4, 300), []);
});

test('sent alerts are read back per stream', () => {
  const rows = [
    { event: 'alerted', stream: A, kind: 'ended' },
    { event: 'alerted', stream: B, kind: 'closable' },
  ];
  assert.deepEqual([...alertsSent(rows, A)], ['ended']);
});

test('the grace text counts down the hours that are left', () => {
  const grace = timedAlerts(4).find((a) => a.kind === 'grace-3h')!;
  assert.ok(grace.text('L').includes('1 hour left'));
});

// --- what is said ----------------------------------------------------------------

test('every judgment outcome has words, and skips have none', () => {
  const link = 'https://app.example.test/stream/x';
  assert.ok(judgmentText({ event: 'unlocked', pr: 4, certifiedPercent: 50, trancheUsdc: '20' }, link)?.includes('50%'));
  assert.ok(judgmentText({ event: 'unlocked', resumed: true, certifiedPercent: 97, trancheUsdc: '7' }, link)?.startsWith('Certification resumed'));
  for (const event of ['declined', 'vetoed', 'escalated', 'unlock_failed']) {
    assert.ok(judgmentText({ event, pr: 4 }, link), event);
  }
  assert.equal(judgmentText({ event: 'skipped', pr: 4 }, link), null);
});

test('the bot understands its four commands and nothing else', () => {
  assert.ok(reply('7', `/start ${A}`).act, 'a deep link subscribes');
  assert.equal(reply('7', '/start').act, undefined, 'a bare start explains');
  assert.ok(reply('7', `/stop ${A}`).act);
  assert.ok(reply('7', '/stop').act);
  assert.equal(reply('7', '/start not-an-address').act, undefined);
  assert.ok(reply('7', 'hello').text.includes('/list'));
  assert.ok(reply('7', `/start@ProofStreamBot ${A}`).act, 'the @bot suffix groups add is stripped');
});

// --- following a person, not a stream ------------------------------------------

const { adoptEarnerFollows, followEarner, foldEarners } = await import('../src/subscriptions');
const EARNER = `0x${'ab'.repeat(32)}`;

test('an earner follow is taken, and /stop for all ends it', () => {
  const rows = [{ event: 'subscribed', channel: 'telegram', chatId: '7', earner: EARNER }];
  assert.equal(foldEarners(rows).length, 1);
  assert.equal(foldEarners([...rows, { event: 'unsubscribed', channel: 'telegram', chatId: '7', stream: '*' }]).length, 0);
  assert.equal(foldEarners([...rows, { event: 'unsubscribed', channel: 'telegram', chatId: '7', stream: A }]).length, 1, 'leaving one stream is not leaving yourself');
});

test('a certification that credits the earner folds their followers into the stream, once', () => {
  followEarner('11', EARNER);
  assert.equal(adoptEarnerFollows(A, EARNER), 1);
  assert.equal(adoptEarnerFollows(A, EARNER), 0, 'idempotent');
  assert.equal(subscriptions().some((s) => s.chatId === '11' && s.stream === A.toLowerCase()), true);
  assert.equal(adoptEarnerFollows(B, `0x${'cd'.repeat(32)}`), 0, 'somebody else\'s credit adopts nobody');
  unsubscribe('11', '*');
});

test('the bot takes an earner id as the 64 hex digits the deep link can carry', () => {
  assert.ok(reply('7', `/start ${'ab'.repeat(32)}`).act, 'sixty-four hex digits is an earner');
  assert.equal(reply('7', `/start ${'ab'.repeat(31)}`).act, undefined, 'sixty-two is nothing');
});
