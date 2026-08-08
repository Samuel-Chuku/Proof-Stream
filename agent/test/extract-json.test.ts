import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractJson } from '../src/json';

test('a bare object parses', () => {
  assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
});

test('a fenced object parses', () => {
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
});

test('prose before the object no longer fails', () => {
  // THE LIVE FAILURE, 2026-08-08. The verifier answered with a sentence of
  // analysis and then its object; the old parser called JSON.parse on the whole
  // string, threw, and returned HTTP 500. The attestor then refused to release
  // without a second opinion — so a correct review became a blocked payout.
  const reply =
    'Looking at the final state of `src/ledger.ts`, the `balanceAt` function is fully ' +
    'implemented and correct: it filters records by timestamp, then reduces over them.\n\n' +
    '{"satisfies_milestone": true, "confidence": 0.9, "tranche_fraction": 0.6, ' +
    '"reasoning": "the tests cover it", "red_flags": []}';
  assert.deepEqual(extractJson(reply), {
    satisfies_milestone: true,
    confidence: 0.9,
    tranche_fraction: 0.6,
    reasoning: 'the tests cover it',
    red_flags: [],
  });
});

test('prose after the object is ignored too', () => {
  assert.deepEqual(extractJson('{"a":1}\n\nHope that helps!'), { a: 1 });
});

test('a brace inside a string does not end the object early', () => {
  // The reason field is free text written by a model describing code, so `{`
  // and `}` in it are routine. Counting braces without tracking strings would
  // cut the object at the first one.
  const reply = 'Here:\n{"reasoning": "the function body is { ... } as expected", "confidence": 1}';
  assert.deepEqual(extractJson(reply), {
    reasoning: 'the function body is { ... } as expected',
    confidence: 1,
  });
});

test('an escaped quote inside a string does not end it', () => {
  const reply = '{"reasoning": "it returns \\"undefined\\" before any activity", "confidence": 1}';
  assert.deepEqual(extractJson(reply), {
    reasoning: 'it returns "undefined" before any activity',
    confidence: 1,
  });
});

test('nested objects survive', () => {
  assert.deepEqual(extractJson('noise {"a":{"b":{"c":2}},"d":3} noise'), {
    a: { b: { c: 2 } },
    d: 3,
  });
});

test('prose with no object at all is still a failure', () => {
  // This must stay null. A reply carrying no verdict is not a verdict, and
  // inventing one would pay out on an opinion nobody gave.
  assert.equal(extractJson('I need to see the actual diff content to evaluate this PR.'), null);
});

test('a truncated object is a failure, not a half-verdict', () => {
  assert.equal(extractJson('{"satisfies_milestone": true, "confidence": 0.'), null);
});
