// DOES THE MERGED CODE ACTUALLY DO WHAT THE MILESTONE ASKED?
//
// Everything else in this agent answers a weaker question. The judgment reads
// the diff and the repository and decides whether the milestone's work is
// PRESENT, plausible and tested. That is all reading can establish: an
// implementation that is subtly wrong, carrying a test that agrees with it,
// looks exactly like one that is right.
//
// This module answers the other half. A suite is generated from the milestone
// text WITHOUT the model ever seeing the implementation, executed against the
// merged code in a sandbox, and what fails becomes evidence in the judgment.
//
// THE FILTER, AND WHY IT IS NOT A PROMPT. Generated tests over-specify: they
// assert things the milestone never said, then condemn correct code for
// choosing differently. Asking the model to be fairer does not fix it. So
// remove the unfair tests mechanically instead — a fair test PASSES CORRECT
// CODE BY DEFINITION, so run the same suite against code already known to be
// acceptable and discard everything that fails there. The unfair tests remove
// themselves and the model never has to cooperate. No source is rewritten: it
// is a set difference on test names.
//
// WHICH DIRECTION THIS IS ALLOWED TO BE WRONG IN. A false accusation withholds
// an honest contributor's wages on the strength of a bug we wrote, and
// certification is a monotonic ratchet, so it is expensive and irreversible in
// a way a false pass is not. Every rule below therefore leans the same way: the
// filter can only ever DISCARD failures, never invent them; anything it cannot
// adjudicate is reported as inconclusive rather than as a failure; and a
// failure is never wired to the payout — it is handed to the judgment, which
// decides whether the test was fair. "Unsure releases nothing" is unchanged.
import { adjudicate, parseTap, type SuiteRun } from './adjudicate';
import { env, ledgerPath } from './env';
import { generateSuite, type SourceFile } from './oracle';
import { runInSandbox } from './sandbox';
import { dropSuite, loadSuite, noteUse, saveSuite, suiteId } from './suite-cache';

/// Where the generated suite is written in the repository tree. At the root, so
/// a module at `src/ledger.ts` is imported as `./src/ledger.ts` — the paths the
/// generator was given.
const SUITE_PATH = 'proofstream.oracle.test.ts';

export type CorrectnessOutcome =
  /** The suite ran and nothing failed that the reference did not also fail. */
  | 'passes'
  /** Tests failed on the merged code alone. Named, and adjudicated by the judge. */
  | 'fails'
  /** The suite ran, but nothing can be concluded from what it did. */
  | 'inconclusive'
  /** The suite never really ran: it did not load, or it asserted nothing. */
  | 'void'
  /** The check could not be performed at all — no sandbox, no model, no source. */
  | 'unavailable';

export type CorrectnessResult = {
  outcome: CorrectnessOutcome;
  /** Failures on the merged code that the reference did NOT have. The verdict. */
  kept: string[];
  /** Failures the reference had too, so they say nothing about this work. */
  discarded: string[];
  /** Whether a usable reference actually adjudicated the failures. */
  filtered: boolean;
  /** How many tests passed on the merged code, and how many ran. */
  passed: number;
  total: number;
  /** Which suite produced those numbers. Two results are only comparable when
   *  this matches: a regenerated suite renames and renumbers everything, so a
   *  count that moved across a regeneration says nothing. */
  suiteId?: string;
  reason?: string;
  costUsd: number;
  model?: string;
};

const unavailable = (reason: string): CorrectnessResult => ({
  outcome: 'unavailable',
  kept: [],
  discarded: [],
  filtered: false,
  passed: 0,
  total: 0,
  reason,
  costUsd: 0,
});

export type CorrectnessRequest = {
  milestone: string;
  /** The repository's source as it stands after the merge. */
  merged: SourceFile[];
  /** Stable identity for this milestone, so one generated suite can serve
   *  several judgments of it. Same key means the same ruler, which is what
   *  makes "two more tests pass than last time" a true statement rather than a
   *  comparison of two different suites. Omit it and every judgment generates
   *  fresh, which is the old behaviour. */
  suiteKey?: string;
  /** The repository as it stood BEFORE the merge, when we can read it.
   *
   *  This is the reference, and in production it is not an arbitrary choice: it
   *  is the code that was already there and already certified. Its arbitrary
   *  decisions are the ones the employer has already accepted, which is exactly
   *  what makes it the fair thing to measure unfairness against. */
  reference?: SourceFile[];
};

