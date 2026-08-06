import { EXPLORER_URL, formatUsdc } from '@proofstream/config';
import { diagnose, readAgentHealth } from '../../../lib/agent-health';
import { readAgentLogs, totalSpend, type AgentEvent } from '../../../lib/events';
import { readStreamTransactions } from '../../../lib/onchain';
import { listStreams } from '../../../lib/registry';
import { readStream } from '../../../lib/stream';
import { AddressChip } from '../../address-chip';
import { AgentMark } from '../../agent-mark';
import { Footer } from '../../footer';
import { Amount } from '../../amount';
import { PasskeyWithdraw } from '../../passkey-withdraw';
import { StreamActions } from '../../stream-actions';
import { LockedFigure } from '../../stream-bar';
import { Reveal } from '../../reveal';
import { TxDecision } from '../../tx-decision';
import { VerdictBody } from '../../verdict-body';

// The chain and the agent logs both move while the page is open.
export const dynamic = 'force-dynamic';

/// Never rounded to a whole unit. This is an on-chain policy value a judge can
/// read off the contract, and `.toFixed(0)` was rendering a 7.5 USDC ceiling as
/// "8" — a number that does not appear anywhere in the deployment.
function formatCeiling(raw: string): string {
  const usdc = Number(raw) / 1e6;
  return Number.isInteger(usdc) ? usdc.toFixed(0) : String(usdc);
}

