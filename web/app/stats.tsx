import { readAgentLogs } from '../lib/events';
import { listStreams } from '../lib/registry';
import { Amount } from './amount';

/// THE NUMBERS, at the size numbers deserve.
///
/// Six figures a judge can check: how many streams exist, how much USDC was
/// deposited into them, how much the agents certified as owed, how much has
/// actually been withdrawn, how many judgments were made, and how many second
/// opinions were bought. The money figures come from the chain through the
/// registry; the counts come from the agent's own ledger.
///
/// Set as a ledger strip, hero size, because a count in the masthead's caption
/// line was invisible. NOT GREEN, even "paid out": the stream bar is where
/// released money is green, and a summary figure is a summary, not a cell.
export async function Stats() {
  const [streams, logs] = await Promise.all([listStreams(), readAgentLogs()]);

  const sum = (pick: (s: (typeof streams)[number]) => string) =>
    streams.reduce((acc, s) => acc + BigInt(pick(s) || '0'), 0n);

  const funded = sum((s) => s.funded);
  const certified = sum((s) => s.target);
  const paidOut = sum((s) => s.withdrawn);

  // A judgment is a row where the agent actually formed a verdict. Fan-outs,
  // reconcile notes and transport failures are not judgments.
  const judgments = logs.verdicts.filter((v) => v.verdict).length;
  const secondOpinions = logs.reviews.length;

  return (
    <section className="ps-stats" aria-label="Project statistics">
      <div className="ps-stat">
        <span className="ps-stat-fig">{streams.length}</span>
        <span className="ps-label">STREAMS</span>
      </div>
      <div className="ps-stat">
        <span className="ps-stat-fig">
          <Amount raw={funded} size="xl" suffix={false} />
        </span>
        <span className="ps-label">USDC DEPOSITED</span>
      </div>
      <div className="ps-stat">
        <span className="ps-stat-fig">
          <Amount raw={certified} size="xl" suffix={false} />
        </span>
        <span className="ps-label">USDC CERTIFIED OWED</span>
      </div>
      <div className="ps-stat">
        <span className="ps-stat-fig">
          <Amount raw={paidOut} size="xl" suffix={false} />
        </span>
        <span className="ps-label">USDC WITHDRAWN</span>
      </div>
      <div className="ps-stat">
        <span className="ps-stat-fig">{judgments}</span>
        <span className="ps-label">JUDGMENTS</span>
      </div>
      <div className="ps-stat">
        <span className="ps-stat-fig">{secondOpinions}</span>
        <span className="ps-label">SECOND OPINIONS BOUGHT</span>
      </div>
    </section>
  );
}
