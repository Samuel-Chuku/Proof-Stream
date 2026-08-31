// WHAT THE TWO SANDBOX RUNS MEAN.
//
// Separated from correctness.ts for the same reason metering.ts was separated
// from the pipeline: this decides what a contributor is paid, and it must be
// exercisable with no environment, no model, no sandbox and no network.
// Nothing here imports anything, so `pnpm test:correctness` runs without a .env.
//
// Read the header of correctness.ts first for why the filter exists at all.

/// The outcome of running one generated suite against one snapshot of a
/// repository.
export type SuiteRun = {
  /** Names of the individual tests that FAILED, at any nesting depth. Group
   *  headings are excluded — see parseTap. */
  failed: Set<string>;
  /** Names of the individual tests that PASSED, on the same terms: no group
   *  headings, and nothing that was skipped or marked todo.
   *
   *  Carried because a COUNT IS NOT EVIDENCE OF COVERAGE. "9 of 9 passed" reads
   *  the same whether the suite probed the milestone hard or never touched it,
   *  and a judge handed only the count has nothing to reason from — observed
   *  live, it invented a claim that none of the tests exercised the function
   *  the milestone named, when all nine did. */
  passedNames: Set<string>;
  /** The runner's own totals. These COUNT GROUP HEADINGS as tests, so
   *  `failedCount` and `failed.size` legitimately disagree on a nested suite. */
  passed: number;
  failedCount: number;
  total: number;
  /** True when the suite could not load or asserted nothing — no verdict. */
  void: boolean;
  reason?: string;
};

/// What a pair of runs establishes.
///
/// `outcome` mirrors correctness.ts's, minus the states that are decided before
/// anything runs.
export type Adjudication = {
  outcome: 'passes' | 'fails' | 'inconclusive' | 'void';
  /** Failures on the merged code that the reference did NOT have. The verdict. */
  kept: string[];
  /** Failures the reference had too, so they say nothing about this work. */
  discarded: string[];
  /** Whether a usable reference actually adjudicated the failures. */
  filtered: boolean;
  /** What the suite actually checked and got right on the merged code. Passed
   *  to the judgment so coverage is read from names rather than guessed from a
   *  total. */
  passedTests: string[];
  reason?: string;
};

/// What the two runs mean, with no I/O in sight.
///
/// This is the whole judgement of the check and every branch of it decides
/// whether someone gets paid, so it is separated from the fetching and the
/// executing in order to be testable without a model, a sandbox or a network.
/// `null` for the reference covers every way there might not be a usable one.
export function adjudicate(target: SuiteRun, reference: SuiteRun | null): Adjudication {
  const none = { kept: [] as string[], discarded: [] as string[], filtered: false };
  const verified = [...target.passedNames];

  // NOT A FAILURE, AND THE DISTINCTION IS THE WHOLE POINT. A suite that will
  // not load tells us the generator is broken; it says nothing whatsoever about
  // the code under test. Node reports a module-load error as a failing test
  // named after the FILE, which is indistinguishable from a real assertion
  // failure if you only read the exit code.
  // A void run established nothing, so it has nothing to report as checked.
  if (target.void) return { outcome: 'void', ...none, passedTests: [], reason: target.reason };

  if (target.failed.size === 0) {
    return { outcome: 'passes', ...none, passedTests: verified, reason: `all ${target.total} generated tests passed` };
  }

  // Something failed. On its own that is evidence of nothing: the tests were
  // written by a model that has never seen this code and routinely asserts
  // requirements nobody stated. A reference is what turns a failure into
  // evidence, and without one the honest answer is that we cannot tell.
  const unadjudicated = (reason: string): Adjudication => ({
    outcome: 'inconclusive',
    kept: [...target.failed],
    discarded: [],
    filtered: false,
    passedTests: verified,
    reason,
  });

  if (!reference) {
    return unadjudicated(
      'there is no earlier version of this repository to measure against, so an unfair test and a ' +
        'real defect look the same here',
    );
  }
  if (reference.void) return unadjudicated(`on the earlier version: ${reference.reason}`);

  // IS THIS REFERENCE ENTITLED TO CLEAR ANYTHING?
  //
  // The filter's licence is that the reference is known-good, so a test failing
  // there is unfair by definition. That licence expires when the reference does
  // not implement the milestone at all — the FIRST certification against a
  // repository, where the earlier state predates the work entirely. Nearly
  // every generated test fails on it, so every real failure is "explained", and
  // the check reports a clean bill of health having established nothing.
  //
  // That is the shape of a check that can only come out green, and it would do
  // so in the direction that releases money. So a reference that cannot pass a
  // majority of the suite is not treated as known-good: it may not clear
  // anything, and the failures are reported unadjudicated instead.
  if (reference.failedCount * 2 >= reference.total) {
    return unadjudicated(
      `the earlier version of this repository failed ${reference.failedCount} of ${reference.total} ` +
        'generated tests itself, so it does not implement this milestone and cannot say which tests are fair',
    );
  }

  const kept = [...target.failed].filter((t) => !reference.failed.has(t));
  const discarded = [...target.failed].filter((t) => reference.failed.has(t));

  if (kept.length === 0) {
    return {
      outcome: 'passes',
      kept: [],
      discarded,
      filtered: true,
      passedTests: verified,
      reason:
        `${discarded.length} test(s) failed on the merged code, and every one of them also failed on the ` +
        'earlier version, so they are testing something this milestone never required',
    };
  }

  return { outcome: 'fails', kept, discarded, filtered: true, passedTests: verified };
}


