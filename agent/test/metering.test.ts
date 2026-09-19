import assert from 'node:assert/strict';
import { test } from 'node:test';
import { meterCertification, type MeteringInputs } from '../src/metering';

/** USDC is 6 decimals. Every amount below is raw units. */
const usdc = (n: number) => BigInt(Math.round(n * 1_000_000));

/** A stream with no policy throttle: `maxTranche` defaults to the whole budget. */
const stream = (over: Partial<MeteringInputs> = {}): MeteringInputs => ({
  budget: usdc(100),
  target: 0n,
  maxTranche: usdc(100),
  certifiedBps: 0n,
  ...over,
});

test('an uncapped full verdict certifies the whole budget', () => {
  const m = meterCertification(1.0, stream());
  assert.equal(m.certifiedBps, 10_000n);
  assert.equal(m.cappedTarget, usdc(100));
  assert.equal(m.trancheAdded, usdc(100));
  assert.equal(m.metered, false);
  assert.equal(m.raises, true);
});

test('partial work is priced partially — the 60% demo case', () => {
  // 60 USDC budget, both agents at 0.6, no throttle. This is the number on
  // camera in the demo, so it is worth pinning.
  const m = meterCertification(0.6, stream({ budget: usdc(60), maxTranche: usdc(60) }));
  assert.equal(m.certifiedBps, 6_000n);
  assert.equal(m.cappedTarget, usdc(36));
  assert.equal(m.metered, false);
});

test('THE 67 USDC BUG: a low maxTranche clips a nearly-finished milestone', () => {
  // This cost a real contributor real money on 2026-08-08. Budget 100,
  // maxTranche 30, both agents agreed 0.97. The agents said 97 USDC was owed;
  // policy admitted 30, and the rest refunded to the employer on close.
  const m = meterCertification(0.97, stream({ maxTranche: usdc(30) }));

  assert.equal(m.desiredBps, 9_700n, 'the agents agreed 97%');
  assert.equal(m.certifiedBps, 3_000n, 'policy admits 30%');
  assert.equal(m.cappedTarget, usdc(30));
  assert.equal(m.metered, true, 'the verdict was clipped, so more is owed than certified');
  assert.equal(m.raises, true);

  // The gap that got refunded to the employer when the milestone closed.
  assert.equal(usdc(97) - m.cappedTarget, usdc(67));
});

test('a clipped certification climbs on the next judgment', () => {
  // Same stream one certification later. Nothing new merged; the same 0.97
  // verdict now adds the next tranche, because headroom moved with `target`.
  const m = meterCertification(0.97, stream({ maxTranche: usdc(30), target: usdc(30), certifiedBps: 3_000n }));
  assert.equal(m.certifiedBps, 6_000n);
  assert.equal(m.trancheAdded, usdc(30));
  assert.equal(m.metered, true, 'still short of 97%');
  assert.equal(m.raises, true);
});

test('the last climb lands on the agreed figure, not past it', () => {
  // Third step: headroom is 90+30=120, but the agents only ever agreed 97.
  const m = meterCertification(0.97, stream({ maxTranche: usdc(30), target: usdc(90), certifiedBps: 9_000n }));
  assert.equal(m.cappedTarget, usdc(97), 'capped by the verdict, not by policy');
  assert.equal(m.certifiedBps, 9_700n);
  assert.equal(m.trancheAdded, usdc(7));
  assert.equal(m.metered, false, 'nothing was clipped this time');
});

test('re-judging finished work raises nothing', () => {
  // A redelivered webhook or a reconcile after a restart. The contract would
  // revert NotAnIncrease, so the pipeline must not send this.
  const m = meterCertification(0.97, stream({ target: usdc(97), certifiedBps: 9_700n }));
  assert.equal(m.certifiedBps, 9_700n);
  assert.equal(m.trancheAdded, 0n);
  assert.equal(m.raises, false);
});

test('a LOWER later verdict yields a negative tranche and must not be sent', () => {
  // Model judgment varies between runs. A stream certified at 90% that scores
  // 0.5 on a later merge produces a negative tranche. Certification
  // is monotonic, so the answer is to do nothing — but the arithmetic really
  // does go negative, and a caller that spent `trancheAdded` without checking
  // `raises` would report a negative payout.
  const m = meterCertification(0.5, stream({ target: usdc(90), certifiedBps: 9_000n }));
  assert.equal(m.cappedTarget, usdc(50));
  assert.equal(m.trancheAdded, -usdc(40));
  assert.equal(m.raises, false, 'this is the guard that stops it reaching the chain');
});

test('a zero verdict raises nothing and is not mistaken for a cap', () => {
  const m = meterCertification(0, stream());
  assert.equal(m.desiredBps, 0n);
  assert.equal(m.certifiedBps, 0n);
  assert.equal(m.metered, false, 'nothing was clipped — there was nothing to clip');
  assert.equal(m.raises, false);
});

