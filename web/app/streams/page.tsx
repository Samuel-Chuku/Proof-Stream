import { EXPLORER_URL } from '@proofstream/config';
import Link from 'next/link';
import { readAgentHealth } from '../../lib/agent-health';
import { listStreams } from '../../lib/registry';
import { AddressChip } from '../address-chip';
import { Footer } from '../footer';
import { GettingStarted } from '../getting-started';
import { Amount } from '../amount';

// The registry and every stream's state move while the page is open.
export const dynamic = 'force-dynamic';

/// The ledger of streams.
///
/// Every registered stream is listed, not just the viewer's — the registry is
/// public, one agent serving several employers is the claim being made, and a
/// reader should not need a wallet to see it.
///
/// Rows deliberately carry no miniature cell grid. The stream bar is the one
/// showpiece, and a 4px strip would borrow its language without its meaning:
/// nobody can count those cells, so the green would become decoration. Green
/// stays a claim about released USDC, on the stream page where it can be read.
export default async function Streams() {
  const [streams, health] = await Promise.all([listStreams(), readAgentHealth()]);

  // A stream nobody is watching looks identical to a healthy one on this list,
  // which is how work gets done against a stream that will never pay.
  const unwatched = streams.filter(
    (s) => s.state !== 'settled' && !health.serving.has(s.address.toLowerCase()),
  );

  return (
    <main>
      <header className="ps-masthead">
        <div>
          <h1 className="ps-display-xl">Streams</h1>
          <div className="ps-masthead-meta ps-label">
            <span>ARC TESTNET · 5042002</span>
            <span>{streams.length} REGISTERED</span>
          </div>
        </div>
      </header>

      <p className="ps-body">
        USDC payroll that accrues by the second and stays locked until an autonomous agent reads the
        merged work, judges it against the milestone, buys a second opinion from another agent, and
        signs an attestation releasing a tranche. One agent process serves every stream below.
      </p>

      <GettingStarted hasStreams={streams.length > 0} />

      {unwatched.length > 0 && (
        <details className="ps-notice ps-notice-warn">
          <summary>
            <span className="ps-notice-mark" aria-hidden>
              ⚠
            </span>
            <span className="ps-notice-title">
              {unwatched.length} stream{unwatched.length === 1 ? ' is' : 's are'} not being watched
            </span>
            <span className="ps-notice-more">DETAIL ▾</span>
          </summary>
          <p className="ps-notice-detail">
            {health.reachable
              ? 'Merged work on them will not be judged or paid. Open one to see why.'
              : 'The agent cannot be reached, so nothing is being judged. The streams keep accruing regardless.'}
          </p>
        </details>
      )}

      <div className="ps-section-rule">
        <span className="ps-label">STREAMS</span>
      </div>

      {streams.length === 0 ? (
        <section className="ps-gate">
          <p className="ps-body" style={{ marginTop: 0 }}>
            No streams registered yet. Creating one deploys a contract from your own wallet — you
            are its employer, and nothing but you can open, fund or close its milestones.
          </p>
          <Link className="ps-button" href="/new">
            [ CREATE A STREAM ]
          </Link>
        </section>
      ) : (
        <>
          <div className="ps-feed">
            {streams.map((s) => (
              <Link key={s.address} href={`/stream/${s.address}`} className="ps-stream-row">
                <span className="ps-tx-action">{s.repo || '(no repo set)'}</span>
                <span className="ps-caption">MILESTONE {s.milestoneIndex}</span>
                <span className={`ps-status ps-status-${s.state.replace(' ', '-')}`}>
                  {s.state.toUpperCase()}
                </span>
                <span className="ps-caption ps-watch">
                  {s.state === 'settled'
                    ? ''
                    : health.serving.has(s.address.toLowerCase())
                      ? 'WATCHED'
                      : '⚠ NOT WATCHED'}
                </span>
                <span className="ps-stream-figures">
                  <Amount raw={Number(s.unlocked)} size="m" suffix={false} /> released of{' '}
                  <Amount raw={Number(s.budget)} size="m" />
                </span>
                <span aria-hidden>→</span>
              </Link>
            ))}
          </div>

          <p style={{ marginTop: 'var(--ps-4)' }}>
            <Link className="ps-button" href="/new">
              [ CREATE A STREAM ]
            </Link>
          </p>
        </>
      )}

      <div className="ps-section-rule">
        <span className="ps-label">THE REGISTRY</span>
      </div>
      <p className="ps-body">
        Streams announce themselves to a registry contract, and the agent discovers them by reading
        its log. Only a stream&rsquo;s own employer can announce it, and the agent refuses any stream
        that did not appoint it — so nobody can point this agent at a repository it was never hired
        to watch.
      </p>
      <p className="ps-caption" style={{ marginTop: 'var(--ps-2)' }}>
        REGISTRY{' '}
        <AddressChip
          address={process.env.NEXT_PUBLIC_REGISTRY_ADDRESS ?? ''}
          href={`${EXPLORER_URL}/address/${process.env.NEXT_PUBLIC_REGISTRY_ADDRESS ?? ''}`}
        />
      </p>
      <Footer />

    </main>
  );
}
