// WHERE A STREAM'S MONEY WAS, OVER TIME.
//
// The stream bar answers "where is the money now". It is a snapshot, and it
// cannot say when anything moved. This is the same quantity across time, in the
// same four states, so the two read as one idea rather than two charts.
//
// NOT A PRICE. A stream's balance is deterministic and piecewise: accrual is a
// straight ramp the clock draws, certification is a step the agent takes, and
// nothing is noisy. Drawing it as a smooth wobble would invent volatility that
// does not exist, so every series here is a STEP or a RAMP and nothing is
// interpolated.
//
// Pure, and free of any import, so it is tested without a chain or an .env.
// Every figure is raw 6dp USDC, like everything else that touches money.

/** One column of the chart. The three bands always sum to `budget`.
 *
 *  THE SAME THREE THE STREAM BAR USES, and named the same way on purpose. The
 *  bar's axis is CERTIFICATION, not accrual: its dithered band is work the
 *  agent has certified that the clock has not delivered yet, NOT work the clock
 *  delivered that the agent has not judged. Decomposing this chart the other
 *  way round would put the same colour against a different meaning on one page. */
export type Bucket = {
  /** Unix seconds at the END of this bucket, which is what its state describes. */
  at: number;
  /** Certified by the agent AND delivered by the clock. Green, lawfully: this is
   *  the same money a stream-bar cell fills for. The bar calls it EARNED. */
  unlocked: bigint;
  /** Certified, but the clock has not reached it. Dither. The bar calls it
   *  CERTIFIED, ARRIVING. */
  arriving: bigint;
  /** No verdict has reached this money. Sunk, empty. The bar calls it NOT
   *  CERTIFIED. */
  uncertified: bigint;
};

export type HistoryInputs = {
  budget: bigint;
  /** Unix seconds the clock started. 0 when the milestone never activated,
   *  which makes the whole span unaccrued rather than dividing by zero. */
  startedAt: number;
  /** Seconds the milestone runs for. */
  duration: number;
  /** Where to stop. A running stream stops at now; a finished one at its end. */
  now: number;
  /** Every certification, ascending by time. `target` is the CUMULATIVE claim
   *  after that certification, not the tranche it added, because the contract's
   *  own `target()` is what the contributor can draw against. */
  certifications: readonly { at: number; target: bigint }[];
  /** How many columns. The stream bar caps at 60 cells and this caps at 48 for
   *  the same reason: past that they stop being countable and become texture. */
  buckets?: number;
};

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/// What the clock has released by `t`, ignoring whether anybody certified it.
///
/// Proportional, computed fresh, never a stored per-second rate: the contract
/// does the same, and a derived rate loses dust on every tick.
export function accruedAt(t: number, budget: bigint, startedAt: number, duration: number): bigint {
  if (startedAt <= 0 || duration <= 0 || t <= startedAt) return 0n;
  const elapsed = clamp(t - startedAt, 0, duration);
  if (elapsed >= duration) return budget;
  // bigint throughout: 6dp USDC times a large second count overflows the safe
  // integer range long before it overflows a bigint.
  return (budget * BigInt(elapsed)) / BigInt(duration);
}

/// The standing claim at `t`: the last certification at or before it.
///
/// Certification is MONOTONIC on chain, so this only ever climbs, and a later
/// verdict that scored lower could never have been sent.
export function certifiedAt(t: number, certifications: HistoryInputs['certifications']): bigint {
  let target = 0n;
  for (const c of certifications) {
    if (c.at > t) break;
    if (c.target > target) target = c.target;
  }
  return target;
}

/// The columns. Always `buckets` of them, evenly spaced across the stream's own
/// span, so two streams of different lengths are read the same way.
export function streamHistory(o: HistoryInputs): Bucket[] {
  const count = Math.max(2, o.buckets ?? 48);

  // THE SPAN IS THE STREAM'S, NOT THE CLOCK'S. A milestone that has not started
  // has no span to draw, and one that ended stops at its end rather than
  // trailing a flat line to today, which would shrink the part that moved.
  const from = o.startedAt > 0 ? o.startedAt : o.now;
  const to = o.startedAt > 0 ? Math.min(o.now, o.startedAt + o.duration) : o.now;
  const span = Math.max(1, to - from);

  const sorted = [...o.certifications].sort((a, b) => a.at - b.at);

  return Array.from({ length: count }, (_, i) => {
    const at = from + Math.round((span * (i + 1)) / count);
    const accrued = accruedAt(at, o.budget, o.startedAt, o.duration);
    // THE CLOCK IS THE SECOND GATE. The agent can certify the whole milestone on
    // day one and the contributor still collects on schedule, so what is
    // actually earned is whichever of the two is behind.
    const certified = certifiedAt(at, sorted);
    const unlocked = certified < accrued ? certified : accrued;
    return {
      at,
      unlocked,
      arriving: certified - unlocked,
      uncertified: o.budget - certified,
    };
  });
}
