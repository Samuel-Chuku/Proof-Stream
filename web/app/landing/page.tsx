import { headers } from 'next/headers';
import { listStreams } from '../../lib/registry';
import { AgentMark } from '../agent-mark';
import { BrandMark } from '../brand-mark';
import { Footer } from '../footer';

export const dynamic = 'force-dynamic';

/// The landing page, served at the apex (proofstream.site) by a rewrite in
/// middleware.ts. Reachable only there — the app host redirects `/landing` back
/// to the apex so the page has exactly one address.
///
/// It sells; the app onboards. Nothing here asks the visitor to connect a
/// wallet, pick a repository or hold a balance, because the whole argument has
/// to land before any of that is a reasonable request.
///
/// The counters are read live from the registry rather than written into copy.
/// "USDC released by agents" is the claim this project stands on, so it should
/// be a number that moves, and one a reader can check on the explorer.
export default async function Landing() {
  const streams = await listStreams();
  const released = streams.reduce((sum, s) => sum + Number(s.earned), 0);

  // Derived from the request rather than configured: a preview deployment then
  // points at its own app host instead of production.
  const host = (await headers()).get('host') ?? 'proofstream.site';
  const app = `https://app.${host.replace(/^app\./, '')}`;

  return (
    <main>
      <header className="ps-masthead">
        <div className="ps-brand-hero">
          <BrandMark size={56} className="ps-brand-hero-mark" />
          <div>
            <h1 className="ps-display-xl">Payroll that verifies itself</h1>
            <div className="ps-masthead-meta ps-label">
              <span>ARC TESTNET · 5042002</span>
              <span>
                {streams.length} STREAM{streams.length === 1 ? '' : 'S'}
              </span>
              <span>{(released / 1e6).toFixed(2)} USDC RELEASED BY AGENTS</span>
            </div>
          </div>
        </div>
      </header>

      <p className="ps-lede">
        USDC accrues by the second and stays <b>locked</b> until an autonomous agent reads the merged
        work, judges it against the milestone, buys a second opinion from another agent, and certifies
        how much of the job is done. Stop shipping and the money pauses itself.
      </p>
      <p className="ps-body">
        No human approves a payment. The agent spends its own money to do it, and the contract — not
        the agent — decides how much it is allowed to release.
      </p>
      <p className="ps-body">
        Certifying does not move money; it raises what the contributor is owed, and the stream pays
        that out on its own schedule. So one judgment keeps paying as the work accrues, and a
        contributor who finishes a milestone never has to invent more pull requests to collect it.
      </p>

      <div className="ps-cta-row">
        <a className="ps-button ps-button-primary" href={app}>
          [ OPEN THE APP ]
        </a>
        <a className="ps-button" href={`${app}/streams`}>
          [ BROWSE LIVE STREAMS ]
        </a>
        <a className="ps-button" href={`${app}/docs`}>
          [ HOW IT WORKS ]
        </a>
      </div>

      <div className="ps-section-rule">
        <span className="ps-label">THE TWO AGENTS</span>
      </div>

      <div className="ps-two-col">
        <section>
          <h2 className="ps-agent-head">
            <AgentMark role="attestor" /> THE ATTESTOR
          </h2>
          <p className="ps-body">
            Reads the diff and the milestone straight from the contract, decides whether the work
            satisfies it and <em>how much of the milestone is done</em>, then signs an EIP-712
            attestation and sends it from its own wallet, paying its own gas.
          </p>
        </section>

        <section>
          <h2 className="ps-agent-head">
            <AgentMark role="verifier" /> THE VERIFIER
          </h2>
          <p className="ps-body">
            A separate process with its own wallet and a different model vendor. The attestor pays it
            $0.005 over x402 before acting. It gathers its own copy of the evidence and never sees
            the attestor&rsquo;s answer — and the payout is the <em>lower</em> of the two.
          </p>
        </section>
      </div>

      <Footer />
    </main>
  );
}
