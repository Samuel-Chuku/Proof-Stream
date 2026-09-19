import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ago, stamp } from '../app/ago';

const NOW = Date.parse('2026-09-19T12:00:00.000Z');
const back = (seconds: number) => new Date(NOW - seconds * 1000).toISOString();

test('under a minute reads as just now', () => {
  assert.equal(ago(back(0), NOW), 'JUST NOW');
  assert.equal(ago(back(59), NOW), 'JUST NOW');
});

test('minutes and hours are whole units, and one hour is singular', () => {
  assert.equal(ago(back(60), NOW), '1 MIN AGO');
  assert.equal(ago(back(59 * 60), NOW), '59 MIN AGO');
  assert.equal(ago(back(3600), NOW), '1 HOUR AGO');
  assert.equal(ago(back(2 * 3600), NOW), '2 HOURS AGO');
});

test('a day or older falls back to the date, which is the useful fact', () => {
  assert.equal(ago(back(86_400), NOW), null);
  assert.equal(ago(back(90_000), NOW), null);
});

test('a future timestamp falls back rather than counting up', () => {
  // A clock a few seconds ahead of ours must not render "-1 MIN AGO".
  assert.equal(ago(new Date(NOW + 5000).toISOString(), NOW), null);
});

test('garbage falls back to the stamp instead of throwing', () => {
  assert.equal(ago('not a date', NOW), null);
});

test('the stamp is date first, then UTC clock time', () => {
  assert.equal(stamp('2026-09-19T07:51:16.000Z'), '19 SEP 07:51:16');
});
