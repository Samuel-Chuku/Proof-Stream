// HOW MUCH ONE WITHDRAWAL MAY MOVE, computed the way withdrawFor() checks it.
//
// Client-safe and pure. Three ceilings apply at once: the earner's own share,
// the per-call cap, and what is left of the day's cap after everyone else's
// withdrawals on this stream. The contract reverts on whichever is exceeded,
// and a reverted withdrawal costs a signature and teaches nothing, so the page
// only ever asks for the largest amount that will succeed.

export type CapInputs = {
  /** The earner's remaining share of this milestone, USDC units. */
  withdrawable: bigint;
  claimCap: bigint;
  dailyClaimCap: bigint;
  /** Paid out on this stream during `claimDayBucket`, all earners. */
  claimedToday: bigint;
  /** `block.timestamp / 1 days` when `claimedToday` was last written. */
  claimDayBucket: bigint;
  /** Unix seconds. */
  now: number;
};

const DAY = 86_400n;

/// What the day's cap still allows. The contract resets the bucket the first
/// time a withdrawal lands on a new UTC day, so a stale bucket means a full cap.
export function dailyHeadroom(c: Pick<CapInputs, 'dailyClaimCap' | 'claimedToday' | 'claimDayBucket' | 'now'>): bigint {
  const today = BigInt(Math.floor(c.now)) / DAY;
  const spent = c.claimDayBucket === today ? c.claimedToday : 0n;
  return c.dailyClaimCap > spent ? c.dailyClaimCap - spent : 0n;
}

/// The most withdrawFor() will accept right now, and which ceiling set it.
export function withdrawableNow(c: CapInputs): { amount: bigint; boundBy: 'share' | 'call' | 'day' } {
  const day = dailyHeadroom(c);
  let amount = c.withdrawable;
  let boundBy: 'share' | 'call' | 'day' = 'share';
  if (c.claimCap < amount) {
    amount = c.claimCap;
    boundBy = 'call';
  }
  if (day < amount) {
    amount = day;
    boundBy = 'day';
  }
  return { amount, boundBy };
}
