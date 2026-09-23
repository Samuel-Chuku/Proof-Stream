import Link from 'next/link';
import { agentRoute } from '../../../lib/agent-url';
import { Footer } from '../../footer';

// The token is in the URL and the answer depends on ledger state.
export const dynamic = 'force-dynamic';

/// WHERE A CONFIRM OR UNSUBSCRIBE LINK LANDS.
///
/// On this domain, because a link in an email is exactly the thing people are
/// told to look at twice: `app.proofstream.site` is the name they already know,
/// and the agent's ingress is not. The click is forwarded to the agent, which
/// owns the subscriptions.
export default async function ConfirmAlerts({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const token = (await searchParams).t ?? '';
  const url = agentRoute('/email/act');

  let title = 'THAT LINK DID NOT WORK';
  let message = 'Email alerts are not configured on this deployment.';

  if (url && token) {
    try {
      const res = await fetch(`${url}?t=${encodeURIComponent(token)}`, { cache: 'no-store', signal: AbortSignal.timeout(20_000) });
      const body = (await res.json()) as { title?: string; message?: string };
      title = body.title ?? title;
      message = body.message ?? message;
    } catch {
      message = 'The agent could not be reached, so nothing was changed. Try the link again shortly.';
    }
  }

  return (
    <main>
      <header className="ps-masthead">
        <div>
          <h1 className="ps-display-xl">Alerts</h1>
          <p className="ps-masthead-meta ps-label">{title}</p>
        </div>
      </header>

      <section className="ps-gate">
        <p className="ps-body" style={{ marginTop: 0 }}>
          {message}
        </p>
        <Link className="ps-button" href="/streams">
          [ GO TO STREAMS ]
        </Link>
      </section>

      <Footer />
    </main>
  );
}