/// What the Node test runner's TAP output says happened.
///
/// Exported because this is where a wrong answer would be silent. Each guard
/// below rejects a specific way this output lies about what happened.
export function parseTap(out: string): SuiteRun {
  // A SUITE THAT NEVER LOADED IS NOT A VERDICT ON THE CODE. Node reports a
  // module-load failure as `# fail 1` with a `not ok 1 - <path>` line, which is
  // indistinguishable from a real assertion failure if you only look at the TAP
  // plan. A broken suite "fails" against correct and broken code alike, so
  // counting it as detection would credit the generator for its own bug.
  if (/ERR_UNKNOWN_BUILTIN_MODULE|ERR_MODULE_NOT_FOUND|Cannot find module|SyntaxError|ERR_REQUIRE_ESM|TransformError|Transform failed/.test(out)) {
    const line = out.split('\n').find((l) => /Error|error:/.test(l))?.trim();
    return { ...nothingRan, void: true, reason: `the suite did not load: ${line ?? 'no detail'}` };
  }

  const passed = Number(out.match(/^# pass (\d+)/m)?.[1] ?? 0);
  const failedCount = Number(out.match(/^# fail (\d+)/m)?.[1] ?? 0);

  // A SUITE THAT ASSERTED NOTHING IS NOT A PASS. The same lie in the opposite
  // direction: a file with zero tests, or every test skipped, exits 0 and would
  // otherwise be counted as "correct code kept" — so a generator that quietly
  // produced an empty file would look careful rather than useless.
  if (passed === 0 && failedCount === 0) {
    return { ...nothingRan, void: true, reason: 'the suite asserted nothing' };
  }

  // Every `ok` and `not ok`, at any nesting depth, EXCEPT the group headings.
  //
  // A test containing subtests is itself reported as a result, so a nested suite
  // yields both `not ok 1 - blocks a self transfer` and `not ok 1 - transfer`.
  // Only the first is a claim about the code; the second is a heading, and
  // passing it to a judge as a test name — or to a contributor as the case they
  // broke — is noise dressed as evidence.
  const lines = out.split('\n');
  const failed = new Set<string>();
  const passedNames = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)(not ok|ok) \d+ - (.+)$/);
    if (!m) continue;
    const indent = m[1].length;
    const ok = m[2] === 'ok';
    const raw = m[3].trim();

    // SKIPPED AND TODO TESTS ARE COUNTED IN `# pass` BY THE RUNNER, verified
    // against it rather than assumed. So a suite of `test.skip(...)` reports
    // itself all-green having executed no assertion at all, and the zero-count
    // guard above cannot see it because the counts are not zero. Excluding them
    // here is what makes the "asserted nothing" check below able to catch it.
    if (/\s#\s*(SKIP|TODO)\b/i.test(raw)) continue;
    const name = raw.replace(/\s+#\s*(SKIP|TODO)\b.*$/i, '').trim();

    if (isHeading(lines, i, indent)) continue;
    (ok ? passedNames : failed).add(name);
  }

  // Everything the runner counted was a heading, a skip or a todo. Nothing
  // executed an assertion, so there is no verdict here in either direction.
  if (passedNames.size === 0 && failed.size === 0) {
    return { ...nothingRan, void: true, reason: 'the suite asserted nothing — every test was skipped or empty' };
  }

  // `passed` and `failedCount` are the runner's OWN totals and count headings
  // as tests, so they do not agree with `failed.size` and are not meant to.
  // Each is used where it is honest: the names for what to show a judge, the
  // counts for how much of the suite a run got through.
  return { failed, passedNames, passed, failedCount, total: passed + failedCount, void: false };
}

/// A run that produced no verdict. Shared so a new field cannot be added to
/// SuiteRun and silently omitted from one of the void paths.
const nothingRan = {
  failed: new Set<string>(),
  passedNames: new Set<string>(),
  passed: 0,
  failedCount: 0,
  total: 0,
  void: false,
};

/// Is this result line a GROUP HEADING rather than a claim about the code?
///
/// The two cases need DIFFERENT markers, and this was established by running
/// the runner rather than by reasoning about it:
///
///   - A FAILING parent carries `failureType: 'subtestsFailed'` in the YAML
///     block below it. The marker is NOT on the `not ok` line, and the leaf is
///     printed before its parent.
///   - A PASSING parent carries no such marker anywhere. Both leaves and
///     parents report `type: 'test'`, so the YAML cannot tell them apart. What
///     can is the child plan: a parent is always preceded by its subtests' own
///     `1..N` line, indented deeper than the parent itself.
function isHeading(lines: string[], i: number, indent: number): boolean {
  for (let j = i + 1; j < lines.length && j <= i + 12; j++) {
    if (/^\s*\.\.\.\s*$/.test(lines[j])) break; // end of this test's YAML block
    if (/subtestsFailed|subtests? failed/.test(lines[j])) return true;
  }

  // Walk back over this result's own children. Reaching our own indentation
  // without having seen a plan means there were none, so this is a leaf.
  for (let j = i - 1; j >= 0; j--) {
    if (!lines[j].trim()) continue;
    if ((lines[j].match(/^\s*/)?.[0].length ?? 0) <= indent) return false;
    if (/^\s*1\.\.\d+\s*$/.test(lines[j])) return true;
  }
  return false;
}

/// What a past certification proved, so a later one can be compared against it.
export type Evidence = {
  /// Which suite produced the counts. Two results are comparable ONLY when this
  /// matches: a regenerated suite renames and renumbers everything.
  suiteId?: string;
  passed: number;
  total: number;
  /// How many of the CONTRIBUTOR'S OWN tests passed. A second ruler with no
  /// suite id, because it is not our suite: it changes legitimately as the work
  /// changes, and that is exactly what makes it evidence. Undefined when the
  /// repository has no tests or the run concluded nothing.
  ownPassed?: number;
};

/// DID THE WORK IMPROVE, OR WAS THE QUESTION SIMPLY ASKED AGAIN?
///
/// `certifiedBps` only ever rises, so low judgments are discarded and high ones
/// stick. Repeated judgments therefore do not converge on the truth, they climb
/// toward the highest number the agent ever produced. Observed live: a
/// comment-only merge took a standing 95% to a full certification, because the
/// second roll of the dice landed higher and monotonicity made it permanent.
///
/// The fix is to stop treating a re-ask as new information. Certification may
/// rise when the EVIDENCE improves, not when the model is asked again.
///
/// Returns true whenever we cannot honestly say the evidence failed to improve,
/// because this gate withholds pay and the safe direction is to let a judgment
/// proceed rather than to hold it on a comparison we could not make:
///
///   - no previous evidence, so this is the first look
///   - a different suite, so the two counts came from different rulers
///   - either side inconclusive, so there is nothing to compare
export function evidenceImproved(previous: Evidence | null, current: Evidence): boolean {
  if (!previous) return true;

  // THE CONTRIBUTOR WROTE MORE TESTS, AND THEY PASS.
  //
  // Checked first because it is the only ruler that can see it. Our generated
  // suite is written from the milestone text by a model that is never shown the
  // test files, so a milestone clause asking the contributor to COVER the work
  // with tests is invisible to it: once the implementation is right the suite
  // sits at its ceiling and can never improve again.
  //
  // That made the agent incoherent rather than merely strict. It docked a
  // contributor to 50% saying the testing requirement was unmet, and then held
  // the certification there when the very tests it asked for arrived.
  //
  // Gameable with trivial tests, and deliberately accepted: this gate only ever
  // UNBLOCKS a re-judgment. What the work is worth is still the attestor's
  // call, still needs the verifier to agree, and still has to clear the
  // confidence bar.
  if (
    previous.ownPassed !== undefined &&
    current.ownPassed !== undefined &&
    current.ownPassed > previous.ownPassed
  ) {
    return true;
  }
  if (!previous.suiteId || !current.suiteId) return true;
  if (previous.suiteId !== current.suiteId) return true;
  if (previous.total === 0 || current.total === 0) return true;
  return current.passed > previous.passed;
}
