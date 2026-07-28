import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  formatNative,
  formatUsdc,
  parseNative,
  parseUsdc,
} from '../src/amounts';

test('known USDC amount round-trips at 6 dp', () => {
  assert.equal(formatUsdc(1_234_567n), '1.234567');
  assert.equal(parseUsdc('1.234567'), 1_234_567n);
  assert.equal(parseUsdc(formatUsdc(1_234_567n)), 1_234_567n);
});

test('USDC round-trip holds across edge values', () => {
  for (const raw of [0n, 1n, 999_999n, 1_000_000n, 1_000_000_000_000n]) {
    assert.equal(parseUsdc(formatUsdc(raw)), raw);
  }
});

test('known native amount round-trips at 18 dp', () => {
  const raw = 99_990_526_519_160_000_000n; // ~99.99 USDC as native gas units
  assert.equal(formatNative(raw), '99.99052651916');
  assert.equal(parseNative(formatNative(raw)), raw);
});

test('the same balance differs by exactly 1e12 between native and ERC-20 scales', () => {
  const erc20 = 99_990_526n;
  const native = erc20 * 10n ** 12n;
  assert.equal(formatUsdc(erc20), '99.990526');
  assert.equal(formatNative(native), '99.990526');
});
