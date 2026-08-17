import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CAP_STEP, capStops, stopFor, stopIndexFor } from '../lib/caps';

const usdc = (n: number) => n * CAP_STEP;

test('the budget is always the last stop', () => {
  // THE BUG. With min=7.50, step=1 and max=30 the browser's last selectable
  // value is 29.50, so an employer could not raise the cap to the full budget
  // at all — the one thing the panel is for.
  const stops = capStops(usdc(7.5), usdc(30));
  assert.equal(stops[stops.length - 1], usdc(30));
});

test('both endpoints are exact, and the middle is whole USDC', () => {
  const stops = capStops(usdc(7.5), usdc(12));
  assert.deepEqual(stops, [usdc(7.5), usdc(8), usdc(9), usdc(10), usdc(11), usdc(12)]);
});

test('a whole-USDC starting cap is not repeated', () => {
  const stops = capStops(usdc(8), usdc(11));
  assert.deepEqual(stops, [usdc(8), usdc(9), usdc(10), usdc(11)]);
});

test('a span narrower than one step still offers both ends', () => {
  // A 29.80 cap on a 30 budget has no whole USDC between them. The slider must
  // still be able to say "raise it to the budget".
  assert.deepEqual(capStops(usdc(29.8), usdc(30)), [usdc(29.8), usdc(30)]);
});

test('stops always ascend, so a slider index means one thing', () => {
  for (const [from, to] of [
    [7.5, 30],
    [0.000001, 3],
    [29.8, 30],
    [1, 100],
  ] as const) {
    const stops = capStops(usdc(from), usdc(to));
    for (let i = 1; i < stops.length; i++) {
      assert.ok(stops[i] > stops[i - 1], `not ascending at ${i} for ${from}->${to}`);
    }
  }
});

test('a cap already at the budget yields a single stop', () => {
  // capsRaisable hides the panel in this case, but the helper must not return
  // an empty list and hand the slider an undefined value.
  assert.deepEqual(capStops(usdc(30), usdc(30)), [usdc(30)]);
});

test('every stop round-trips through its index', () => {
  // This is the property that keeps the DOM and React in agreement: whatever
  // the slider commits must be a member of the list it is indexed over.
  const stops = capStops(usdc(7.5), usdc(30));
  for (const s of stops) {
    assert.equal(stops[stopIndexFor(stops, s)], s);
    assert.equal(stopFor(stops, s), s);
  }
});

test('a value between stops rounds UP to a valid one', () => {
  // Raising the per-certification cap drags the daily cap with it, and the
  // value it is dragged to belongs to the other slider's list. Rounding down
  // would leave the daily cap below the per-certification one, which the
  // contract rejects.
  const stops = capStops(usdc(5), usdc(30));
  assert.equal(stopFor(stops, usdc(8.4)), usdc(9));
  assert.equal(stopFor(stops, usdc(5.1)), usdc(6));
});

test('a value above every stop clamps to the budget', () => {
  const stops = capStops(usdc(7.5), usdc(30));
  assert.equal(stopFor(stops, usdc(999)), usdc(30));
});

test('the committed value is never below the current cap', () => {
  // raisePolicy reverts CapsMayOnlyRise, so a stop under the standing cap would
  // cost a signature and gas for a guaranteed revert.
  const current = usdc(7.5);
  const stops = capStops(current, usdc(30));
  for (const s of stops) assert.ok(s >= current);
});
