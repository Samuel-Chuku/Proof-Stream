import { earnerId } from '@proofstream/config';
import { cookies } from 'next/headers';
import { readEarnings } from '../../lib/earnings';
import { SESSION_COOKIE, readSession } from '../../lib/session';
import { EarningsLedger } from '../earnings-ledger';
import { GetUpdates } from '../get-updates';
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
  const id = signedIn ? earnerId('github', signedIn.id as number) : null;
  const github = id ? await readEarnings(id, fresh) : [];

  return (
    <main>
      <header className="ps-masthead">
        <div>
          <h1 className="ps-display-xl">Earnings</h1>
          <div className="ps-masthead-meta ps-label">
            <span>ARC TESTNET · 5042002</span>
            <span>WHAT EVERY STREAM OWES YOU</span>
            {/* Alerts for your own earnings, only once there is a GitHub
                identity and a stream that has credited it. */}
            {id && github.length > 0 && <GetUpdates target={id} kind="earner" />}
          </div>
        </div>
      </header>

      <EarningsLedger
        github={github}
        login={signedIn?.login ?? null}
        staleSession={!!session && !signedIn}
        fresh={fresh}
      />

      {/* THE SECURITY CLAIM, SHORT ENOUGH TO READ. It was a paragraph, and a
          paragraph at the bottom of a page is decoration: the person being
          phished does not read it. Three lines and a fold. */}
      <section className="ps-never">
        <p className="ps-label">THIS PAGE ONLY EVER ASKS FOR TWO THINGS</p>
        <ul className="ps-never-list">
          <li>
            <code>bindPayee</code>, which records where a public stream pays you. Moves no money.
          </li>
          <li>
            <code>withdrawFor</code> or <code>withdraw</code>, which pays you.
          </li>
        </ul>
        <details className="ps-never-more">
          <summary className="ps-caption">NEVER AN APPROVAL OR A PERMIT ▾</summary>
          <p className="ps-body">
            Both calls go to a stream address shown on this page, and the contract refuses either
            unless your own wallet sends it. A page that asks you to approve a token, sign a permit,
            or sign anything that is not one of those two calls is not this page. Reach this one from
            the address bar or the STREAMS list, never from a link somebody sent you.
          </p>
        </details>
      </section>

      <Footer />
    </main>
  );
}
