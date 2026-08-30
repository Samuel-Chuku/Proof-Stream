// The correctness check decides whether a contributor looks like they shipped
// something broken, so every branch of it decides whether someone is paid. None
// of it needs a model, a sandbox or a network to be wrong, which is why all of
// it is tested here without one.
//
// Two properties matter more than the rest and both have their own tests below:
//
//   1. IT MAY NOT INVENT A FAILURE. Generated tests over-specify constantly. A
//      failure that the earlier version of the repository ALSO had says nothing
//      about this work, and must never reach the judgment as though it did.
//   2. IT MAY NOT REPORT A PASS IT DID NOT EARN. The filter clears failures by
//      finding them on the reference too — so a reference that fails everything
//      clears everything, and the check comes back green having established
//      nothing at all, in the direction that releases money.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { adjudicate, parseTap, type SuiteRun } from '../src/adjudicate';

const run = (failed: string[], passed: number): SuiteRun => ({
  failed: new Set(failed),
  passed,
  failedCount: failed.length,
  total: passed + failed.length,
  void: false,
});

const voided = (reason: string): SuiteRun => ({
  failed: new Set(),
  passed: 0,
  failedCount: 0,
  total: 0,
  void: true,
  reason,
});

// --- what the two runs mean ------------------------------------------------

test('a clean run passes, and does not need a reference to do it', () => {
  // The filter only ever REMOVES failures, so there is nothing a reference
  // could add here. Paying for a second sandbox run to learn that would be
  // waste on the common path.
  const r = adjudicate(run([], 9), null);
  assert.equal(r.outcome, 'passes');
  assert.deepEqual(r.kept, []);
});

test('a failure the reference did not have is the verdict', () => {
  const r = adjudicate(run(['rejects a self transfer between two handles on one account'], 8), run([], 9));
  assert.equal(r.outcome, 'fails');
  assert.deepEqual(r.kept, ['rejects a self transfer between two handles on one account']);
  assert.equal(r.filtered, true);
});

test('a failure the reference ALSO had is discarded, not reported', () => {
  // This is the whole reason the filter exists. The test asserts something the
  // milestone never required, so it condemns correct code — and it condemned
  // the already-accepted code in exactly the same way.
  const unfair = 'throws a TypeError when the amount is not a number';
  const r = adjudicate(run([unfair], 8), run([unfair], 8));
  assert.equal(r.outcome, 'passes');
  assert.deepEqual(r.kept, []);
  assert.deepEqual(r.discarded, [unfair]);
  assert.equal(r.filtered, true);
});

test('a mixed run keeps only the failures unique to the merged code', () => {
  const r = adjudicate(run(['unfair', 'real'], 6), run(['unfair'], 7));
  assert.deepEqual(r.kept, ['real']);
  assert.deepEqual(r.discarded, ['unfair']);
  assert.equal(r.outcome, 'fails');
});

// --- the guard that stops a green result being free ------------------------

test('A REFERENCE THAT FAILS MOST OF THE SUITE MAY NOT CLEAR ANYTHING', () => {
  // The first certification against a repository. The earlier state predates
  // the milestone, so nearly every generated test fails on it — which under a
  // plain set difference would explain away every real failure and report a
  // clean bill of health.
  //
  // Without this guard the check is green whenever it is least informed, and
  // green is the direction that releases money.
  const failures = ['a', 'b', 'c', 'd', 'e'];
  const r = adjudicate(run(failures, 1), run(failures, 1));
  assert.equal(r.outcome, 'inconclusive', 'must not report a pass on the strength of a reference that failed too');
  assert.deepEqual(r.kept, failures, 'the failures are reported unadjudicated, not erased');
  assert.equal(r.filtered, false);
  assert.match(r.reason ?? '', /does not implement this milestone/);
});

test('a reference failing exactly half the suite is still not usable', () => {
  // The boundary, pinned deliberately: "a majority" means the reference has to
  // do better than a coin flip before it is allowed to speak for correct code.
  const r = adjudicate(run(['x'], 3), run(['p', 'q'], 2));
  assert.equal(r.outcome, 'inconclusive');
});

test('a reference failing a minority is usable', () => {
  const r = adjudicate(run(['x'], 3), run(['p'], 3));
  assert.equal(r.outcome, 'fails');
  assert.deepEqual(r.kept, ['x']);
});

// --- everything that must not be mistaken for a defect ---------------------

test('no reference at all is inconclusive, never a failure', () => {
  const r = adjudicate(run(['something failed'], 4), null);
  assert.equal(r.outcome, 'inconclusive');
  assert.deepEqual(r.kept, ['something failed']);
  assert.equal(r.filtered, false);
});

test('a reference run that would not load is inconclusive', () => {
  const r = adjudicate(run(['something failed'], 4), voided('the suite did not load: bad import'));
  assert.equal(r.outcome, 'inconclusive');
  assert.match(r.reason ?? '', /earlier version/);
});

