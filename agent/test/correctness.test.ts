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

const run = (failed: string[], passed: number, names: string[] = []): SuiteRun => ({
  failed: new Set(failed),
  passedNames: new Set(names),
  passed,
  failedCount: failed.length,
  total: passed + failed.length,
  void: false,
});

const voided = (reason: string): SuiteRun => ({
  failed: new Set(),
  passedNames: new Set(),
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

// --- what the suite actually checked ---------------------------------------
//
// A count cannot distinguish a suite that probed the milestone hard from one
// that never touched it. Handed only "9 of 9 passed", the judgment invented a
// claim about coverage that was flatly untrue of the suite that had just run.

test('a clean run reports WHAT it checked, not just how many', () => {
  const r = adjudicate(run([], 2, ['balanceAt nets sent and received', 'balanceAt excludes later transfers']), null);
  assert.deepEqual(r.passedTests, ['balanceAt nets sent and received', 'balanceAt excludes later transfers']);
});

test('a failing run still reports what passed, so coverage can be weighed', () => {
  const r = adjudicate(run(['rejects an overdraft'], 1, ['balanceAt credits incoming']), run([], 2));
  assert.equal(r.outcome, 'fails');
  assert.deepEqual(r.kept, ['rejects an overdraft']);
  assert.deepEqual(r.passedTests, ['balanceAt credits incoming'], 'a failure elsewhere does not erase what was verified');
});

test('a void run claims nothing was checked', () => {
  const r = adjudicate(voided('the suite did not load'), null);
  assert.deepEqual(r.passedTests, [], 'a suite that never ran verified nothing');
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

test('parseTap names the tests that PASSED, not only the ones that failed', () => {
  const tap = [
    'TAP version 13',
    '# Subtest: balanceAt credits incoming transfers',
    'ok 1 - balanceAt credits incoming transfers',
    '# Subtest: balanceAt debits outgoing transfers',
    'not ok 2 - balanceAt debits outgoing transfers',
    '1..2',
    '# tests 2',
    '# pass 1',
    '# fail 1',
  ].join('\n');
  const r = parseTap(tap);
  assert.deepEqual([...r.passedNames], ['balanceAt credits incoming transfers']);
  assert.deepEqual([...r.failed], ['balanceAt debits outgoing transfers']);
});

test('A PASSING GROUP HEADING IS NOT A TEST THAT PASSED', () => {
  // The failing case is marked `subtestsFailed` in its YAML block. The PASSING
  // case has no marker at all — parent and leaf both report `type: 'test'` —
  // so the only thing separating them is the child plan indented above the
  // parent. Copied from the runner's real output.
  const tap = [
    'TAP version 13',
    '# Subtest: a plain passing leaf',
    'ok 1 - a plain passing leaf',
    "  type: 'test'",
    '# Subtest: a group',
    '    # Subtest: passing child',
    '    ok 1 - passing child',
    "      type: 'test'",
    '    1..1',
    'ok 2 - a group',
    "  type: 'test'",
    '1..2',
    '# tests 3',
    '# pass 2',
    '# fail 0',
  ].join('\n');
  const r = parseTap(tap);
  assert.deepEqual([...r.passedNames].sort(), ['a plain passing leaf', 'passing child'],
    'the heading "a group" is not a claim about the code');
});

test('A SUITE OF SKIPPED TESTS IS VOID, NOT A CLEAN PASS', () => {
  // The runner counts SKIP and TODO in `# pass`, verified against it rather
  // than assumed. So an oracle that emitted `test.skip(...)` throughout would
  // report itself all-green having executed no assertion whatsoever — and the
  // zero-count guard cannot see it, because the counts are not zero.
  //
  // Green is the direction that releases money, so this must not read as a pass.
  const tap = [
    'TAP version 13',
    '# Subtest: a skipped test',
    'ok 1 - a skipped test # SKIP',
    '# Subtest: a todo test',
    'ok 2 - a todo test # TODO',
    '1..2',
    '# tests 2',
    '# pass 2',
    '# fail 0',
    '# skipped 1',
    '# todo 1',
  ].join('\n');
  const r = parseTap(tap);
  assert.equal(r.void, true, 'nothing asserted, so there is no verdict in either direction');
  assert.equal(r.passedNames.size, 0);
  assert.match(r.reason ?? '', /skipped or empty/);
});

test('a skipped test alongside real ones is excluded, not counted as verified', () => {
  const tap = [
    'TAP version 13',
    'ok 1 - balanceAt credits incoming transfers',
    'ok 2 - a skipped test # SKIP',
    '1..2',
    '# tests 2',
    '# pass 2',
    '# fail 0',
  ].join('\n');
  const r = parseTap(tap);
  assert.equal(r.void, false);
  assert.deepEqual([...r.passedNames], ['balanceAt credits incoming transfers']);
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

// --- the contributor's own tests, as a second ruler --------------------------
//
// THE INCOHERENCE THIS CLOSES. The oracle is never shown test files, so its
// suite cannot observe whether the contributor wrote any. A milestone that asks
// for tests therefore had a clause that could never move the evidence: the
// agent docked pay for the tests being missing, then refused to restore it when
// they arrived. Observed live on PR2 of a real run.

const withOwn = (passed: number, ownPassed?: number): Evidence => ({
  suiteId: 'suite-a',
  passed,
  total: 12,
  ownPassed,
});

test("MORE OF THE CONTRIBUTOR'S OWN TESTS PASSING IS AN IMPROVEMENT", () => {
  // The generated suite is unchanged at 9 of 12 — it cannot see test files at
  // all — but five new passing tests appeared in the repository.
  assert.equal(evidenceImproved(withOwn(9, 6), withOwn(9, 11)), true);
});

test('the same own tests passing is not an improvement', () => {
  // The comment-only merge still has to be held. Nothing moved on either ruler.
  assert.equal(evidenceImproved(withOwn(9, 11), withOwn(9, 11)), false);
});

test('deleting tests is not an improvement', () => {
  assert.equal(evidenceImproved(withOwn(9, 11), withOwn(9, 6)), false);
});

test('a repository with no tests on either side falls back to the generated suite', () => {
  assert.equal(evidenceImproved(withOwn(9, undefined), withOwn(9, undefined)), false);
  assert.equal(evidenceImproved(withOwn(9, undefined), withOwn(11, undefined)), true);
});

test('THE FIRST TESTS SOMEBODY WRITES ARE AN IMPROVEMENT', () => {
  // A repository with no tests measures a real zero, not an absence, so tests
  // appearing where there were none is a rise like any other. This is the
  // common shape of a milestone that asks for tests.
  assert.equal(evidenceImproved(withOwn(9, 0), withOwn(9, 5)), true);
});

test('a run that concluded NOTHING is not read as tests being deleted', () => {
  // A sandbox timeout must not look like the contributor removing every test.
  // Undefined on either side means we cannot compare on this ruler, so it falls
  // through to the generated suite rather than holding on a measurement we
  // failed to take.
  assert.equal(evidenceImproved(withOwn(9, 11), withOwn(9, undefined)), false, 'the generated suite still governs');
  assert.equal(evidenceImproved(withOwn(9, 11), withOwn(12, undefined)), true, 'and it can still say yes');
});

test('the generated suite still counts when the own tests did not move', () => {
  assert.equal(evidenceImproved(withOwn(9, 11), withOwn(12, 11)), true);
});
