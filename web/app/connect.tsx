'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAccount, useConnect, useDisconnect, useSwitchChain } from 'wagmi';
import { AddressChip } from './address-chip';
import { UsdcBalance } from './usdc-balance';
import { passkeysConfigured } from '../lib/passkey';
import { arcTestnet } from '../lib/chain';
import { truncate } from './address-chip';

/// A conventional connect button and modal, built by hand.
///
/// The design system bans component libraries because their defaults are
/// rounded, blurred and animated — but it never banned a modal, and a row of
/// raw connector buttons is not what anyone expects a dapp to do. So this is
/// the familiar pattern rendered in the system's own language: hard shadow,
/// radius 0, no blur, no spring.
export function Connect() {
  const { address, isConnected, chainId } = useAccount();
  const { connectors, connect, isPending, error } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');

  // The server cannot know which wallets exist, and the connector list differs
  // between server and client — WalletConnect is browser-only. Rendering
  // nothing until mounted avoids both a hydration mismatch and a flash of
  // "no wallet detected" before extensions are found.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // wagmi discovers wallets through EIP-6963, where each one announces itself
  // with a name and an icon. The explicit `injected()` connector in wagmi.ts is
  // a FALLBACK for wallets too old to announce — but it also appears alongside
  // them, as a second, generic entry for whichever wallet happened to win
  // `window.ethereum`. Someone with a dozen wallets installed saw duplicates and
  // could not find the one they actually use.
  //
  // So: drop the generic entry whenever a wallet has announced itself properly,
  // and fold away any remaining same-name duplicates, preferring the one that
  // brought an icon.
  const wallets = useMemo(() => {
    const announced = connectors.filter((c) => c.id !== 'injected');
    const list = announced.length > 0 ? announced : connectors;

    const byName = new Map<string, (typeof connectors)[number]>();
    for (const c of list) {
      const key = c.name.trim().toLowerCase();
      const existing = byName.get(key);
      if (!existing || (!existing.icon && c.icon)) byName.set(key, c);
    }

    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [connectors]);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? wallets.filter((c) => c.name.toLowerCase().includes(q)) : wallets;
  }, [wallets, filter]);

  // Close on Escape, like every modal a user has ever met.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!mounted) return <span className="ps-caption">…</span>;

  if (isConnected && chainId !== arcTestnet.id) {
    return (
      <button type="button" className="ps-button" onClick={() => switchChain({ chainId: arcTestnet.id })}>
        [ ⚠ SWITCH TO ARC TESTNET ]
      </button>
    );
  }

  if (isConnected && address) {
    return (
      // One bordered cluster, not four loose controls. Chain, address, balance
      // and disconnect all describe the SAME wallet, and side by side with
      // nothing binding them the disconnect button read as unrelated chrome —
      // it was not obvious what it would disconnect.
      <>
        {/* One bordered cluster: chain, address and balance are three facts
            about the SAME wallet. Disconnect is NOT here — it is a rare,
            destructive-feeling action that was taking more nav width than the
            three things people actually read, and pushed the links onto a
            second line. It lives one click away, behind the chevron. */}
        <span className="ps-wallet">
          {/* Two files, one shown at a time. The Arc marks are solid black and
              solid white, so a single asset is invisible in one palette — the
              white one vanished on the light theme. Swapped in CSS rather than
              in React so it follows the theme instantly, with no flash and no
              client state. */}
          <img
            src="/arc-mark-on-light.svg"
            alt="Arc Testnet"
            title="Arc Testnet · chain 5042002"
            width={16}
            height={16}
            className="ps-wallet-chain-mark ps-on-light"
          />
          <img
            src="/arc-mark-on-dark.svg"
            alt=""
            aria-hidden
            width={16}
            height={16}
            className="ps-wallet-chain-mark ps-on-dark"
          />

          <span className="ps-wallet-divider" aria-hidden />

          {/* Click to copy. The same chip the rest of the app uses for every
              address, so the interaction is learned once. */}
          <AddressChip address={address} />

          <UsdcBalance />

          <button
            type="button"
            className="ps-wallet-more"
            onClick={() => setOpen(true)}
            aria-label="Wallet details"
            aria-haspopup="dialog"
          >
            ▾
          </button>
        </span>

        {open && (
          <div className="ps-modal-backdrop" onClick={() => setOpen(false)} role="presentation">
            <div
              className="ps-modal"
              role="dialog"
              aria-modal="true"
              aria-label="Wallet"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="ps-modal-head">
                <h2 className="ps-label">WALLET</h2>
                <button type="button" className="ps-chip" onClick={() => setOpen(false)} aria-label="Close">
                  ×
                </button>
              </div>

              <div className="ps-modal-body">
                {/* The full address, not the truncation — this is the one place
                    someone checks they connected the account they meant to. */}
                <p className="ps-wallet-full">{address}</p>
                <p className="ps-caption">ARC TESTNET · CHAIN 5042002</p>

                <button
                  type="button"
                  className="ps-button ps-modal-option"
                  onClick={() => {
                    disconnect();
                    setOpen(false);
                  }}
                >
                  [ DISCONNECT ]
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <button type="button" className="ps-button" onClick={() => setOpen(true)}>
        [ CONNECT WALLET ]
      </button>

      {open && (
        <div
          className="ps-modal-backdrop"
          onClick={() => setOpen(false)}
          role="presentation"
        >
          <div
            className="ps-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Connect a wallet"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="ps-modal-head">
              <h2 className="ps-label">CONNECT A WALLET</h2>
              <button type="button" className="ps-chip" onClick={() => setOpen(false)} aria-label="Close">
                ×
              </button>
            </div>

            <div className="ps-modal-body">
              {wallets.length === 0 && (
                <p className="ps-body">
                  No wallet detected. Install a browser wallet, then reload this page.
                </p>
              )}

              {/* A filter, not a scroll. Someone with a dozen wallets installed
                  was hunting for Rabby in a list of everything they own,
                  including chains this app does not use. */}
              {wallets.length > 5 && (
                <input
                  className="ps-input"
                  value={filter}
                  placeholder="[ TYPE TO FIND YOUR WALLET ]"
                  onChange={(e) => setFilter(e.target.value)}
                  aria-label="Filter wallets"
                />
              )}

              {shown.map((connector) => (
                <button
                  key={connector.uid}
                  type="button"
                  className="ps-button ps-modal-option"
                  disabled={isPending}
                  onClick={() => {
                    connect({ connector });
                    setOpen(false);
                  }}
                >
                  {/* The icon is why this is findable. EIP-6963 wallets announce
                      their own, and people recognise Rabby's mark far faster
                      than they read a name in a list. */}
                  {connector.icon && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={connector.icon} alt="" width={16} height={16} aria-hidden />
                  )}
                  [ {connector.name.toUpperCase()} ]
                </button>
              ))}

              {shown.length === 0 && wallets.length > 0 && (
                <p className="ps-caption">NO WALLET MATCHES “{filter.toUpperCase()}”</p>
              )}

              {error && <p className="ps-caption">{error.message}</p>}

              {/* The one route for someone who has no wallet at all. This modal
                  is exactly where they look, and it previously offered only a
                  list of things they do not have. Contributors only — a passkey
                  account cannot deploy, so it cannot create a stream. */}
              {passkeysConfigured && (
                <p className="ps-caption ps-modal-note">
                  NO WALLET AT ALL? <a href="/#passkey">CREATE A PASSKEY WALLET →</a> — FOR
                  CONTRIBUTORS BEING PAID, NOT FOR CREATING STREAMS
                </p>
              )}

              <p className="ps-caption ps-modal-note">
                ARC TESTNET · CHAIN 5042002 · YOUR WALLET WILL OFFER TO ADD IT
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
