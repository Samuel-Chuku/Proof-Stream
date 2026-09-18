import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dailyHeadroom, withdrawableNow } from '../lib/withdraw-cap';

const usdc = (n: number) => BigInt(Math.round(n * 1_000_000));
const NOW = 1_800_000_000; // some UTC day
const TODAY = BigInt(Math.floor(NOW / 86_400));

test('the share is the ceiling when the caps are wider', () => {
  const r = withdrawableNow({
    withdrawable: usdc(3), claimCap: usdc(10), dailyClaimCap: usdc(50), claimedToday: 0n, claimDayBucket: TODAY, now: NOW,
  });
  assert.deepEqual(r, { amount: usdc(3), boundBy: 'share' });
});

test('the per-call cap trims a larger share', () => {
  const r = withdrawableNow({
    withdrawable: usdc(30), claimCap: usdc(10), dailyClaimCap: usdc(50), claimedToday: 0n, claimDayBucket: TODAY, now: NOW,
  });
  assert.deepEqual(r, { amount: usdc(10), boundBy: 'call' });
});

test("today's earlier withdrawals by anyone on the stream eat the daily cap", () => {
  const r = withdrawableNow({
    withdrawable: usdc(30), claimCap: usdc(10), dailyClaimCap: usdc(12), claimedToday: usdc(5), claimDayBucket: TODAY, now: NOW,
  });
  assert.deepEqual(r, { amount: usdc(7), boundBy: 'day' });
});

test('a bucket from another day counts for nothing, exactly as the contract resets it', () => {
  assert.equal(
    dailyHeadroom({ dailyClaimCap: usdc(12), claimedToday: usdc(12), claimDayBucket: TODAY - 1n, now: NOW }),
    usdc(12),
  );
});

test('a spent day leaves zero, never a negative', () => {
  assert.equal(
    dailyHeadroom({ dailyClaimCap: usdc(12), claimedToday: usdc(13), claimDayBucket: TODAY, now: NOW }),
    0n,
  );
});
