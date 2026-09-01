// The certification arithmetic, lifted out of the pipeline so it can be tested.
// Deliberately free of any import, so the tests for it run without an .env.
//
// This maths has been rewritten twice and had no test of any kind. It decides
// how much money a contributor is owed, so a rounding error here is a real
// payment error.

/** Only the fields the arithmetic needs. `readStream` returns a superset. */
export type MeteringInputs = {
  /** USDC committed to this milestone. Never zero here: `judgeForStream`
   *  refuses an unfunded milestone long before this runs. */
  budget: bigint;
  /** What the agent has ALREADY certified is owed, in USDC. */
  target: bigint;
  /** The most one attestation may add to `target`. */
  maxTranche: bigint;
  /** The standing verdict, 0-10_000. Monotonic on chain. */
  certifiedBps: bigint;
};

export type Metering = {
  /** What the two agents agreed, in basis points, before any policy applies. */
  desiredBps: bigint;
  /** What this attestation may actually certify, once `maxTranche` is applied. */
  certifiedBps: bigint;
  /** The contributor's total claim once this certification lands, in USDC. */
  cappedTarget: bigint;
  /** What THIS attestation adds to that claim. **May be negative** — see the
   *  note below. Callers must check `raises` before spending it. */
  trancheAdded: bigint;
  /** True when `maxTranche` clipped the verdict, so the agents agreed more than
   *  this attestation can certify. The remainder needs another judgment. */
  metered: boolean;
  /** True when this verdict actually raises the standing certification. False
   *  means there is nothing to send: the contract's `certifiedBps` is monotonic
   *  and would revert `NotAnIncrease`. */
  raises: boolean;
};

/// Turn an agreed fraction into what this attestation may certify.
///
/// Two separate limits are at work and they are easy to confuse:
///   - `maxTranche` bounds ONE attestation. It is a step limit.
///   - `dailyUnlockCap` bounds a UTC day. It is a rate limit, enforced on chain
///     only, and deliberately not modelled here.
///
/// We meter to `maxTranche` rather than letting the contract revert, because
/// certification is monotonic: a clipped verdict still moves the contributor
/// forward, and the next judgment can add the rest. Reverting would throw the
/// whole verdict away.
export function meterCertification(agreedFraction: number, stream: MeteringInputs): Metering {
  const desiredBps = BigInt(Math.round(agreedFraction * 10_000));

  // What the agents think is owed in total, ignoring policy.
  const fullTarget = (stream.budget * desiredBps) / 10_000n;

  // What policy will admit: the standing claim plus one tranche.
  const headroom = stream.target + stream.maxTranche;
  const cappedTarget = fullTarget > headroom ? headroom : fullTarget;

  const certifiedBps = (cappedTarget * 10_000n) / stream.budget;

  return {
    desiredBps,
    certifiedBps,
    cappedTarget,
    // NEGATIVE when a later judgment scores the milestone LOWER than the
    // standing certification. That is normal, because model judgment varies
    // between runs, and it is exactly why `raises` exists. Certification never
    // falls, so a lower verdict simply does nothing.
    trancheAdded: cappedTarget - stream.target,
    metered: certifiedBps < desiredBps,
    raises: certifiedBps > stream.certifiedBps,
  };
}

/// HOW SURE THE AGENT HAS TO BE, GIVEN HOW MUCH IT IS CLAIMING.
///
/// One flat bar treats "this is 20% done" and "this is 100% done" as the same
/// assertion. They are not. The second claims far more, and because the standing
/// certification is MONOTONIC it can never be walked back, so it is the one
/// where being wrong is permanent.
///
/// The bar therefore rises with the LEVEL being claimed, not with the size of
/// the step taken to reach it. That distinction matters: going from 95% to 100%
/// is a tiny step and an enormous claim, and it is exactly the case that turned
/// a comment-only merge into a full certification. Judged by step size it looks
/// trivial; judged by what it asserts, it is the largest claim available.
///
/// Below the bar, existing behaviour is unchanged: nothing releases and the work
/// waits. Nothing is lost by waiting, because certification is cumulative and
/// the next judgment sees everything already in the branch.
///
/// NEVER RETURNS LESS THAN `base`. An operator who sets a high threshold has
/// asked for strictness; the ceiling must not quietly relax it.
export function requiredConfidence(base: number, claimedBps: bigint): number {
  const level = Math.max(0, Number(claimedBps) / 10_000);
  const required = base + Math.min(level, FULL_CLAIM_AT) * CONFIDENCE_SLOPE;
  return Math.min(required, Math.max(base, CONFIDENCE_CEILING));
}

/// Claiming this much or more is treated as a maximal claim: the bar stops
/// rising at 90%, so 90% and 100% are held to the same standard. Above this
/// point the difference is noise, and the assertion is the same one either way.
const FULL_CLAIM_AT = 0.9;

/// Set so a claim of 90% or above requires 0.85 against the default 0.70 base,
/// which is the line the human drew. 0.15 / 0.9 = 1/6.
///
/// CALIBRATED AGAINST 271 REAL JUDGMENTS, not chosen by taste. The models
/// cluster high — median confidence 0.95, and 81% at 0.85 or above — so 0.85 is
/// comfortably reachable rather than aspirational. Of the 38 judgments that
/// claimed 90% or more, only 3 fell short of it.
///
/// A guard that stops one bad payout by stopping two good ones is not a guard.
/// This comes from the measured distribution and should be re-derived from the
/// ledger rather than nudged.
const CONFIDENCE_SLOPE = 0.15 / 0.9;

/// No claim may demand more than this, or a confident and genuinely complete
/// delivery could never certify at all — stranding exactly the work this system
/// exists to pay for. Inert at the default base, where nothing exceeds 0.85.
const CONFIDENCE_CEILING = 0.95;

/// THE TWO AGENTS LOOKING AT ONE REPOSITORY AND SEEING DIFFERENT THINGS.
///
/// The payout already takes the LOWER of the two fractions, so a 0.9 against a
/// 0.5 quietly pays 0.5. That is safe on amount and silent on meaning: a gap
/// that wide says neither agent has a reliable read, and discounting it hides
/// the signal instead of acting on it.
///
/// Beyond this gap the judgment is held rather than discounted. The verifier
/// vetoing outright (a fraction of zero) is handled separately and still vetoes.
export function agentsDisagree(attestorFraction: number, verifierFraction: number): boolean {
  return Math.abs(attestorFraction - verifierFraction) > MAX_AGENT_GAP;
}

/// 20 points. Below this the two agents are reading the same work and pricing
/// it slightly differently, which is normal and what `min()` is for. Above it
/// they disagree about what the work IS.
const MAX_AGENT_GAP = 0.2;
