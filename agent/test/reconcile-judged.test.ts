// `alreadyJudged` decides whether reconcile may retry a pull request, and it
// reads the ledger, so this test writes a real ledger to a temp directory and
// points PROOFSTREAM_LOG_DIR at it.
//
// The env below is fake and required only because agent/src/env.ts validates at
// import time. Nothing here reaches a chain, a model or a wallet.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'ps-ledger-'));

Object.assign(process.env, {
  PROOFSTREAM_LOG_DIR: dir,
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
});

const STREAM = '0x26B8379cCB664f94fCAC4837D0FcB62136a8dcE8';
const OTHER = '0xF5Ee20FbB318eFeC036276791F207D086C09B386';

const row = (o: Record<string, unknown>) => JSON.stringify({ at: '2026-08-23T00:00:00.000Z', ...o });

writeFileSync(
  join(dir, 'verdicts.jsonl'),
  [
    // A real certification. Counts.
    row({ event: 'unlocked', workStream: STREAM, pr: 1, txHash: '0xabc' }),
    // The model said no. That IS a judgment, and it cost a second opinion.
    row({ event: 'declined', workStream: STREAM, pr: 2 }),
    // THE ONE THAT COST A LIVE RUN: the judgment never happened, so this must
    // not block a retry.
    row({ event: 'unlock_failed', workStream: STREAM, pr: 3, judged: false, reason: 'judgment threw: LLM call failed' }),
    // A send that failed AFTER a verdict. Re-judging would buy a second
    // opinion for work already judged, so this still counts.
    row({ event: 'unlock_failed', workStream: STREAM, pr: 4, reason: 'ESTIMATION_ERROR' }),
    // --- evidence rows, for lastEvidence ---
    // A conclusive check. This is the baseline a later judgment is measured on.
    row({ event: 'unlocked', workStream: OTHER, pr: 10, correctness: { outcome: 'passes', suiteId: 'ruler-1', passed: 9, total: 12 } }),
    // Inconclusive: it established nothing, so it must NOT become the baseline.
    row({ event: 'escalated', workStream: OTHER, pr: 11, correctness: { outcome: 'inconclusive', suiteId: 'ruler-1', passed: 0, total: 0 } }),
    // A later conclusive one. The newest conclusive row is what counts.
    row({ event: 'unlocked', workStream: OTHER, pr: 12, correctness: { outcome: 'fails', suiteId: 'ruler-1', passed: 11, total: 12 } }),
    // AND THEN AN INCONCLUSIVE ONE LAST. Deliberately last: if the filter were
    // removed, this row would become the baseline and the test below would
    // catch it. With the inconclusive row in the middle the test passed either
    // way and proved nothing.
    row({ event: 'escalated', workStream: OTHER, pr: 13, correctness: { outcome: 'inconclusive', suiteId: 'ruler-1', passed: 0, total: 0 } }),
    // Another stream's business entirely.
    row({ event: 'unlocked', workStream: OTHER, pr: 5, txHash: '0xdef' }),
    'not json at all',
  ].join('\n') + '\n',
);

const { alreadyJudged, lastEvidence, toMergedPr } = await import('../src/reconcile');
type GhPull = Parameters<typeof toMergedPr>[0];

test('a certification counts as judged', () => {
  assert.equal(alreadyJudged(STREAM).has(1), true);
});

test('a decline counts as judged — it cost a second opinion', () => {
  assert.equal(alreadyJudged(STREAM).has(2), true);
});

test('a judgment that THREW does not count, so reconcile can retry it', () => {
  // The regression. On 2026-08-23 an LLM 404 wrote this row and every restart
  // afterwards skipped the pull request as already judged.
  assert.equal(alreadyJudged(STREAM).has(3), false);
});

test('a failed SEND still counts — the verdict was reached and paid for', () => {
  assert.equal(alreadyJudged(STREAM).has(4), true);
});

test('another stream\'s rows are ignored', () => {
  assert.equal(alreadyJudged(STREAM).has(5), false);
  assert.equal(alreadyJudged(OTHER).has(5), true);
});

test('a corrupt line does not take the whole ledger down', () => {
  assert.deepEqual([...alreadyJudged(STREAM)].sort(), [1, 2, 4]);
});

test('an unknown stream has judged nothing', () => {
  assert.equal(alreadyJudged('0x0000000000000000000000000000000000000009').size, 0);
});

// --- lastEvidence: the baseline a later judgment is measured against ---------

test('the newest CONCLUSIVE check is the baseline', () => {
  const e = lastEvidence(OTHER);
  assert.equal(e?.passed, 11, 'the fails row at 11 of 12 is the most recent conclusive one');
  assert.equal(e?.total, 12);
  assert.equal(e?.suiteId, 'ruler-1');
});

test('AN INCONCLUSIVE RUN NEVER BECOMES THE BASELINE', () => {
  // It established nothing. Treating it as a baseline would hold a later
  // judgment against a measurement that never happened.
  //
  // The ledger's LAST row for this stream is inconclusive on purpose, so
  // dropping the filter would make it the answer and this would fail.
  const e = lastEvidence(OTHER);
  assert.equal(e?.passed, 11, 'the inconclusive row must be skipped, not taken as newest');
  assert.equal(e?.total, 12);
});

test('a stream with no correctness rows has no baseline', () => {
  assert.equal(lastEvidence(STREAM), null);
});

test('an unknown stream has no baseline', () => {
  assert.equal(lastEvidence('0x000000000000000000000000000000000000dEaD'), null);
});

test('the stream match is case-insensitive, as addresses are', () => {
  assert.equal(lastEvidence(OTHER.toLowerCase())?.passed, 11);
});

// --- reconciliation must not be a weaker standard than the webhook -----------

const pull = (over: Partial<GhPull> = {}): GhPull => ({
  number: 2,
  title: '2. tests for balanceAt',
  body: '',
  merged_at: '2026-08-31T17:15:41Z',
  merge_commit_sha: '31b6bd039c',
  user: { login: 'Samuel-Chuku' },
  base: { ref: 'main' },
  ...over,
});

test('a reconciled pull request carries the branch it was merged into', () => {
  assert.equal(toMergedPr(pull(), 'owner/repo').baseBranch, 'main');
});

test('a pull request with no base at all does not throw', () => {
  // Fails closed further down: no branch means the merge is not accepted.
  assert.equal(toMergedPr(pull({ base: null }), 'owner/repo').baseBranch, undefined);
});

test('THE MERGE COMMIT IS CARRIED, because the reference is derived from it', () => {
  // `mergeParentSha` resolves the earlier version from this, and nothing else
  // can: the pull request's own `base.sha` is frozen at the moment it was
  // opened and points at a repository that may predate several merges since.
  assert.equal(toMergedPr(pull(), 'owner/repo').commitSha, '31b6bd039c');
});