/// Generate a suite from the milestone, run it against the merged code, and
/// adjudicate what failed. Never throws: a correctness check that crashes the
/// judgment would stop an honest contributor being paid over our own bug.
export async function checkCorrectness(req: CorrectnessRequest): Promise<CorrectnessResult> {
  if (!env.correctnessCheck) return unavailable('the correctness check is switched off');
  if (req.merged.length === 0) return unavailable('no source files were read from the repository');

  // REUSE THE MILESTONE'S SUITE WHEN THERE IS ONE.
  //
  // Not only to save a generation call. The evidence gate needs to compare
  // "9 of 12" against "11 of 12", and that is only a comparison when both
  // numbers came from the same suite.
  const suiteDir = ledgerPath('suites');
  const cached = req.suiteKey ? loadSuite(suiteDir, req.suiteKey) : null;

  let tests: string;
  let cost = 0;
  let model: string | undefined;
  if (cached) {
    tests = cached.tests;
  } else {
    try {
      const generated = await generateSuite(req.milestone, req.merged, SUITE_PATH);
      tests = generated.tests;
      cost = generated.costUsd;
      model = generated.model;
    } catch (err) {
      return unavailable(`could not generate a suite: ${message(err)}`);
    }
  }

  let target: SuiteRun;
  try {
    target = await runSuite(req.merged, tests);
  } catch (err) {
    return { ...unavailable(`the sandbox could not run the suite: ${message(err)}`), costUsd: cost, model };
  }

  // A CACHED SUITE THAT NO LONGER LOADS HAS BEEN OVERTAKEN BY THE CODE.
  //
  // The public interface moved and the old tests cannot resolve against it any
  // more. That is not a verdict on the contributor's work, so drop the suite and
  // generate once against what is actually there now.
  if (cached && target.void && req.suiteKey) {
    dropSuite(suiteDir, req.suiteKey);
    try {
      const regenerated = await generateSuite(req.milestone, req.merged, SUITE_PATH);
      tests = regenerated.tests;
      cost += regenerated.costUsd;
      model = regenerated.model;
      target = await runSuite(req.merged, tests);
    } catch (err) {
      return { ...unavailable(`could not regenerate a stale suite: ${message(err)}`), costUsd: cost, model };
    }
  }

  // ONLY KEEP A SUITE WE HAVE SEEN RUN. One that did not load tells us nothing
  // about the code and would poison every judgment that reused it.
  if (req.suiteKey && !target.void) {
    if (cached && suiteId(tests) === cached.id) noteUse(suiteDir, req.suiteKey);
    else saveSuite(suiteDir, req.suiteKey, tests);
  }

  // A reference run is only worth paying for once the target has actually
  // failed something. The filter can only ever REMOVE failures, so a clean run
  // cannot be improved by one — and that is the common case.
  let reference: SuiteRun | null = null;
  if (!target.void && target.failed.size > 0 && req.reference && req.reference.length > 0) {
    try {
      reference = await runSuite(req.reference, tests);
    } catch (err) {
      reference = { failed: new Set(), passed: 0, failedCount: 0, total: 0, void: true, reason: `the reference run failed: ${message(err)}` };
    }
  }

  return {
    ...adjudicate(target, reference),
    passed: target.passed,
    total: target.total,
    suiteId: suiteId(tests),
    costUsd: cost,
    model,
  };
}

// ---------------------------------------------------------------------------

/// Write the repository and the generated suite into a sandbox and run it.
///
/// `trusted: false`, always and without a way to say otherwise. This is a
/// stranger's code and the agent holds a funded wallet, a Circle entity secret
/// and a GitHub token. With the local driver that refuses outright rather than
/// executing next to those.
///
/// NO INSTALL STEP, and none is possible: egress is blocked before the command
/// runs, precisely because `npm install` is arbitrary code execution. Node 22
/// strips type annotations natively and ships its own test runner, so a
/// generated TypeScript suite runs against dependency-free modules with nothing
/// fetched. A module that imports a third-party package cannot resolve it, the
/// suite fails to load, and that is reported as `void` — never as a failure of
/// the contributor's work.
async function runSuite(files: SourceFile[], tests: string): Promise<SuiteRun> {
  const run = await runInSandbox(
    [...files, { path: SUITE_PATH, contents: tests }],
    `node --test ${SUITE_PATH}`,
    { seconds: env.oracleTimeoutSeconds },
    { trusted: false },
  );

  if (run.timedOut) {
    return { failed: new Set(), passed: 0, failedCount: 0, total: 0, void: true, reason: 'the suite did not finish inside the time limit' };
  }
  return parseTap(run.stdout + run.stderr);
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
