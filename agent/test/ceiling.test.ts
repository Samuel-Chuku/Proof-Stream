// THE AGENT'S CEILING MUST BE THE CONTRACT'S CEILING.
//
// `pipeline.ts` refuses to judge a milestone that is already certified in full,
// before it spends anything on a suite, a sandbox or an inference call. That
// refusal is correct only while its number matches `BPS` in WorkStream.sol, and
// the two live in different languages in different directories with nothing
// connecting them.
//
// Drift is silent and asymmetric, which is why this is worth a test:
//
//   - agent number TOO LOW  -> it stops judging before the milestone is finished
//     and an honest contributor is never paid the rest. Certification is a
//     monotonic ratchet, so nothing later corrects it.
//   - agent number TOO HIGH -> the refusal never fires and we are back to paying
//     for judgments that cannot move anything.
//
// Read from source text rather than imported, for the same reason
// sandbox.test.ts reads its own file: `pipeline.ts` pulls in env.ts, which
// validates a dozen variables at import and cannot be loaded without a .env.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

const agent = readFileSync(new URL('../src/pipeline.ts', import.meta.url), 'utf8');
const contract = readFileSync(new URL('../../contracts/src/WorkStream.sol', import.meta.url), 'utf8');

/** Solidity and TypeScript both allow `_` separators, and neither is canonical. */
const number = (s: string) => Number(s.replace(/_/g, ''));

test('the agent declares a ceiling at all', () => {
  // Guards every assertion below: a regex that silently matches nothing would
  // make the rest of this file pass while proving nothing.
  assert.match(agent, /const FULL_BPS = [\d_]+n;/, 'pipeline.ts must declare FULL_BPS');
  assert.match(contract, /uint256 internal constant BPS = [\d_]+;/, 'WorkStream.sol must declare BPS');
});

test('THE TWO CEILINGS AGREE', () => {
  const inAgent = number(agent.match(/const FULL_BPS = ([\d_]+)n;/)![1]);
  const inContract = number(contract.match(/uint256 internal constant BPS = ([\d_]+);/)![1]);
  assert.equal(
    inAgent,
    inContract,
    `pipeline.ts refuses at ${inAgent} bps but the contract's ceiling is ${inContract} — ` +
      'the agent would stop judging at the wrong point',
  );
});

test('the ceiling is 100%, expressed in basis points', () => {
  // Pinned so a change to either file has to be deliberate rather than
  // accidentally agreed. 10_000 bps is the whole milestone.
  assert.equal(number(agent.match(/const FULL_BPS = ([\d_]+)n;/)![1]), 10_000);
});

test('the refusal is taken BEFORE anything is bought', () => {
  // Order is the entire point of the change. Below the correctness check it
  // would still be correct and would still cost the money it exists to save.
  const refusal = agent.indexOf('stream.certifiedBps >= FULL_BPS');
  const diff = agent.indexOf('await fetchDiff(');
  const correctness = agent.indexOf('await correctnessOf(');
  const judgment = agent.indexOf('await judge(');

  assert.ok(refusal > 0, 'the ceiling refusal must exist');
  assert.ok(refusal < diff, 'it must come before the diff is fetched');
  assert.ok(refusal < correctness, 'it must come before the suite and the sandbox');
  assert.ok(refusal < judgment, 'it must come before the inference call');
});
