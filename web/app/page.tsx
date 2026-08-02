import { EXPLORER_URL } from '@proofstream/config';
import { readAgentLogs, totalSpend, type AgentEvent } from '../lib/events';
import { readStream } from '../lib/stream';
import { LockedFigure } from './stream-bar';

// The chain and the agent logs both move while the page is open.
export const dynamic = 'force-dynamic';

const OUTCOME: Record<string, { label: string; tone: string }> = {
  unlocked: { label: 'paid', tone: 'ok' },
  declined: { label: 'refused', tone: 'no' },
  vetoed: { label: 'vetoed', tone: 'no' },
  escalated: { label: 'escalated', tone: 'warn' },
  skipped: { label: 'skipped', tone: 'warn' },
  unlock_failed: { label: 'failed', tone: 'no' },
};

const pct = (n: number | undefined) => (n === undefined ? '—' : `${Math.round(n * 100)}%`);
const short = (h: string) => `${h.slice(0, 8)}…${h.slice(-6)}`;

export default async function Home() {
  const stream = await readStream();
  const { verdicts, reviews } = await readAgentLogs();
  const spend = totalSpend(verdicts, reviews);
  const decisions = verdicts.filter((v) => v.verdict);

  return (
    <main>
      <div className="masthead">
        <h1 className="wordmark">
          Proof<b>Stream</b>
        </h1>
        {stream && (
          <a href={`${EXPLORER_URL}/address/${stream.address}`} target="_blank" rel="noreferrer">
            {short(stream.address)} ↗
          </a>
        )}
      </div>

      {!stream ? (
        <p className="empty">
          Cannot read the contract. Check <code>WORKSTREAM_ADDRESS</code> and <code>ARC_RPC_URL</code>.
        </p>
      ) : (
        <>
          <LockedFigure stream={stream} />

          <section className="milestone">
            <p className="figure-label">Milestone, read from the contract</p>
            <p>{stream.milestone}</p>
          </section>

          <section>
            <div className="ledger-head">
              <h2>Agent decisions</h2>
              <p>
                {decisions.length} judged · ceiling {(Number(stream.maxTranche) / 1e6).toFixed(0)} USDC
                per unlock, {(Number(stream.dailyUnlockCap) / 1e6).toFixed(0)} a day
              </p>
            </div>

            {decisions.length === 0 ? (
              <p className="empty">Nothing judged yet. Merge a pull request to wake the agent.</p>
            ) : (
              decisions.map((v, i) => <Row key={`${v.at}-${i}`} event={v} open={i === 0} />)
            )}
          </section>
        </>
      )}

      <footer>
        <p>
          <b>${spend.total.toFixed(4)}</b> spent by the agents on judgment across {decisions.length}{' '}
          decisions — inference plus {spend.paidReviews} second opinions bought at $0.005 each.
        </p>
        <p>
          Verification fees settle in Circle Gateway batches, so they do not appear as one Arc
          transaction each. Unlocks and payouts are direct on-chain transactions and link to the
          explorer.
        </p>
      </footer>
    </main>
  );
}

function Row({ event, open }: { event: AgentEvent; open: boolean }) {
  const outcome = OUTCOME[event.event] ?? { label: event.event, tone: 'warn' };
  const v = event.verdict!;
  const amount = event.trancheUsdc ? `${event.trancheUsdc} USDC` : outcome.label;

  return (
    <details className={`row row-${outcome.tone}`} open={open}>
      <summary>
        <span className="mark" />
        <span className="row-pr">#{event.pr}</span>
        <span className="row-title">{event.title}</span>
        <span className="row-amount">{amount}</span>
        <span className="chev">▶</span>
      </summary>

      <div className="detail">
        <div className="judge">
          <h3>
            Attestor <code>{event.model}</code>
          </h3>
          <p>{v.reasoning}</p>
          <p className="judge-meta">
            satisfied <b>{String(v.satisfies_milestone)}</b> · confidence <b>{pct(v.confidence)}</b> ·
            worth <b>{pct(v.tranche_fraction)}</b>
          </p>
          {v.concerns?.length > 0 && (
            <ul className="notes">
              {v.concerns.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          )}
        </div>

        <div className="judge">
          {event.verifier ? (
            <>
              <h3>
                Verifier <code>{event.verifier.model}</code> · paid {event.verificationFeeUsdc} USDC
              </h3>
              <p>{event.verifier.reasoning}</p>
              <p className="judge-meta">
                satisfied <b>{String(event.verifier.satisfies_milestone)}</b> · confidence{' '}
                <b>{pct(event.verifier.confidence)}</b> · worth <b>{pct(event.verifier.tranche_fraction)}</b>
              </p>
              {event.verifier.red_flags?.length > 0 && (
                <ul className="notes">
                  {event.verifier.red_flags.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <>
              <h3>Verifier — not consulted</h3>
              <p>The attestor refused on its own judgment, so no fee was spent.</p>
            </>
          )}
        </div>

        <div className="settle">
          {event.agreedFraction !== undefined ? (
            <span>
              Both agreed. Paid at the lower of the two, <b>{pct(event.agreedFraction)}</b> of the ceiling.
            </span>
          ) : (
            <span>{event.reason}</span>
          )}
          {event.txHash && (
            <a href={`${EXPLORER_URL}/tx/${event.txHash}`} target="_blank" rel="noreferrer">
              {short(event.txHash)} ↗
            </a>
          )}
        </div>
      </div>
    </details>
  );
}
