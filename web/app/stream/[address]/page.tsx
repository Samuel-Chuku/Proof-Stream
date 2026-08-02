import { EXPLORER_URL } from '@proofstream/config';
import { readAgentLogs, totalSpend, type AgentEvent } from '../../../lib/events';
import { readStream } from '../../../lib/stream';
import { AddressChip } from '../../address-chip';
import { AgentMark } from '../../agent-mark';
import { Footer } from '../../footer';
import { Amount } from '../../amount';
import { StreamActions } from '../../stream-actions';
import { LockedFigure } from '../../stream-bar';

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

          <SectionRule>YOUR ACTIONS</SectionRule>
          <StreamActions stream={stream} />

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
      <Footer />

    </main>
  );
}

/// First sentence only, for the preview. Falls back to a clipped slice when the
/// model writes one long unpunctuated block, which it sometimes does.
function firstSentence(text: string): string {
  const match = text.match(/^.*?[.!?](?=\s|$)/);
  const sentence = match ? match[0] : text;
  return sentence.length > 160 ? `${sentence.slice(0, 157)}…` : sentence;
}

/// Collapsed to a scan line: which agent, what it decided, its opening
/// sentence, and the amount. Expands to both agents' verbatim reasoning.
///
/// The expand affordance is the chevron alone — no label. The row is already
/// a summary and reads as one; spelling out "read full verdict" put explanatory
/// copy where the eye wants data.
function VerdictCard({ event }: { event: AgentEvent }) {
  const v = event.verdict!;
  const paid = Boolean(event.txHash);
  const refused = !v.satisfies_milestone;

  // Green edge ONLY where money actually moved; ink for a refusal; faint for
  // an escalation. See globals.css for why there is no red.
  const tone = paid ? 'paid' : refused ? 'refused' : 'held';
  const outcome = paid ? 'RELEASED' : refused ? 'REFUSED' : 'HELD';

  return (
    <details className={`ps-verdict ps-verdict-${tone}`}>
      <summary>
        <span className="ps-verdict-who">
          <AgentMark role="attestor" />
          <b className="ps-verdict-agent">ATTESTOR</b>
          <span className="ps-label ps-verdict-outcome">
            PR #{event.pr} · {outcome}
          </span>
        </span>

        <span className="ps-verdict-preview">{firstSentence(v.reasoning)}</span>

        <span className="ps-verdict-right">
          {event.trancheUsdc ? (
            <Amount raw={Number(event.trancheUsdc) * 1e6} size="s" />
          ) : (
            <span className="ps-caption">NO PAYOUT</span>
          )}
          <span className="ps-verdict-chevron" aria-hidden>
            ▾
          </span>
        </span>
      </summary>

      <dl className="ps-verdict-fields">
        <dt>Satisfies milestone</dt>
        <dd>{v.satisfies_milestone ? 'YES' : 'NO'}</dd>
        <dt>Confidence</dt>
        <dd className="ps-num">{pct(v.confidence)}</dd>
        <dt>Judged by</dt>
        <dd>{event.model}</dd>
        {event.txHash && (
          <>
            <dt>Transaction</dt>
            <dd>
              <AddressChip address={event.txHash} href={`${EXPLORER_URL}/tx/${event.txHash}`} />
            </dd>
          </>
        )}
      </dl>

      <div className="ps-verdict-voice">
        <p className="ps-label ps-verdict-voice-head">
          <AgentMark role="attestor" /> ATTESTOR · {event.model}
        </p>
        <p className="ps-verdict-reasoning">{v.reasoning}</p>
      </div>

      {event.verifier ? (
        <div className="ps-verdict-voice">
          <p className="ps-label ps-verdict-voice-head">
            <AgentMark role="verifier" /> VERIFIER · {event.verifier.model} · PAID{' '}
            {event.verificationFeeUsdc} USDC
          </p>
          <p className="ps-verdict-reasoning">{event.verifier.reasoning}</p>
        </div>
      ) : (
        <div className="ps-verdict-voice">
          <p className="ps-label ps-verdict-voice-head">
            <AgentMark role="verifier" /> VERIFIER · NOT CONSULTED
          </p>
          <p className="ps-verdict-reasoning">
            The attestor refused on its own judgment, so no second opinion was bought and no fee was
            spent. Refusal is free.
          </p>
        </div>
      )}

      <div className="ps-verdict-foot">
        <span className="ps-label">
          {event.verifier
            ? `BOTH AGREED — PAID AT ${pct(event.agreedFraction)}, THE LOWER OF THE TWO`
            : 'DECIDED BY THE ATTESTOR ALONE'}
        </span>
        <span className="ps-label">{time(event.at)}</span>
      </div>
    </details>
  );
}
