// THE RESUME PASS SENDS MONEY WITH NO MERGE BEHIND IT, so what it may climb
// toward, and by how much, is the thing to pin. Both decisions are pure and
// are tested without a chain. The env below is fake and required only because
// agent/src/env.ts validates at import.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

Object.assign(process.env, {
  PROOFSTREAM_LOG_DIR: mkdtempSync(join(tmpdir(), 'ps-resume-')),
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

const { latestClipped, resumeStep } = await import('../src/resume');

const STREAM = '0x26B8379cCB664f94fCAC4837D0FcB62136a8dcE8';
const HASH = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const usdc = (n: number) => BigInt(Math.round(n * 1_000_000));

const row = (o: Record<string, unknown>) => ({
  event: 'unlocked',
  workStream: STREAM,
  milestoneHash: HASH,
  milestoneIndex: 1,
  pr: 4,
  commitSha: 'abc',
  agreedFraction: 0.97,
  verdict: { confidence: 0.9 },
  ...o,
});

// --- what may be resumed ------------------------------------------------------

test('a clipped certification is picked up with the figure the agents concluded', () => {
  const c = latestClipped([row({ meteredByPolicy: true })], STREAM, HASH, 1);
  assert.equal(c?.agreedFraction, 0.97);
  assert.equal(c?.pr, 4);
  assert.equal(c?.confidence, 0.9);
});

// A SPENT DAY IS THE ONE THAT USED TO BE DROPPED. Both agents agreed and the
// verifier fee was already paid, but the day's allowance left no room, so the
// pipeline logged `skipped` and nothing ever went looking for it again.
test('a verdict blocked by a spent day is resumable, not lost', () => {
  const c = latestClipped([row({ event: 'skipped', meteredByPolicy: true })], STREAM, HASH, 1);
  assert.equal(c?.agreedFraction, 0.97, 'the concluded figure survives');
  assert.equal(c?.pr, 4);
});

test('an ordinary skip is still nothing to resume', () => {
  // Re-judging work already certified skips too, and must not be mistaken for
  // a clip: nothing was bought and nothing is owed.
  assert.equal(latestClipped([row({ event: 'skipped' })], STREAM, HASH, 1), null);
});

test('a certification the policy did not clip has nothing to resume', () => {
  assert.equal(latestClipped([row({})], STREAM, HASH, 1), null);
});

test('THE MOST RECENT CERTIFICATION DECIDES, NOT THE HIGHEST', () => {
  // A later, unclipped judgment saw the final tree and stands on its own. On a
  // public stream it also names a different earner, whose share is theirs.
  const rows = [row({ meteredByPolicy: true, agreedFraction: 0.97 }), row({ pr: 5, agreedFraction: 0.6 })];
  assert.equal(latestClipped(rows, STREAM, HASH, 1), null);
});

test('a resumed row that was itself clipped keeps the milestone resumable', () => {
  const rows = [row({ meteredByPolicy: true }), row({ meteredByPolicy: true, resumed: true })];
  assert.equal(latestClipped(rows, STREAM, HASH, 1)?.agreedFraction, 0.97);
});

test('a different milestone on the same stream is never resumed against', () => {
  const rows = [row({ meteredByPolicy: true })];
  assert.equal(latestClipped(rows, STREAM, HASH, 2), null, 'same text reopened as milestone 2');
  assert.equal(latestClipped(rows, STREAM, `0x${'b'.repeat(64)}`, 1), null, 'a different hash');
});

test('rows from before the milestone identity was recorded are not resumable', () => {
  const old = row({ meteredByPolicy: true });
  delete (old as Record<string, unknown>).milestoneHash;
  assert.equal(latestClipped([old], STREAM, HASH, 1), null);
});

test('another stream and a failed send are ignored', () => {
  const rows = [
    row({ meteredByPolicy: true, workStream: '0xF5Ee20FbB318eFeC036276791F207D086C09B386' }),
    row({ meteredByPolicy: true, event: 'unlock_failed' }),
  ];
  assert.equal(latestClipped(rows, STREAM, HASH, 1), null);
});

// --- how far one sweep may climb -------------------------------------------------

const stream = { budget: usdc(100), target: usdc(30), maxTranche: usdc(30), certifiedBps: 3000n };

test('one step is the policy step, toward the concluded figure', () => {
  const s = resumeStep(0.97, stream, usdc(100));
  assert.equal(s?.certifiedBps, 6000n, '30% plus one 30-USDC tranche');
  assert.equal(s?.trancheAdded, usdc(30));
});

test('the last step stops at the concluded figure, never past it', () => {
  const s = resumeStep(0.97, { ...stream, target: usdc(90), certifiedBps: 9000n }, usdc(100));
  assert.equal(s?.certifiedBps, 9700n);
  assert.equal(s?.trancheAdded, usdc(7));
});

test("today's remaining cap clips the step, and the step rounds DOWN", () => {
  const s = resumeStep(0.97, stream, usdc(12.5));
  assert.equal(s?.certifiedBps, 4250n);
  assert.ok((s?.trancheAdded ?? 0n) <= usdc(12.5), 'never more than the cap allows');
});

test('a spent day is a wait, not a revert', () => {
  assert.equal(resumeStep(0.97, stream, 0n), null);
});

test('nothing to climb toward is nothing to send', () => {
  assert.equal(resumeStep(0.3, stream, usdc(100)), null, 'already there');
  assert.equal(resumeStep(0.2, stream, usdc(100)), null, 'certification never falls');
});

// --- it never re-judges ------------------------------------------------------------
//
// A structural check, and honest about what it is: it proves the module does
// not import the judge or the verifier, which is the only way it could re-judge.
// It cannot prove the logic is right; the tests above do that.

test('the resume module cannot reach the judge or the verifier', () => {
  const source = readFileSync(new URL('../src/resume.ts', import.meta.url), 'utf8');
  for (const forbidden of ['./adjudicate', './oracle', './verifier', './pay', './correctness', './sandbox']) {
    assert.ok(!source.includes(`from '${forbidden}`), `resume.ts must not import ${forbidden}`);
  }
});
