import { earnerId } from '@proofstream/config';
import { cookies } from 'next/headers';
import { readEarnings } from '../../lib/earnings';
import { SESSION_COOKIE, readSession } from '../../lib/session';
import { EarningsLedger } from '../earnings-ledger';
import { Footer } from '../footer';

// The session is a cookie and the position moves with the clock.
export const dynamic = 'force-dynamic';

/// THE CONTRIBUTOR'S PAGE: what every stream owes you, and where to send it.
///
/// A stream can know you by GitHub (a public stream credits the account that
/// merged the work) or by wallet (a named stream fixed its contributor at
/// deploy; a public stream records the payee you bound). Both are shown here,
/// as one ledger. The GitHub half is read here on the server, from the
/// session cookie; the wallet half is read in the browser, because only the
/// browser knows which wallet is connected.
///
/// This page is a phishing target by construction. It is where a contributor
/// connects a wallet and signs, which is the exact motion every drainer copies.
/// So it is built in the order that makes a fake hard to pass off: identity
/// first; then every term of every stream, read from the contract, before any
/// wallet is asked for anything; and the only transactions it ever asks for
/// are calls to that contract, never a token approval.
export default async function Earnings({
  searchParams,
}: {
  searchParams: Promise<{ fresh?: string }>;
}) {
  const fresh = (await searchParams).fresh !== undefined;
  const session = readSession((await cookies()).get(SESSION_COOKIE)?.value);
  // A session minted before the numeric id was stored proves a login but not
  // the number the contract's earner id is hashed from. Sign in again.
  const signedIn = session?.id ? session : null;
  const github = signedIn ? await readEarnings(earnerId('github', signedIn.id as number), fresh) : [];

  return (
    <main>
      <header className="ps-masthead">
        <div>
          <h1 className="ps-display-xl">Earnings</h1>
          <div className="ps-masthead-meta ps-label">
            <span>ARC TESTNET · 5042002</span>
            <span>WHAT EVERY STREAM OWES YOU</span>
          </div>
        </div>
      </header>

      <EarningsLedger
        github={github}
        login={signedIn?.login ?? null}
        staleSession={!!session && !signedIn}
        fresh={fresh}
      />

      <div className="ps-section-rule">
        <span className="ps-label">WHAT THIS PAGE WILL NEVER ASK</span>
      </div>
      <p className="ps-body">
        A token approval, a permit, or a signature over anything but a stream&rsquo;s own contract.
        The transactions here are <code>withdraw</code> on a named stream, and on a public one{' '}
        <code>bindPayee</code>, which records where you are paid, then <code>withdrawFor</code>, which
        pays you. Every one goes to a stream address shown on this page, and every one is refused by
        the contract unless your own wallet sends it. If a page that looks like this asks for anything
        else, it is not this page. Reach it from the address bar or the STREAMS list, never from a link
        someone sent you.
      </p>

      <Footer />
    </main>
  );
}
