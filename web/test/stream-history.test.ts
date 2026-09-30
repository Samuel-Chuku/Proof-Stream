// THE CHART IS AN ASSERTION ABOUT MONEY, so its arithmetic is pinned the same
// way the certification arithmetic is. A band that is a pixel wrong is a claim
// that is wrong, and this one is read by the person being paid.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { accruedAt, certifiedAt, streamHistory } from '../lib/stream-history';

const usdc = (n: number) => BigInt(Math.round(n * 1_000_000));
const DAY = 86_400;
const T0 = 1_800_000_000;

const base = {
  budget: usdc(100),
  startedAt: T0,
  duration: 2 * DAY,
  now: T0 + 2 * DAY,
  certifications: [] as { at: number; target: bigint }[],
};

// --- accrual ----------------------------------------------------------------

test('accrual is proportional, and exact at both ends', () => {
  assert.equal(accruedAt(T0, usdc(100), T0, 2 * DAY), 0n, 'nothing at the start');
  assert.equal(accruedAt(T0 + DAY, usdc(100), T0, 2 * DAY), usdc(50), 'half way');
  assert.equal(accruedAt(T0 + 2 * DAY, usdc(100), T0, 2 * DAY), usdc(100), 'the whole budget, no dust');
});

test('accrual never runs past the end or before the start', () => {
  assert.equal(accruedAt(T0 - 1, usdc(100), T0, 2 * DAY), 0n);
  assert.equal(accruedAt(T0 + 10 * DAY, usdc(100), T0, 2 * DAY), usdc(100), 'capped at the budget');
});

test('a milestone that never started accrues nothing rather than dividing by zero', () => {
  assert.equal(accruedAt(T0 + DAY, usdc(100), 0, 2 * DAY), 0n);
  assert.equal(accruedAt(T0 + DAY, usdc(100), T0, 0), 0n);
});

// --- certification ----------------------------------------------------------

test('the standing claim is the last certification at or before the moment', () => {
  const certs = [
    { at: T0 + DAY, target: usdc(50) },
    { at: T0 + 2 * DAY, target: usdc(100) },
  ];
  assert.equal(certifiedAt(T0, certs), 0n, 'before any of them');
  assert.equal(certifiedAt(T0 + DAY, certs), usdc(50), 'on the boundary, inclusive');
  assert.equal(certifiedAt(T0 + DAY + 1, certs), usdc(50), 'and holds until the next');
  assert.equal(certifiedAt(T0 + 3 * DAY, certs), usdc(100));
});

// --- the bands --------------------------------------------------------------

test('the three bands always sum to the budget, in every column', () => {
  const rows = streamHistory({ ...base, certifications: [{ at: T0 + DAY, target: usdc(60) }] });
  for (const r of rows) {
    assert.equal(r.unlocked + r.arriving + r.uncertified, usdc(100), `column at ${r.at}`);
  }
});

test('no band is ever negative', () => {
  const rows = streamHistory({ ...base, certifications: [{ at: T0, target: usdc(100) }] });
  for (const r of rows) {
    assert.ok(r.unlocked >= 0n && r.arriving >= 0n && r.uncertified >= 0n, `column at ${r.at}`);
  }
});

// THE BANDS MEAN WHAT THE STREAM BAR SAYS THEY MEAN. Its dithered band is
// CERTIFIED, ARRIVING: judged by the agent, not yet delivered by the clock. It
// is NOT "accrued but unjudged", which the bar draws as an empty cell.
test('certified money the clock has not reached is arriving, not uncertified', () => {
  const rows = streamHistory({ ...base, certifications: [{ at: T0, target: usdc(100) }], buckets: 4 });
  assert.equal(rows[0].unlocked, usdc(25), 'a quarter of the clock has run');
  assert.equal(rows[0].arriving, usdc(75), 'the rest is certified and on its way');
  assert.equal(rows[0].uncertified, 0n, 'nothing is unjudged: the agent certified all of it');
});

test('accrued money the agent has not judged is uncertified, not arriving', () => {
  const rows = streamHistory({ ...base, buckets: 4 });
  assert.equal(rows[1].unlocked, 0n, 'nothing green without the agent');
  assert.equal(rows[1].arriving, 0n, 'and nothing is on its way either');
  assert.equal(rows[1].uncertified, usdc(100), 'the clock alone certifies nothing');
});

// THE CLOCK IS THE SECOND GATE, and this is the case that proves it. The agent
// certifies the whole milestone immediately; the contributor still collects on
// schedule, so nothing may be green ahead of the ramp.
test('certifying everything on day one does not turn the whole chart green', () => {
  const rows = streamHistory({ ...base, certifications: [{ at: T0, target: usdc(100) }], buckets: 4 });
  assert.equal(rows[0].unlocked, usdc(25), 'a quarter in, a quarter is earned');
  assert.equal(rows[3].unlocked, usdc(100), 'and it is whole at the end');
});

test('a certification part way through shows as green appearing mid-chart', () => {
  const rows = streamHistory({ ...base, certifications: [{ at: T0 + DAY, target: usdc(40) }], buckets: 4 });
  assert.equal(rows[0].unlocked, 0n, 'before the agent judged');
  assert.equal(rows[0].uncertified, usdc(100), 'and nothing was certified yet');
  assert.equal(rows[2].unlocked, usdc(40), 'after the agent judged, capped by the verdict');
  assert.equal(rows[2].arriving, 0n, 'the clock is past it, so none of it is still arriving');
  assert.equal(rows[2].uncertified, usdc(60), 'the rest was never certified');
});

// --- the span ---------------------------------------------------------------

test('a milestone that has not started has a flat, entirely unaccrued chart', () => {
  const rows = streamHistory({ ...base, startedAt: 0, now: T0 });
  for (const r of rows) {
    assert.equal(r.uncertified, usdc(100));
    assert.equal(r.unlocked, 0n);
  }
});

test('a finished stream stops at its end, not at today', () => {
  // Ended two days ago. Trailing a flat line to now would squeeze everything
  // that actually moved into the left edge.
  const rows = streamHistory({ ...base, now: T0 + 4 * DAY, buckets: 4 });
  assert.equal(rows[rows.length - 1].at, T0 + 2 * DAY, 'the last column is the end of the milestone');
});

test('the column count is honoured and never below two', () => {
  assert.equal(streamHistory({ ...base, buckets: 12 }).length, 12);
  assert.equal(streamHistory({ ...base, buckets: 1 }).length, 2, 'one column is not a chart');
  assert.equal(streamHistory(base).length, 48, 'the default');
});

test('certifications out of order are still read in time order', () => {
  const rows = streamHistory({
    ...base,
    buckets: 4,
    certifications: [
      { at: T0 + 2 * DAY, target: usdc(100) },
      { at: T0 + DAY, target: usdc(40) },
    ],
  });
  assert.equal(rows[2].unlocked, usdc(40), 'the later one does not leak backwards');
});
