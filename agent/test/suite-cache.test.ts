// The suite cache decides whether two evidence counts are comparable, so a bug
// here does not crash anything — it silently makes "two more tests pass" a
// false statement, which is worse.
//
// The module takes its directory as an argument and imports nothing of ours,
// so this runs against a temp directory with no .env at all.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadSuite, saveSuite, noteUse, dropSuite, suiteId, MAX_USES } from '../src/suite-cache';

const dir = join(mkdtempSync(join(tmpdir(), 'proofstream-suite-cache-')), 'suites');

/** Mirrors the module's own filename derivation, so a test can corrupt an entry. */
const fileFor = (key: string) =>
  join(dir, `${createHash('sha256').update(key).digest('hex').slice(0, 32)}.json`);

const KEY = '0xstream:0xmilestonehash';
const TESTS = 'import test from "node:test";\ntest("a", () => {});\n';

after(() => rmSync(dir, { recursive: true, force: true }));

test('an unknown milestone has no cached suite', () => {
  assert.equal(loadSuite(dir, 'never-seen-before'), null);
});

test('a saved suite comes back with the same tests', () => {
  saveSuite(dir, KEY, TESTS);
  const got = loadSuite(dir, KEY);
  assert.equal(got?.tests, TESTS);
  assert.equal(got?.uses, 1, 'saving counts as the first use');
  assert.equal(got?.id, suiteId(TESTS));
});

test('THE RULER: the id changes when the suite does, and only then', () => {
  // Two results are comparable only when this matches. If a regenerated suite
  // kept the same id, the evidence gate would compare test counts from two
  // different suites and call the difference an improvement.
  assert.equal(suiteId(TESTS), suiteId(TESTS));
  assert.notEqual(suiteId(TESTS), suiteId(`${TESTS}\ntest("b", () => {});\n`));
});

test('A SUITE IS RETIRED AFTER MAX_USES, so a bad generation cannot govern a milestone forever', () => {
  const key = 'retirement';
  saveSuite(dir, key, TESTS);
  // One use is already recorded by the save.
  for (let i = 1; i < MAX_USES; i++) {
    assert.ok(loadSuite(dir, key), `should still be usable on use ${i}`);
    noteUse(dir, key);
  }
  assert.equal(loadSuite(dir, key), null, 'must be retired once it reaches MAX_USES');
});

test('dropping a suite forgets it immediately', () => {
  const key = 'droppable';
  saveSuite(dir, key, TESTS);
  assert.ok(loadSuite(dir, key));
  dropSuite(dir, key);
  assert.equal(loadSuite(dir, key), null);
});

test('dropping a suite that was never cached is not an error', () => {
  assert.doesNotThrow(() => dropSuite(dir, 'nothing-here'));
});

test('a corrupt entry reads as no cache rather than throwing', () => {
  // The judgment must survive a half-written file. Degrading to "regenerate"
  // costs one generation; throwing would take down a payout.
  const key = 'corrupt';
  saveSuite(dir, key, TESTS);
  writeFileSync(fileFor(key), '{ this is not json');
  assert.equal(loadSuite(dir, key), null);
});

test('an entry missing its tests reads as no cache', () => {
  const key = 'empty-tests';
  saveSuite(dir, key, TESTS);
  writeFileSync(fileFor(key), JSON.stringify({ id: 'x', tests: '   ', uses: 1 }));
  assert.equal(loadSuite(dir, key), null, 'a blank suite is not a suite');
});

test('two milestones do not share a suite', () => {
  saveSuite(dir, 'stream-a:hash-1', TESTS);
  const other = `${TESTS}\ntest("different", () => {});\n`;
  saveSuite(dir, 'stream-a:hash-2', other);
  assert.equal(loadSuite(dir, 'stream-a:hash-1')?.tests, TESTS);
  assert.equal(loadSuite(dir, 'stream-a:hash-2')?.tests, other);
});

test('a key containing path separators cannot escape the cache directory', () => {
  // Keys are built from an address and an on-chain hash, but filenames come
  // from a digest rather than the key, so traversal is not expressible.
  const nasty = '../../../etc/passwd';
  assert.doesNotThrow(() => saveSuite(dir, nasty, TESTS));
  assert.equal(loadSuite(dir, nasty)?.tests, TESTS);
});
