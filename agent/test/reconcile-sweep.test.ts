// THE SWEEP SPENDS MONEY WITHOUT BEING ASKED, and on a timer it does so
// repeatedly, so the bound on retries is the thing that must hold. The env
// below is fake and required only because agent/src/env.ts validates at import.
// Nothing here reaches a chain, a model or a wallet.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

Object.assign(process.env, {
  PROOFSTREAM_LOG_DIR: mkdtempSync(join(tmpdir(), 'ps-sweep-')),
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
  RECONCILE_EVERY_MINUTES: '0',
});

const { forgetAttempts, mayRetry, noteAttempt, startReconcileLoop, sweepStatus } = await import('../src/reconcile');

const STREAM = '0x26B8379cCB664f94fCAC4837D0FcB62136a8dcE8';

test('a pull request may be retried three times and then no more', () => {
  forgetAttempts();
  assert.equal(mayRetry(STREAM, 7), true);
  noteAttempt(STREAM, 7);
  noteAttempt(STREAM, 7);
  assert.equal(mayRetry(STREAM, 7), true, 'two failures are not a standing failure');
  noteAttempt(STREAM, 7);
  assert.equal(mayRetry(STREAM, 7), false, 'the fourth sweep leaves it alone');
});

test('the count is per stream and per pull request, and addresses are case-insensitive', () => {
  forgetAttempts();
  for (let i = 0; i < 3; i++) noteAttempt(STREAM, 7);
  assert.equal(mayRetry(STREAM, 8), true, 'another pull request is untouched');
  assert.equal(mayRetry('0xF5Ee20FbB318eFeC036276791F207D086C09B386', 7), true, 'another stream is untouched');
  assert.equal(mayRetry(STREAM.toLowerCase(), 7), false, 'the same stream in another case is the same stream');
});

// --- the loop ---------------------------------------------------------------

test('the first sweep runs before the loop returns, so startup can report it', async () => {
  forgetAttempts();
  let swept = 0;
  await startReconcileLoop(
    () => {},
    async () => {
      swept += 1;
    },
    () => {},
  );
  // No streams are known in this process, so `reconcile` finds nothing to
  // process — what is asserted is that the sweep RAN and was counted.
  assert.equal(sweepStatus().sweeps, 1);
  assert.equal(sweepStatus().lastSweepAt !== null, true);
  assert.equal(swept, 0, 'nothing to judge in a process with no streams');
});

test('RECONCILE_EVERY_MINUTES=0 sweeps once and schedules nothing', async () => {
  const logged: string[] = [];
  await startReconcileLoop((e) => logged.push(String(e.event)), async () => {}, () => {});
  assert.ok(logged.includes('reconcile_loop_disabled'), 'it says so rather than looking alive');
  assert.equal(sweepStatus().everyMinutes, 0);
});
