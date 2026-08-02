import { EXPLORER_URL } from '@proofstream/config';
import { readAgentLogs, totalSpend, type AgentEvent } from '../../../lib/events';
import { readStream } from '../../../lib/stream';
import { AddressChip } from '../../address-chip';
import { Amount } from '../../amount';
import { LockedFigure } from '../../stream-bar';
import { ThemeToggle } from '../../theme-toggle';

// The chain and the agent logs both move while the page is open.
export const dynamic = 'force-dynamic';

const pct = (n: number | undefined) => (n === undefined ? '—' : n.toFixed(2));
const time = (iso: string) => `${iso.slice(11, 19)} UTC`;

/// Label sitting on a dashed rule, left-aligned.
function SectionRule({ children }: { children: string }) {
  return (
    <div className="ps-section-rule">
      <span className="ps-label">{children}</span>
    </div>
  );
}

export default async function StreamPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  const stream = await readStream(address);
  const logs = await readAgentLogs();
  // Only this stream's judgments. The agent's log is fleet-wide.
  const verdicts = logs.verdicts.filter(
    (v) => !v.workStream || v.workStream.toLowerCase() === address.toLowerCase(),
  );
  const spend = totalSpend(verdicts, logs.reviews);
  const decisions = verdicts.filter((v) => v.verdict);
  const settled = verdicts.filter((v) => v.txHash);

  return (
    <main>
      <header className="ps-masthead">
        <div>
          <h1 className="ps-display-xl">ProofStream</h1>
          <div className="ps-masthead-meta ps-label">
            {stream ? (
              <>
                <AddressChip address={stream.address} href={`${EXPLORER_URL}/address/${stream.address}`} />
                <span>ARC TESTNET · 5042002</span>
                <span>MILESTONE {stream.milestoneIndex}</span>
              </>
            ) : (
              <span>ARC TESTNET · 5042002</span>
            )}
          </div>
        </div>
        <ThemeToggle />
      </header>

      {!stream ? (
        <section className="ps-invert">
          <h2 className="ps-display-l">⚠ CONTRACT UNREADABLE</h2>
          <p className="ps-body">
            The dashboard could not read the stream. Check that WORKSTREAM_ADDRESS points at a
            deployed contract and that ARC_RPC_URL reaches Arc Testnet, chain 5042002.
          </p>
        </section>
      ) : (
        <>
          <LockedFigure stream={stream} />

          <SectionRule>MILESTONE</SectionRule>
          <p className="ps-body">{stream.milestone}</p>
          <p className="ps-caption" style={{ marginTop: 'var(--ps-2)' }}>
            WATCHING {stream.repo} · CEILING {(Number(stream.maxTranche) / 1e6).toFixed(0)} USDC PER
            UNLOCK · {(Number(stream.dailyUnlockCap) / 1e6).toFixed(0)} PER DAY
          </p>

          <SectionRule>AGENT DECISIONS</SectionRule>

          {decisions.length === 0 ? (
            <section className="ps-gate">
              <p className="ps-body" style={{ margin: 0 }}>
                No verdicts yet — the agent posts here when a pull request is merged on{' '}
                {stream.repo}. The stream continues accruing meanwhile.
              </p>
            </section>
          ) : (
            decisions.map((v, i) => <VerdictCard key={`${v.at}-${i}`} event={v} />)
          )}

          <SectionRule>ON-CHAIN TRANSACTIONS</SectionRule>
          {settled.length === 0 ? (
            <p className="ps-caption">NONE YET</p>
          ) : (
            <div className="ps-feed">
              {settled.map((v, i) => (
                <div className="ps-tx-row" key={`${v.at}-tx-${i}`}>
                  <span className="ps-tx-time">{time(v.at)}</span>
                  <span className="ps-tx-action">UNLOCK</span>
                  <Amount raw={Number(v.trancheUsdc ?? 0) * 1e6} size="m" />
                  <a href={`${EXPLORER_URL}/tx/${v.txHash}`} target="_blank" rel="noreferrer">
                    ↗
                  </a>
                </div>
              ))}
            </div>
          )}
          <p className="ps-caption" style={{ marginTop: 'var(--ps-2)' }}>
            ● VERIFICATION FEES SETTLE IN GATEWAY BATCHES AND HAVE NO INDIVIDUAL TRANSACTION
          </p>
        </>
      )}

      <SectionRule>WHAT THE AGENTS SPENT</SectionRule>
      <p className="ps-body">
        ${spend.total.toFixed(4)} across {decisions.length} decisions — inference plus{' '}
        {spend.paidReviews} second opinions bought at $0.005 each, paid by the attestor from its own
        wallet.
      </p>
    </main>
  );
}

/// Verbatim model output. Do not summarise, truncate or prettify it — it is the
/// evidence that this is judgment rather than a boolean in costume.
function VerdictCard({ event }: { event: AgentEvent }) {
  const v = event.verdict!;
  const paid = Boolean(event.txHash);

  return (
    <article className="ps-verdict">
      <div className="ps-verdict-head">
        <span className="ps-label">
          {paid ? '◆' : '○'} VERDICT · PR #{event.pr} · {event.model}
        </span>
        {event.txHash && (
          <AddressChip address={event.txHash} href={`${EXPLORER_URL}/tx/${event.txHash}`} />
        )}
      </div>

      <dl className="ps-verdict-fields">
        <dt>Satisfies milestone</dt>
        <dd>{v.satisfies_milestone ? 'YES' : 'NO'}</dd>
        <dt>Confidence</dt>
        <dd className="ps-num">{pct(v.confidence)}</dd>
        {/* A refusal renders identically but with no tranche row. A refusal is a
            verdict, not an error, and must not look like one. */}
        {event.trancheUsdc && (
          <>
            <dt>Tranche</dt>
            <dd>
              <Amount raw={Number(event.trancheUsdc) * 1e6} size="m" />
            </dd>
          </>
        )}
      </dl>

      <p className="ps-verdict-reasoning">{v.reasoning}</p>

      {event.verifier && (
        <p className="ps-verdict-reasoning" style={{ borderTop: '1px dashed var(--ps-border)' }}>
          <span className="ps-label">
            SECOND OPINION · {event.verifier.model} · PAID {event.verificationFeeUsdc} USDC
          </span>
          <br />
          {event.verifier.reasoning}
        </p>
      )}

      <div className="ps-verdict-foot">
        <span className="ps-label">
          {event.verifier
            ? `AGREED AT ${pct(event.agreedFraction)} — THE LOWER OF THE TWO`
            : 'VERIFIER NEVER CONSULTED — NO FEE SPENT'}
        </span>
        <span className="ps-label">{time(event.at)}</span>
      </div>
    </article>
  );
}