test('maxTranche above the budget never clips', () => {
  const m = meterCertification(1.0, stream({ maxTranche: usdc(10_000) }));
  assert.equal(m.certifiedBps, 10_000n);
  assert.equal(m.metered, false);
});

test('an awkward fraction round-trips without falsely reporting a cap', () => {
  // bps -> USDC -> bps goes through two floor divisions. At realistic 6-dp
  // budgets that must not lose a basis point, or `metered` would be true on a
  // stream nothing actually capped, and anything that later tops up a clipped
  // certification would chase a remainder that does not exist.
  for (const fraction of [0.3333, 0.6667, 0.0001, 0.9999, 0.1234]) {
    for (const budget of [usdc(7), usdc(60), usdc(100), usdc(12.5)]) {
      const m = meterCertification(fraction, stream({ budget, maxTranche: budget }));
      assert.equal(
        m.certifiedBps,
        m.desiredBps,
        `${fraction} of ${budget} lost precision: ${m.desiredBps} -> ${m.certifiedBps}`,
      );
      assert.equal(m.metered, false, `${fraction} of ${budget} falsely reported as capped`);
    }
  }
});

test('the fraction is rounded, not truncated, on the way to basis points', () => {
  // 0.60005 * 10000 = 6000.5. Truncating would quietly underpay.
  assert.equal(meterCertification(0.60005, stream()).desiredBps, 6_001n);
  assert.equal(meterCertification(0.60004, stream()).desiredBps, 6_000n);
});

// --- how sure the agent must be, given how much it is claiming ------------
//
// The bar rises with the LEVEL claimed, not the size of the step taken to reach
// it. Going 95% to 100% is a tiny step and the largest claim available, and it
// is the case that let a comment-only merge take a standing 95% to a full
// certification.

import { requiredConfidence, agentsDisagree } from '../src/metering';

const BASE = 0.7;

/** Confidence is a float, so compare with tolerance. */
const near = (actual: number, expected: number, what: string) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${what}: expected ~${expected}, got ${actual}`);

test('THE LINE THE HUMAN DREW: claiming 90% or more requires 0.85', () => {
  near(requiredConfidence(BASE, 9_000n), 0.85, 'a 90% claim');
  near(requiredConfidence(BASE, 9_500n), 0.85, 'a 95% claim');
  near(requiredConfidence(BASE, 10_000n), 0.85, 'a 100% claim');
});

test('a small claim is held to the operator threshold, near enough unchanged', () => {
  near(requiredConfidence(BASE, 0n), 0.7, 'a zero claim');
  assert.ok(requiredConfidence(BASE, 1_000n) < 0.72, 'a 10% claim must stay close to the base');
});

test('the bar rises through the middle of the range', () => {
  near(requiredConfidence(BASE, 2_500n), 0.7 + 0.25 * (0.15 / 0.9), 'a 25% claim');
  near(requiredConfidence(BASE, 5_000n), 0.7 + 0.5 * (0.15 / 0.9), 'a 50% claim');
});

test('A TINY STEP TO A HUGE CLAIM IS STILL A HUGE CLAIM', () => {
  // The original bug: 95% to 100% on a comment-only merge. Judged by step size
  // this is trivial. Judged by what it asserts, it is the largest claim there
  // is, and it must be held to the same bar as reaching 100% from zero.
  assert.equal(requiredConfidence(BASE, 10_000n), requiredConfidence(BASE, 10_000n));
  near(requiredConfidence(BASE, 10_000n), 0.85, 'going to 100% from anywhere');
});

test('the ceiling never relaxes a stricter operator threshold', () => {
  // An operator who sets 0.99 has asked for strictness. The ceiling must not
  // quietly hand back a lower bar than they configured.
  assert.equal(requiredConfidence(0.99, 10_000n), 0.99);
});

test('the required bar never falls as the claim grows', () => {
  let previous = 0;
  for (let bps = 0; bps <= 10_000; bps += 250) {
    const req = requiredConfidence(BASE, BigInt(bps));
    assert.ok(req >= previous, `bar fell at ${bps}bps: ${req} < ${previous}`);
    previous = req;
  }
});

test('a negative or zero claim demands only the base', () => {
  assert.equal(requiredConfidence(BASE, 0n), BASE);
  assert.equal(requiredConfidence(BASE, -100n), BASE);
});

// --- the two agents disagreeing about what the work IS ----------------------

test('a normal spread between the agents is not a disagreement', () => {
  // min() already handles pricing the same work slightly differently.
  assert.equal(agentsDisagree(0.9, 0.8), false);
  assert.equal(agentsDisagree(1.0, 0.8), false, '20 points exactly is still agreement');
});

test('a wide split is a disagreement, whichever agent is higher', () => {
  assert.equal(agentsDisagree(0.9, 0.5), true);
  assert.equal(agentsDisagree(0.5, 0.9), true, 'the test must not depend on argument order');
});

test('identical readings never disagree', () => {
  assert.equal(agentsDisagree(0.6, 0.6), false);
  assert.equal(agentsDisagree(0, 0), false);
});