test('a suite that would not load is void, not a failing suite', () => {
  // The single most expensive confusion available here: our generator writing a
  // broken import looks exactly like the contributor's code being broken.
  const r = adjudicate(voided('the suite did not load: Cannot find module'), run([], 9));
  assert.equal(r.outcome, 'void');
  assert.deepEqual(r.kept, []);
});

// --- reading the runner's own report ---------------------------------------

test('parseTap reads the failing test names, not the counts alone', () => {
  const tap = [
    'TAP version 13',
    '# Subtest: keeps the total unchanged',
    'ok 1 - keeps the total unchanged',
    '# Subtest: rejects a self transfer',
    'not ok 2 - rejects a self transfer',
    '1..2',
    '# tests 2',
    '# pass 1',
    '# fail 1',
  ].join('\n');
  const r = parseTap(tap);
  assert.equal(r.void, false);
  assert.deepEqual([...r.failed], ['rejects a self transfer']);
  assert.equal(r.passed, 1);
  assert.equal(r.total, 2);
});

test('parseTap ignores a group heading that only reports a failing subtest', () => {
  // A heading's name is not a claim about the code, and counting it would let
  // one genuine leaf failure masquerade as two — and would put the word
  // "transfer" in front of a contributor as the test they broke.
  //
  // COPIED FROM THE RUNNER'S REAL OUTPUT, indentation and ordering included.
  // The marker sits in the YAML block BELOW the `not ok` line, and the leaf is
  // printed BEFORE its parent; a hand-written approximation of this got both
  // wrong and would have let a broken parser through.
  const tap = [
    '# Subtest: transfer',
    '    # Subtest: blocks a self transfer',
    '    not ok 1 - blocks a self transfer',
    '      ---',
    "      failureType: 'testCodeFailure'",
    "      error: |-",
    '        Expected values to be strictly equal:',
    '      ...',
    '    # Subtest: keeps the total',
    '    ok 2 - keeps the total',
    '    1..2',
    'not ok 1 - transfer',
    '  ---',
    "  type: 'suite'",
    "  failureType: 'subtestsFailed'",
    "  error: '1 subtest failed'",
    '  ...',
    'ok 2 - top level ok',
    '# tests 4',
    '# pass 2',
    '# fail 2',
  ].join('\n');
  const r = parseTap(tap);
  assert.deepEqual([...r.failed], ['blocks a self transfer'], 'only the leaf is a claim about the code');
  assert.equal(r.failedCount, 2, "the runner's own count still includes the heading, and is not rewritten");
});

test('parseTap calls a suite that never loaded void, not failed', () => {
  const tap = [
    'not ok 1 - /workspace/proofstream.oracle.test.ts',
    "  error: \"Cannot find module '/workspace/src/ledger'\"",
    '# pass 0',
    '# fail 1',
  ].join('\n');
  const r = parseTap(tap);
  assert.equal(r.void, true, 'a module-load error is not a verdict on the code');
  assert.equal(r.failed.size, 0);
});

test('parseTap calls a suite that asserted nothing void, not passing', () => {
  // Exits 0 and was once counted as "correct code kept", which inflates the one
  // number this has to report honestly.
  const r = parseTap('TAP version 13\n1..0\n# tests 0\n# pass 0\n# fail 0\n');
  assert.equal(r.void, true);
  assert.match(r.reason ?? '', /asserted nothing/);
});

// --- did the work improve, or was the question just asked again? ------------

import { evidenceImproved, type Evidence } from '../src/adjudicate';

const ev = (passed: number, total = 12, suiteId = 'suite-a'): Evidence => ({ passed, total, suiteId });

test('THE COMMENT-ONLY MERGE: identical evidence cannot raise certification', () => {
  // The live bug. A comment cannot make more tests pass, so it must not be able
  // to move the number.
  assert.equal(evidenceImproved(ev(9), ev(9)), false);
});

test('more tests passing is a real improvement', () => {
  assert.equal(evidenceImproved(ev(9), ev(12)), true);
});

test('fewer tests passing is not an improvement', () => {
  assert.equal(evidenceImproved(ev(12), ev(9)), false);
});

test('the first judgment has nothing to compare against, so it proceeds', () => {
  assert.equal(evidenceImproved(null, ev(9)), true);
});

test('COUNTS FROM DIFFERENT SUITES ARE NOT COMPARED', () => {
  // A regenerated suite renames and renumbers everything, so 9 of 12 against
  // 11 of 14 is two different rulers. Holding on that would be arbitrary.
  assert.equal(evidenceImproved(ev(9, 12, 'suite-a'), ev(9, 14, 'suite-b')), true);
});

test('a missing suite id means we cannot compare, so we do not hold', () => {
  assert.equal(evidenceImproved({ passed: 9, total: 12 }, ev(9)), true);
  assert.equal(evidenceImproved(ev(9), { passed: 9, total: 12 }), true);
});

test('an inconclusive run on either side does not hold anything', () => {
  // This gate withholds pay. The safe direction is to let a judgment proceed
  // rather than hold it on a comparison we could not actually make.
  assert.equal(evidenceImproved(ev(0, 0), ev(9)), true);
  assert.equal(evidenceImproved(ev(9), ev(0, 0)), true);
});
