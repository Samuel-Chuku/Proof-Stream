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
