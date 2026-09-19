import type { AgentEvent } from '../lib/events';

/// THE ONE THING READING CODE CANNOT DO.
///
/// Every other panel on this page reports an opinion: the agent read the work
/// and formed a view. This one reports something that was executed. A suite
/// written from the milestone text, by a model that was never shown the
/// implementation, run against the merged code somewhere isolated.
///
/// SAY WHAT HAPPENED, NOT WHAT IT PROVES. "11 of 12 generated tests passed" is
/// a fact. "Verified correct" is not, and it is the claim this project has been
/// careful never to make: a suite only tests what it thought to test.
///
/// NOTHING HERE IS GREEN. Green means USDC the agent released. Tests passing is
/// evidence that fed a judgment, not money that moved.
///
/// COLLAPSED TO A SINGLE LINE, because the headline is the whole claim for a
/// reader skimming: code ran somewhere isolated, and here is the score. The
/// detail underneath is for the reader who doubts it, and they are the one
/// prepared to click.
export function SandboxEvidence({ event }: { event: AgentEvent }) {
  const c = event.correctness;

  // Off, or it could not run. The overwhelming case, and it must render as
  // nothing rather than as an absence — a judgment made without this evidence
  // is the normal product, not a degraded one.
  if (!c) return null;

  const ran = c.total > 0;

  return (
    <details className="ps-sandbox">
      <summary>
        <SandboxMark />
        <span className="ps-label">RAN IN AN ISOLATED SANDBOX</span>
        {ran && (
          <span className="ps-sandbox-score">
            {c.passed} of {c.total} generated tests passed
          </span>
        )}
      </summary>

      <div className="ps-sandbox-body">
        <p className="ps-sandbox-what">
          The agent wrote a test suite from the milestone text without seeing the
          implementation, then ran it against the merged code in a throwaway
          environment holding none of its keys, with no network.
        </p>

        {/* WHAT IT CHECKED, which is the part a total cannot carry. "9 of 9
            passed" reads identically whether the suite probed the milestone hard
            or never touched it, and a reader given only the score has no way to
            tell those apart. Older verdicts have no list and simply omit it. */}
        {c.passedTests && c.passedTests.length > 0 && (
          <div className="ps-sandbox-checked">
            <span className="ps-label">WHAT THE SUITE CHECKED</span>
            <ul>
              {c.passedTests.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          </div>
        )}

        {/* The contributor's own tests, run separately. Reported because the
            generated suite is blind to them: it is written by a model that is
            never shown the test files, so it cannot see whether the milestone's
            "cover it with tests" clause was met. */}
        {c.ownTests && (
          <p className="ps-caption">
            The repository&apos;s own test suite was run too, separately:{' '}
            {c.ownTests.total === 0
              ? 'it has no tests yet.'
              : `${c.ownTests.passed} of ${c.ownTests.total} passed.`}
          </p>
        )}

        {c.kept.length > 0 && (
          <div className="ps-sandbox-failures">
            <span className="ps-label">
              {c.filtered ? 'FAILED HERE AND NOT ON THE EARLIER VERSION' : 'FAILED, UNCHECKED'}
            </span>
            <ul>
              {c.kept.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
            {!c.filtered && (
              // Said plainly, because the difference decides how much the reader
              // should believe it. Without an earlier version to measure against,
              // an unfair test and a real defect look identical.
              <p className="ps-caption">
                There was no earlier version of this repository to measure against,
                so some of these may simply be unfair tests. The agent weighed them
                knowing that.
              </p>
            )}
          </div>
        )}

        {c.discarded.length > 0 && (
          <p className="ps-caption">
            {c.discarded.length} further test{c.discarded.length === 1 ? '' : 's'} failed on the
            earlier version too, so {c.discarded.length === 1 ? 'it tests' : 'they test'} something
            this milestone never asked for and {c.discarded.length === 1 ? 'was' : 'were'} set aside.
          </p>
        )}

        {/* An inconclusive or void run established nothing. Reporting the reason
            is the honest thing: the alternative is a silent absence that reads as
            a clean bill of health. */}
        {(c.outcome === 'inconclusive' || c.outcome === 'void') && c.reason && (
          <p className="ps-caption">This check concluded nothing: {c.reason}.</p>
        )}
      </div>
    </details>
  );
}

/// A sealed container, drawn rather than imported.
///
/// No icon package: their rounded 1.5px strokes read as a different app bolted
/// on. Every coordinate here is on the 4px grid at 1px stroke, `crispEdges` so
/// nothing anti-aliases off it. A box within a box, which is the whole idea the
/// panel is selling — the work ran inside something the agent is outside of.
function SandboxMark() {
  return (
    <svg
      className="ps-sandbox-mark"
      width="12"
      height="12"
      viewBox="0 0 12 12"
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="0.5" y="0.5" width="11" height="11" fill="none" stroke="currentColor" />
      <rect x="3.5" y="3.5" width="5" height="5" fill="currentColor" />
    </svg>
  );
}
