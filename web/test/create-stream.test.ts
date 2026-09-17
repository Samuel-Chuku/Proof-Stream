import assert from 'node:assert/strict';
import { test } from 'node:test';
import { advisories, validate, type StreamTerms } from '../lib/create-stream';

const addr = '0x1111111111111111111111111111111111111111' as const;
const ZERO = '0x0000000000000000000000000000000000000000' as const;

/** A stream whose caps are the suggested defaults: both equal the budget. */
const terms = (over: Partial<StreamTerms> = {}): StreamTerms => ({
  mode: 'named',
  contributor: addr,
  agent: addr,
  payee: addr,
  milestone: 'Add balanceAt and cover it with unit tests.',
  budget: '100',
  durationSeconds: 86_400,
  repo: 'owner/name',
  branch: 'main',
  maxTranche: '100',
  dailyUnlockCap: '100',
  ...over,
});

const capNote = (t: StreamTerms) => advisories(t).find((n) => n.includes('per-certification cap'));

test('the suggested defaults raise no advisory at all', () => {
  assert.deepEqual(advisories(terms()), []);
});

// The cap warning became an error in `validate` once the contract started
// refusing to deploy that configuration at all. Its replacement is
// 'A CAP BELOW THE BUDGET IS NOW AN ERROR' below.

// The certification-count arithmetic tests lived here. They exercised a warning
// about a configuration the contract now refuses outright, so the arithmetic no
// longer exists to test. What replaced them is the validate() coverage below.

test('a cap at or above the budget never warns', () => {
  assert.equal(capNote(terms({ maxTranche: '100' })), undefined);
  assert.equal(capNote(terms({ maxTranche: '1000' })), undefined);
});

test('an empty or zero cap does not warn, and does not divide by zero', () => {
  // The field is empty while the user is still typing the budget.
  assert.equal(capNote(terms({ maxTranche: '' })), undefined);
  assert.equal(capNote(terms({ maxTranche: '0' })), undefined);
  assert.equal(capNote(terms({ budget: '', maxTranche: '30' })), undefined);
});

test('the daily-cap advisory is unchanged and independent', () => {
  const daily = advisories(terms({ dailyUnlockCap: '40' }));
  assert.equal(daily.length, 1);
  assert.match(daily[0], /daily cap of 40 USDC/);
});

test('a daily cap under the budget still advises, because it is legitimate', () => {
  // It is how the policy-revert demo is configured, so it must not become an
  // error. Only a daily cap that cannot reach the budget across the whole
  // duration is refused, and that is validate()'s job.
  const notes = advisories(terms({ dailyUnlockCap: '40' }));
  assert.equal(notes.length, 1);
  assert.match(notes[0], /daily cap/);
});

// --- CT-1: the form must agree with the contract ---------------------------
//
// The contract now refuses a stream whose caps could make the budget
// unreachable. The form previously blocked the OPPOSITE: `maxTranche > budget`
// was an error and `maxTranche < budget` was merely a warning. Left as it was,
// the only value satisfying both would be exactly the budget, and anything
// lower would pass the form and then revert on chain with no explanation.

const capProblem = (t: StreamTerms) => validate(t).find((p) => p.includes('per-unlock cap'));
const dailyProblem = (t: StreamTerms) => validate(t).find((p) => p.includes('daily cap'));

test('the suggested defaults validate cleanly', () => {
  assert.deepEqual(validate(terms()), []);
});

test('A CAP BELOW THE BUDGET IS NOW AN ERROR, not a warning', () => {
  // The 2026-08-08 configuration. The contract will not deploy it, so the form
  // must not offer it.
  const problem = capProblem(terms({ maxTranche: '30' }));
  assert.ok(problem, 'a cap below the budget must block the deploy');
  assert.match(problem, /cannot be below the budget/i);
});

test('a cap ABOVE the budget is allowed, because the contract allows it', () => {
  // This used to be an error, which was backwards.
  assert.equal(capProblem(terms({ maxTranche: '200' })), undefined);
});

test('the daily cap is judged against the duration, not against the budget', () => {
  // 50 a day over a 2-day milestone reaches a 100 budget, so it is legal and is
  // exactly the throttle the contract keeps allowing.
  const twoDays = { durationSeconds: 172_800, dailyUnlockCap: '50' };
  assert.equal(dailyProblem(terms(twoDays)), undefined);

  // 40 a day over the same 2 days tops out at 80, short of the budget.
  const problem = dailyProblem(terms({ ...twoDays, dailyUnlockCap: '40' }));
  assert.ok(problem, 'a daily cap that cannot reach the budget must block');
  assert.match(problem, /cannot reach the budget/i);
});

test('part-days round up, matching the contract', () => {
  // 100,000s is 1.16 days, which the contract rounds up to 2.
  assert.equal(dailyProblem(terms({ durationSeconds: 100_000, dailyUnlockCap: '50' })), undefined);
});

