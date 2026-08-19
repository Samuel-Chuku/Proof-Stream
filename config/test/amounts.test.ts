import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatNative, formatUsdc, parseNative, parseUsdc, parseUsdcLoose } from '../src/amounts';

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

// `parseUsdcLoose` exists because the strict parser took a page down.
//
// `trancheUsdc` arrives over HTTP from the agent's event feed, unvalidated. A
// non-decimal value made `parseUnits` throw out of an async Server Component and
// 500 the whole stream page, where the worst a bad row should do is show zero.
test('parseUsdcLoose parses a real amount exactly like the strict one', () => {
  assert.equal(parseUsdcLoose('1.234567'), parseUsdc('1.234567'));
  assert.equal(parseUsdcLoose('40'), parseUsdc('40'));
  assert.equal(parseUsdcLoose(' 12.5 '), parseUsdc('12.5'));
});

test('parseUsdcLoose returns zero for everything the strict one throws on', () => {
  for (const bad of ['', '   ', 'abc', 'NaN', '1.2.3', '--5', undefined, null]) {
    assert.equal(parseUsdcLoose(bad as string), 0n, `${JSON.stringify(bad)} should be 0n`);
  }
});

test('the strict parser still throws, because a form field is not a log row', () => {
  assert.throws(() => parseUsdc(''));
  assert.throws(() => parseUsdc('abc'));
});
