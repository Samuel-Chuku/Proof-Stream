'use client';

import { useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import { AddressChip, truncate } from './address-chip';
import { Amount } from './amount';
import { Connect } from './connect';
import { EarningsStream } from './earnings-stream';
import { PasskeySweep } from './passkey-sweep';
import type { Position } from '../lib/earnings';
import {
  authenticatePasskey,
  forgetCredential,
  passkeysConfigured,
  recallCredential,
  smartAccountFor,
} from '../lib/passkey';

/// The whole ledger, from both identities.
///
/// The GitHub half arrives from the server, because the session is a cookie
/// the server can read. The wallet half is fetched here, because which wallet
/// is connected is browser state the server can never see. Both halves are
/// the same Position shape, so from the total down they render as one list.
///
/// A stream can be found both ways: an earner who bound their connected wallet
/// on a public stream. It is one position, shown once.
export function EarningsLedger({
  github,
  login,
  staleSession,
  fresh,
}: {
  github: Position[];
  /** Null when not signed in with GitHub. */
  login: string | null;
  /** Signed in before the numeric id was stored: proves a login, not the id. */
  staleSession: boolean;
  fresh: boolean;
}) {
  const { address: browserAddress, isConnected } = useAccount();
  const [passkeyAddress, setPasskeyAddress] = useState<`0x${string}` | null>(null);
  const [wallet, setWallet] = useState<Map<string, Position[]>>(new Map());
  const [reading, setReading] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const credential = recallCredential();
    if (!credential) return;
    smartAccountFor(credential)
      .then(({ account }) => setPasskeyAddress(account.address))
      .catch(() => forgetCredential());
  }, []);

  // One read per distinct wallet, whenever the set of wallets changes. A
  // browser wallet and a passkey account are two wallets; the same address
  // reached both ways is one.
  const wallets = [...new Set([isConnected ? browserAddress : null, passkeyAddress].filter(Boolean) as string[])];
  const walletKey = wallets.map((w) => w.toLowerCase()).sort().join(',');
  useEffect(() => {
    if (!mounted) return;
    for (const w of wallets) {
      const key = w.toLowerCase();
      if (wallet.has(key) || reading.includes(key)) continue;
      setReading((r) => [...r, key]);
      fetch(`/api/earnings/wallet?address=${w}${fresh ? '&fresh' : ''}`)
        .then((res) => res.json())
        .then((body: { positions?: Position[] }) => {
          setWallet((m) => new Map(m).set(key, body.positions ?? []));
        })
        .catch(() => setWallet((m) => new Map(m).set(key, [])))
        .finally(() => setReading((r) => r.filter((x) => x !== key)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletKey, mounted]);

  async function usePasskey() {
    setBusy(true);
    setError(null);
    try {
      const credential = await authenticatePasskey('login', login ? `proofstream ${login}` : 'proofstream');
      const { account } = await smartAccountFor(credential);
      setPasskeyAddress(account.address);
    } catch (err) {
      setError(err instanceof Error ? err.message.split('\n')[0] : String(err));
    } finally {
      setBusy(false);
    }
  }

  // Merge, one position per (stream, earner). The GitHub copy wins because it
  // carries the login; the wallet copy of the same public position is the
  // same chain state read twice.
  const seen = new Set<string>();
  const positions: Position[] = [];
  for (const p of [...github, ...[...wallet.values()].flat()]) {
    const key = `${p.address.toLowerCase()}:${p.earnerId ?? 'named'}`;
    if (seen.has(key)) continue;
    seen.add(key);
    positions.push(p);
  }
  const owed = positions.reduce((sum, p) => sum + p.earnings.reduce((t, e) => t + BigInt(e.withdrawable), 0n), 0n);

  // Which wallet each stream pays. There is no page-wide binding: a public
  // stream records the payee its earner bound, a named stream the payee it was
  // created with, each on its own contract. Grouped by wallet so the answer to
  // "where does my money go" is one row per destination.
  const byPayee = new Map<string, Position[]>();
  for (const p of positions) {
    if (!p.payee) continue;
    const key = p.payee.toLowerCase();
    byPayee.set(key, [...(byPayee.get(key) ?? []), p]);
  }
  const anyIdentity = !!login || wallets.length > 0;
  const stillReading = reading.length > 0;

  return (
    <>
      {/* Two ways a stream can know you, each a row: satisfied, or how to
          satisfy it. Neither is required; either is enough to show something. */}
      <div className="ps-identities">
        <div className="ps-identity">
          <span className="ps-label">GITHUB</span>
          {login ? (
            <>
              <span className="ps-identity-value">
                @{login}
                <span className="ps-caption"> · PUBLIC STREAMS THAT CREDITED YOUR MERGES</span>
              </span>
              <form action="/api/earnings/logout" method="post">
                <button type="submit" className="ps-chip">
                  SIGN OUT
                </button>
              </form>
            </>
          ) : (
            <>
              <span className="ps-caption">
                {staleSession
                  ? 'YOUR SESSION PREDATES THE ACCOUNT ID THIS PAGE NEEDS. SIGN IN AGAIN.'
                  : 'FINDS PUBLIC STREAMS THAT CREDITED YOUR MERGES'}
              </span>
              <a className="ps-button" href="/api/github/login?next=/earnings">
                [ SIGN IN WITH GITHUB ]
              </a>
            </>
          )}
        </div>

        <div className="ps-identity">
          <span className="ps-label">WALLET</span>
          {mounted && wallets.length > 0 ? (
            <span className="ps-identity-value ps-identity-wallets">
              {wallets.map((w) => (
                <span key={w}>
                  <AddressChip address={w} />
                  {w === passkeyAddress && <span className="ps-caption"> PASSKEY</span>}
                </span>
              ))}
              <span className="ps-caption">STREAMS THAT NAME IT AS CONTRIBUTOR, OR THAT IT IS BOUND TO BE PAID ON</span>
            </span>
          ) : (
            <span className="ps-caption">FINDS STREAMS THAT NAME IT AS CONTRIBUTOR, OR THAT IT IS BOUND TO BE PAID ON</span>
          )}
          {mounted && (
            <span className="ps-earner-buttons">
              {!isConnected && <Connect />}
              {passkeysConfigured && !passkeyAddress && (
                <button type="button" className="ps-button" disabled={busy} onClick={usePasskey}>
                  [ {busy ? 'OPENING…' : 'USE MY PASSKEY'} ]
                </button>
              )}
            </span>
          )}
        </div>
        {error && <p className="ps-caption">{error}</p>}
      </div>

      {!anyIdentity ? (
        <section className="ps-gate">
          <p className="ps-body" style={{ margin: 0 }}>
            Sign in with GitHub, connect a wallet, or both. Nothing here asks your wallet for anything
            until you choose where to be paid or press withdraw, and every stream&rsquo;s own terms are
            shown from its contract before that.
          </p>
        </section>
      ) : positions.length === 0 ? (
        <section className="ps-gate">
          <p className="ps-body" style={{ margin: 0 }}>
            {stillReading
              ? 'Reading the registry for streams that know this wallet…'
              : 'No stream owes this identity anything yet. A named stream pays the contributor address it was created with; a public stream credits whoever the agent accepts a merge from. Public streams carry a PUBLIC chip on the streams page.'}
          </p>
          {!stillReading && (
            <p style={{ marginTop: 'var(--ps-3)', marginBottom: 0 }}>
              <a className="ps-button" href="/streams">
                [ FIND A STREAM ]
              </a>
            </p>
          )}
        </section>
      ) : (
        <>
          {byPayee.size > 0 && (
            <div className="ps-bound" role="table" aria-label="Where each stream pays you">
              <p className="ps-caption ps-bound-intro">
                PAID TO · BOUND ON A PUBLIC STREAM, FIXED AT CREATION ON A NAMED ONE · EACH LIVES ON
                THAT STREAM&rsquo;S CONTRACT AND CANNOT BE CHANGED
              </p>
              {[...byPayee.entries()].map(([key, list]) => (
                <div className="ps-bound-row" role="row" key={key}>
                  <span role="cell">
                    <AddressChip address={list[0].payee as string} />
                  </span>
                  <span role="cell" className="ps-bound-streams">
                    {list.map((p) => (
                      <a
                        key={`${p.address}:${p.earnerId ?? 'named'}`}
                        href={`#${p.address}`}
                        className="ps-chip"
                        title={`${p.kind === 'public' ? 'bound' : 'fixed'} · ${p.repo}`}
                      >
                        {truncate(p.address)}
                        <span className="ps-bound-kind" aria-hidden>
                          {p.kind === 'public' ? '◆' : '○'}
                        </span>
                      </a>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="ps-earner-total">
            <Amount raw={owed} size="xl" />
            <p className="ps-label">
              READY TO WITHDRAW · ACROSS {positions.length} STREAM{positions.length === 1 ? '' : 'S'}
              {stillReading && ' · STILL READING'}
            </p>
          </div>
          {positions.map((p) => (
            <EarningsStream key={`${p.address}:${p.earnerId ?? 'named'}`} position={p} login={login} />
          ))}

          {/* Only renders when this device holds a passkey wallet. It is the
              way out of an account that can otherwise only be driven here. */}
          <PasskeySweep />
        </>
      )}
    </>
  );
}