test('a cap below the budget no longer produces an advisory as well', () => {
  // It is an error now. Reporting it twice, in two lists with different
  // meanings, makes neither legible.
  assert.equal(capNote(terms({ maxTranche: '30' })), undefined);
});

// --- claimable streams ------------------------------------------------------

test('a claimable stream needs no contributor or payee', () => {
  const claimable = terms({ contributor: ZERO, payee: ZERO, claimAuthority: addr });
  assert.deepEqual(validate(claimable), []);
});

test('a stream that is neither named nor claimable is rejected', () => {
  const problems = validate(terms({ contributor: ZERO, payee: ZERO }));
  assert.ok(problems.some((p) => /contributor|claim link/i.test(p)));
});

test('a stream cannot be both named and claimable', () => {
  const both = terms({ claimAuthority: addr });
  assert.ok(validate(both).some((p) => /both/i.test(p)));
});

// --- CT-2: whose merges count ----------------------------------------------

test('no authors is valid, and means any author', () => {
  assert.deepEqual(validate(terms({ authors: [] })), []);
  assert.deepEqual(validate(terms()), []);
});

test('an allowlist of accounts is valid', () => {
  assert.deepEqual(validate(terms({ authors: ['ada', 'ada-at-work'] })), []);
});

test('a URL or an email is rejected, because GitHub wants a username', () => {
  assert.ok(validate(terms({ authors: ['https://github.com/ada'] })).some((p) => /username/.test(p)));
  assert.ok(validate(terms({ authors: ['ada@example.com'] })).some((p) => /username/.test(p)));
});

test('the list is bounded, matching the contract', () => {
  const many = Array.from({ length: 17 }, (_, i) => `dev${i}`);
  assert.ok(validate(terms({ authors: many })).some((p) => /16/.test(p)));
});

// --- an open stream: nobody named, everyone may earn -------------------------
//
// The contract refuses "nobody named" WITHOUT payout caps, so that forgetting to
// name anyone cannot silently deploy a stream open to the world. The form has
// to say the same thing, in the same place, before the wallet is asked to sign.

const open = (over: Partial<StreamTerms> = {}): StreamTerms =>
  terms({ mode: 'open', contributor: ZERO, payee: ZERO, claimCap: '30', dailyClaimCap: '100', ...over });

test('an open stream with caps is valid, and needs no contributor', () => {
  assert.deepEqual(validate(open()), []);
});

test('AN OPEN STREAM WITHOUT A PAYOUT CEILING IS REFUSED', () => {
  // This is the line between "chose open" and "forgot to name anyone".
  assert.ok(validate(open({ claimCap: '0' })).some((p) => /payout ceiling per withdrawal/.test(p)));
  assert.ok(validate(open({ claimCap: undefined })).some((p) => /payout ceiling per withdrawal/.test(p)));
});

test('a daily ceiling below the per-withdrawal ceiling is refused', () => {
  // The first payout of the day could never fit. Nonsense, caught before deploy
  // rather than as a BadCapPair revert with the reason four steps away.
  assert.ok(validate(open({ claimCap: '30', dailyClaimCap: '10' })).some((p) => /daily payout ceiling/.test(p)));
});

test('an open stream ignores the contributor and payee fields entirely', () => {
  // The form hides them, but a stale value left in state must not leak through.
  assert.deepEqual(validate(open({ contributor: addr, payee: addr })), []);
});

test('an open stream cannot also be a claim link', () => {
  assert.ok(validate(open({ claimAuthority: addr })).some((p) => /cannot also be a claim link/.test(p)));
});

test('a named stream never carries payout caps, whatever the form left in state', () => {
  // Same reasoning in reverse: the constructor refuses caps on a named stream.
  // deployStream sends zero regardless of what a mode switch left behind.
  const { deployStream } = require('../lib/create-stream') as typeof import('../lib/create-stream');
  const call: any = deployStream(terms({ claimCap: '30', dailyClaimCap: '100' }));
  assert.equal(call.args[9].claimCap, 0n);
  assert.equal(call.args[9].dailyClaimCap, 0n);
  assert.equal(call.args[1], addr, 'the contributor is still named');
});

test('an open stream deploys with nobody named and the caps set', () => {
  const { deployStream } = require('../lib/create-stream') as typeof import('../lib/create-stream');
  const call: any = deployStream(open({ contributor: addr, payee: addr }));
  assert.equal(call.args[1], ZERO, 'contributor is zero even if the form left one in state');
  assert.equal(call.args[2], ZERO, 'no claim authority');
  assert.equal(call.args[9].payee, ZERO);
  assert.equal(call.args[9].claimCap, 30_000_000n);
  assert.equal(call.args[9].dailyClaimCap, 100_000_000n);
});
