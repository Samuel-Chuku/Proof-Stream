import assert from 'node:assert/strict';
import { test } from 'node:test';
import { advisories, type StreamTerms } from '../lib/create-stream';

const addr = '0x1111111111111111111111111111111111111111' as const;

/** A stream whose caps are the suggested defaults: both equal the budget. */
const terms = (over: Partial<StreamTerms> = {}): StreamTerms => ({
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

test('a cap below the budget warns, and counts the certifications needed', () => {
  // The 2026-08-08 stream exactly: 100 USDC budget, 30 USDC cap. It got one
  // merge, and 67 USDC the agents had agreed was owed went back to the employer.
  const note = capNote(terms({ maxTranche: '30' }));
  assert.ok(note, 'a cap below the budget must warn');
  assert.match(note, /needs 4 separate certifications/);
  assert.match(note, /each one needs its own merge/);
  assert.match(note, /returns to you rather than to the contributor/);
});

test('the certification count rounds UP on an uneven division', () => {
  // 100/30 is 3.33, and three certifications would leave 10 USDC unreachable.
  assert.match(capNote(terms({ maxTranche: '30' }))!, /needs 4 separate/);
  assert.match(capNote(terms({ maxTranche: '40' }))!, /needs 3 separate/);
  assert.match(capNote(terms({ maxTranche: '99' }))!, /needs 2 separate/);
});

test('an even division is not rounded up by one', () => {
  assert.match(capNote(terms({ maxTranche: '50' }))!, /needs 2 separate/);
  assert.match(capNote(terms({ maxTranche: '25' }))!, /needs 4 separate/);
});

test('a fractional cap is handled in USDC, not in whole units', () => {
  // 10 USDC over a 2.50 cap is exactly 4. Doing this in floats would be a
  // rounding bug in the one place we are warning about rounding.
  assert.match(capNote(terms({ budget: '10', maxTranche: '2.50' }))!, /needs 4 separate/);
});

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

test('both advisories can fire at once, with the costlier one first', () => {
  const both = advisories(terms({ maxTranche: '30', dailyUnlockCap: '40' }));
  assert.equal(both.length, 2);
  assert.match(both[0], /per-certification cap/);
  assert.match(both[1], /daily cap/);
});
