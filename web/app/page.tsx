import Link from 'next/link';
import { listStreams } from '../lib/registry';
import { BrandMark } from './brand-mark';
import { Footer } from './footer';
import { GettingStarted } from './getting-started';

export const dynamic = 'force-dynamic';

/// The APP's home, served at app.proofstream.site. The pitch lives on the
/// landing page at the apex (see middleware.ts) — someone who has arrived here
/// has already read it, or does not need it, and repeating it would put an
/// argument between them and the thing they came to do.
///
/// So this page answers "what do I do next", not "what is this": the checklist
/// tracks real state — wallet, balance, GitHub, first stream — and the links go
/// straight to the work.
export default async function AppHome() {
  const streams = await listStreams();

  return (
    <main>
      <header className="ps-masthead">
        <div className="ps-brand-hero">
          <BrandMark size={56} className="ps-brand-hero-mark" />
          <div>
            <h1 className="ps-display-xl">Your streams</h1>
            <div className="ps-masthead-meta ps-label">
              <span>ARC TESTNET · 5042002</span>
              <span>
                {streams.length} STREAM{streams.length === 1 ? '' : 'S'} REGISTERED
              </span>
            </div>
          </div>
        </div>
      </header>

      <p className="ps-lede">
        Fund a milestone, point the agent at a repository, and merge work. The agent judges each
        merge against the milestone, buys a second opinion, and certifies how much of the job is
        done — the stream pays that out on its own schedule.
      </p>

      <div className="ps-cta-row">
        <Link className="ps-button ps-button-primary" href="/new">
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

      <Footer />
    </main>
  );
}
