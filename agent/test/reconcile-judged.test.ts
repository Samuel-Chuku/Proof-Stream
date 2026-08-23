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
    // Another stream's business entirely.
    row({ event: 'unlocked', workStream: OTHER, pr: 5, txHash: '0xdef' }),
    'not json at all',
  ].join('\n') + '\n',
);

const { alreadyJudged } = await import('../src/reconcile');

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
