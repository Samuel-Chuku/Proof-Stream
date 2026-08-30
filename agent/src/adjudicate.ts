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

  // NOT A FAILURE, AND THE DISTINCTION IS THE WHOLE POINT. A suite that will
  // not load tells us the generator is broken; it says nothing whatsoever about
  // the code under test. Node reports a module-load error as a failing test
  // named after the FILE, which is indistinguishable from a real assertion
  // failure if you only read the exit code.
  if (target.void) return { outcome: 'void', ...none, reason: target.reason };

  if (target.failed.size === 0) {
    return { outcome: 'passes', ...none, reason: `all ${target.total} generated tests passed` };
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
      reason:
        `${discarded.length} test(s) failed on the merged code, and every one of them also failed on the ` +
        'earlier version, so they are testing something this milestone never required',
    };
  }

  return { outcome: 'fails', kept, discarded, filtered: true };
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
    return { failed: new Set(), passed: 0, failedCount: 0, total: 0, void: true, reason: `the suite did not load: ${line ?? 'no detail'}` };
  }

  const passed = Number(out.match(/^# pass (\d+)/m)?.[1] ?? 0);
  const failedCount = Number(out.match(/^# fail (\d+)/m)?.[1] ?? 0);

  // A SUITE THAT ASSERTED NOTHING IS NOT A PASS. The same lie in the opposite
  // direction: a file with zero tests, or every test skipped, exits 0 and would
  // otherwise be counted as "correct code kept" — so a generator that quietly
  // produced an empty file would look careful rather than useless.
  if (passed === 0 && failedCount === 0) {
    return { failed: new Set(), passed: 0, failedCount: 0, total: 0, void: true, reason: 'the suite asserted nothing' };
  }

  // Every `not ok`, at any nesting depth, EXCEPT the group headings.
  //
  // A test containing failing subtests is itself reported `not ok`, so a nested
  // suite yields both `not ok 1 - blocks a self transfer` and `not ok 1 -
  // transfer`. Only the first is a claim about the code; the second is a
  // heading, and passing it to a judge as a failing test name — or to a
  // contributor as the case they broke — is noise dressed as evidence.
  //
  // THE MARKER IS NOT ON THE `not ok` LINE. It is in the YAML block underneath,
  // as `failureType: 'subtestsFailed'`, five or so lines later, and the leaf is
  // printed BEFORE its parent. Testing the `not ok` line itself for "subtest
  // failed" is a condition that can never be true, so it excludes nothing.
  const lines = out.split('\n');
  const failed = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*not ok \d+ - (.+)$/);
    if (!m) continue;
    let heading = false;
    for (let j = i + 1; j < lines.length && j <= i + 12; j++) {
      if (/^\s*\.\.\.\s*$/.test(lines[j])) break; // end of this test's YAML block
      if (/subtestsFailed|subtests? failed/.test(lines[j])) {
        heading = true;
        break;
      }
    }
    if (!heading) failed.add(m[1].trim());
  }

  // `passed` and `failedCount` are the runner's OWN totals and count headings
  // as tests, so they do not agree with `failed.size` and are not meant to.
  // Each is used where it is honest: the names for what to show a judge, the
  // counts for how much of the suite a run got through.
  return { failed, passed, failedCount, total: passed + failedCount, void: false };
}

/// What a past certification proved, so a later one can be compared against it.
export type Evidence = {
  /// Which suite produced the counts. Two results are comparable ONLY when this
  /// matches: a regenerated suite renames and renumbers everything.
  suiteId?: string;
  passed: number;
  total: number;
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
  if (!previous.suiteId || !current.suiteId) return true;
  if (previous.suiteId !== current.suiteId) return true;
  if (previous.total === 0 || current.total === 0) return true;
  return current.passed > previous.passed;
}