/// Transaction rows are sorted newest-first and routinely span several days, so
/// a bare clock time reads as out of order — 08:41 sitting above 21:07 looks
/// wrong until you notice they are different days. Date first, UTC stated once
/// in the caption above the list rather than on every row.
const stamp = (iso: string) =>
  `${iso.slice(8, 10)} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(11, 19)}`;
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

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

  // Whether the agent is ACTUALLY watching this stream. Everything else on this
  // page describes the contract; this is the only thing that says whether
  // anyone is listening.
  const [health, allStreams] = await Promise.all([readAgentHealth(), listStreams()]);

  // BOTH logs are fleet-wide, and both must be filtered. Passing the reviews
  // through unfiltered made a brand-new stream report the whole fleet's
  // verifier spend against its own zero decisions.
  //
  // An explicit match, not "untagged counts as mine": an entry that names no
  // stream cannot be attributed to one, and guessing inflates the newest page.
  const mine = (x: { workStream?: string }) => x.workStream?.toLowerCase() === address.toLowerCase();
  const verdicts = logs.verdicts.filter(mine);
  const spend = totalSpend(verdicts, logs.reviews.filter(mine));
  const decisions = verdicts.filter((v) => v.verdict);
  const settled = verdicts.filter((v) => v.txHash);

  // What PEOPLE did, read from the stream's own event log. Anchored to the
  // block it was announced in so the scan covers this stream's lifetime rather
  // than the whole registry's.
  const mySummary = allStreams.find((x) => x.address.toLowerCase() === address.toLowerCase());
  const humanTxs = await readStreamTransactions(
    address,
    BigInt(mySummary?.registeredAtBlock ?? process.env.REGISTRY_DEPLOY_BLOCK ?? '54593230'),
  );

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
          {(() => {
            // What closeMilestone would refund, computed the same way the
            // contract does: everything held that is not already owed.
            const held = BigInt(stream.held);
            const owed = BigInt(stream.withdrawable);
            const coverage = diagnose({
              address: stream.address,
              repo: stream.repo,
              settled: stream.milestoneClosed,
              endsAt: stream.activatedAt === 0 ? 0 : stream.activatedAt + stream.duration,
              reclaimableUsdc: formatUsdc(held > owed ? held - owed : 0n),
              agentOnChain: stream.agent,
              health,
              allStreams,
            });
            if (coverage.served) return null;
            // One line, expandable. This is a status note, not the headline —
            // the money is. A full-width panel above the hero buried the thing
            // the page exists to show.
            return (
              <details className={`ps-notice${coverage.expected ? '' : ' ps-notice-warn'}`}>
                <summary>
                  <span className="ps-notice-mark" aria-hidden>
                    {coverage.expected ? '○' : '⚠'}
                  </span>
                  <span className="ps-notice-title">{coverage.title}</span>
                  <span className="ps-notice-more">DETAIL ▾</span>
                </summary>
                <p className="ps-notice-detail">{coverage.detail}</p>
              </details>
            );
          })()}

          <LockedFigure stream={stream} />

          <SectionRule>YOUR ACTIONS</SectionRule>
          <StreamActions stream={stream} />
            <PasskeyWithdraw stream={stream} />

          <SectionRule>MILESTONE</SectionRule>
          <p className="ps-body">{stream.milestone}</p>
          <p className="ps-caption" style={{ marginTop: 'var(--ps-2)' }}>
            WATCHING {stream.repo} · CEILING {formatCeiling(stream.maxTranche)} USDC PER
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
            <Reveal initial={10} noun="decisions">
              {decisions.map((v, i) => (
                <VerdictCard key={`${v.at}-${i}`} event={v} />
              ))}
            </Reveal>
          )}

          <SectionRule>ON-CHAIN TRANSACTIONS</SectionRule>
          <p className="ps-caption ps-tx-intro">
            NEWEST FIRST · TIMES UTC · EVERY ROW LINKS TO ARC EXPLORER, SO NOTHING HERE HAS TO BE
            TAKEN ON TRUST
          </p>

          <h3 className="ps-subhead">BY THE AGENT</h3>
          {settled.length === 0 ? (
            <p className="ps-caption">NONE YET</p>
          ) : (
            <div className="ps-feed">
              <Reveal initial={3} noun="unlocks">
                {settled.map((v, i) => (
                  <div className="ps-tx-row" key={`${v.at}-tx-${i}`}>
                    <span className="ps-tx-time">{stamp(v.at)}</span>
                    <span className="ps-tx-action">UNLOCK</span>
                    <Amount raw={Number(v.trancheUsdc ?? 0) * 1e6} size="m" />
                    {/* The judgment that produced this transaction, one click
                        away — the row is otherwise just an amount. */}
                    {v.verdict ? (
                      <TxDecision pr={v.pr}>
                        <VerdictBody event={v} />
                      </TxDecision>
                    ) : (
                      <span />
                    )}
                    <a href={`${EXPLORER_URL}/tx/${v.txHash}`} target="_blank" rel="noreferrer">
                      ↗
                    </a>
                  </div>
                ))}
              </Reveal>
            </div>
          )}
          <p className="ps-caption" style={{ marginTop: 'var(--ps-2)' }}>
            ● VERIFICATION FEES SETTLE IN GATEWAY BATCHES AND HAVE NO INDIVIDUAL TRANSACTION
          </p>

          <h3 className="ps-subhead">BY A HUMAN</h3>
          {humanTxs.length === 0 ? (
            <p className="ps-caption">NONE YET</p>
          ) : (
            <div className="ps-feed">
              <Reveal initial={3} noun="actions">
                {humanTxs.map((t) => (
                  <div className="ps-tx-row ps-tx-row-human" key={t.txHash}>
                    <span className="ps-tx-time">{stamp(new Date(t.at * 1000).toISOString())}</span>
                    <span className="ps-tx-action">{t.action}</span>
                    {t.amountRaw ? (
                      <Amount raw={Number(t.amountRaw)} size="m" />
                    ) : (
                      <span className="ps-caption">{t.detail}</span>
                    )}
                    {t.amountRaw && t.detail ? (
                      <span className="ps-caption ps-tx-detail">{t.detail}</span>
                    ) : (
                      <span />
                    )}
                    <a href={`${EXPLORER_URL}/tx/${t.txHash}`} target="_blank" rel="noreferrer">
                      ↗
                    </a>
                  </div>
                ))}
              </Reveal>
            </div>
          )}
          <p className="ps-caption" style={{ marginTop: 'var(--ps-2)' }}>
            ● TOKEN APPROVALS ARE OMITTED — THEY GRANT PERMISSION, THEY DO NOT MOVE MONEY
          </p>
        </>
      )}

      <SectionRule>WHAT THE AGENTS SPENT ON THIS STREAM</SectionRule>
      {decisions.length === 0 ? (
        <p className="ps-body">
          Nothing yet. The agents only spend when there is work to judge — the attestor pays for its
          own reasoning, and pays the verifier $0.005 for a second opinion, out of their own
          wallets.
        </p>
      ) : (
        <>
          <p className="ps-body">
            <b>${spend.total.toFixed(4)}</b> of the agents&rsquo; own money, to decide{' '}
            {decisions.length} pull request{decisions.length === 1 ? '' : 's'} on this stream.
          </p>
          <div className="ps-figures">
            <div>
              <span className="ps-caption">ATTESTOR REASONING</span>
              <span className="ps-num">${spend.attestorInference.toFixed(4)}</span>
            </div>
            <div>
              <span className="ps-caption">VERIFIER REASONING</span>
              <span className="ps-num">${spend.verifierInference.toFixed(4)}</span>
            </div>
            <div>
              <span className="ps-caption">
                SECOND OPINIONS BOUGHT ({spend.paidReviews})
              </span>
              <span className="ps-num">${spend.verificationFees.toFixed(4)}</span>
            </div>
          </div>
          <p className="ps-caption" style={{ marginTop: 'var(--ps-3)' }}>
            REFUSING IS FREE — NO SECOND OPINION IS BOUGHT WHEN THE ATTESTOR DECLINES ON ITS OWN
          </p>
        </>
      )}
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

  // `unlocked` is the ONLY outcome where money moved. A txHash is not enough:
  // a transaction that reverted on chain still has one, and a transaction the
  // node refused to estimate has none while the attempt is still logged with
  // its amount. Reading a hash as "paid" is what made a policy revert render as
  // "HELD · 30.000000 USDC", which says the opposite of what happened.
  const paid = event.event === 'unlocked';
  const blocked = event.event === 'unlock_failed';
  const refused = !v.satisfies_milestone;

  // Green edge ONLY where money actually moved; ink for a refusal; faint for an
  // escalation; hatched for a release the CONTRACT stopped. See globals.css for
  // why there is no red.
  const tone = paid ? 'paid' : blocked ? 'blocked' : refused ? 'refused' : 'held';
  const outcome = paid
    ? 'RELEASED'
    : blocked
      ? 'BLOCKED BY THE ON-CHAIN POLICY'
      : refused
        ? 'REFUSED'
        : 'HELD';

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
          {/* An amount here means money moved. Anything else says so plainly —
              a blocked release names the sum it was refused, because that is
              the point of the row, but never as a figure that reads as paid. */}
          {paid && event.trancheUsdc ? (
            <Amount raw={Number(event.trancheUsdc) * 1e6} size="s" />
          ) : blocked && event.trancheUsdc ? (
            <span className="ps-caption">{event.trancheUsdc} USDC REFUSED</span>
          ) : (
            <span className="ps-caption">NO PAYOUT</span>
          )}
          <span className="ps-verdict-chevron" aria-hidden>
            ▾
          </span>
        </span>
      </summary>

      <VerdictBody event={event} />
    </details>
  );
}
