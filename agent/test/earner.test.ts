// WHO GETS CREDITED on a public stream, and when that is decided.
//
// github.ts imports env.ts, which validates at import, so the webhook parser is
// exercised through the same fake-env pattern the other agent tests use. The
// ordering assertion reads pipeline.ts as text, like ceiling.test.ts does, for
// the same reason.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

Object.assign(process.env, {
  PROOFSTREAM_LOG_DIR: '/tmp',
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

const { parseMergedPr } = await import('../src/github');

const merged = (user: unknown) => ({
  action: 'closed',
  pull_request: {
    merged: true,
    number: 4,
    title: 't',
    body: '',
    merge_commit_sha: 'abc',
    user,
    base: { ref: 'main' },
  },
  repository: { full_name: 'owner/repo' },
});

test("the webhook carries the author's numeric id", () => {
  assert.equal(parseMergedPr(merged({ login: 'ada', id: 1001 }))?.authorId, 1001);
});

test('a webhook without a numeric id yields none, never a guess', () => {
  assert.equal(parseMergedPr(merged({ login: 'ada' }))?.authorId, undefined);
  assert.equal(parseMergedPr(merged({ login: 'ada', id: '1001' }))?.authorId, undefined, 'a string is not an id');
});

// --- when the earner is decided --------------------------------------------
//
// "Never send a zero earner" is NOT pinned here, deliberately. A text check on
// pipeline.ts kept passing after the guard was disabled, so it was not evidence.
// The property is held in two places that are tested: earnerId() throws on a
// missing or zero id (config/test/repo.test.ts), and the contract rejects a zero
// as NoEarner (WorkStreamPublic.t.sol). The agent cannot construct the value.

const pipeline = readFileSync(new URL('../src/pipeline.ts', import.meta.url), 'utf8');

test('THE EARNER IS RESOLVED BEFORE ANYTHING IS BOUGHT', () => {
  // A public stream whose earner cannot be resolved cannot be certified. Deciding
  // that after the suite, the sandbox and the inference call would pay for all
  // three to learn nothing. Same reasoning as the ceiling refusal, same pin.
  const earner = pipeline.indexOf('allowedEarner(stream.authors');
  const diff = pipeline.indexOf('await fetchDiff(');
  const correctness = pipeline.indexOf('await correctnessOf(');
  const judgment = pipeline.indexOf('await judge(');
  assert.ok(earner > 0, 'the earner must be resolved somewhere');
  assert.ok(earner < diff && earner < correctness && earner < judgment, 'and before any spend');
});
