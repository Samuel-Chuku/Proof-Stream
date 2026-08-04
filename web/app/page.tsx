import Link from 'next/link';
import { listStreams } from '../lib/registry';
import { AgentMark } from './agent-mark';
import { BrandMark } from './brand-mark';
import { Footer } from './footer';
import { GettingStarted } from './getting-started';

export const dynamic = 'force-dynamic';

/// Home. Answers "what is this and what do I do" before showing anything else.
///
/// The stream list used to live here, which meant a first-time visitor landed
/// on a table of other people's contracts with no explanation. Streams now have
/// their own route and this page does the job a home page should.
export default async function Home() {
  const streams = await listStreams();
  const released = streams.reduce((sum, s) => sum + Number(s.unlocked), 0);

  return (
    <main>
      <header className="ps-masthead">
        {/* The mark is full size ONLY here. Every other page carries it in the
            nav 40px above its own heading, where repeating it would be noise. */}
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
        work, judges it against the milestone, buys a second opinion from another agent, and signs an
        attestation releasing a tranche. Stop shipping and the money pauses itself.
      </p>
      <p className="ps-body">
        No human approves a payment. The agent spends its own money to do it, and the contract — not
        the agent — decides how much it is allowed to release.
      </p>

      <div className="ps-cta-row">
        <Link className="ps-button" href="/new">
          [ CREATE A STREAM ]
        </Link>
        <Link className="ps-button" href="/streams">
          [ BROWSE STREAMS ]
        </Link>
        <Link className="ps-button" href="/docs">
          [ HOW IT WORKS ]
        </Link>
      </div>

      <GettingStarted hasStreams={streams.length > 0} />

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
            satisfies it and <em>how much it is worth</em>, then signs an EIP-712 attestation and
            sends the unlock from its own wallet, paying its own gas.
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
