'use client';

import { useEffect, useState } from 'react';
import { useAccount, useConnect, useDisconnect, useSwitchChain } from 'wagmi';
import { AddressChip } from './address-chip';
import { UsdcBalance } from './usdc-balance';
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

  // The server cannot know which wallets exist, and the connector list differs
  // between server and client — WalletConnect is browser-only. Rendering
  // nothing until mounted avoids both a hydration mismatch and a flash of
  // "no wallet detected" before extensions are found.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

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
          <img
            src="/arc-mark.svg"
            alt="Arc Testnet"
            title="Arc Testnet · chain 5042002"
            width={16}
            height={16}
            className="ps-wallet-chain-mark"
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
              {connectors.length === 0 && (
                <p className="ps-body">
                  No wallet detected. Install a browser wallet, then reload this page.
                </p>
              )}

              {connectors.map((connector) => (
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
                  [ {connector.name.toUpperCase()} ]
                </button>
              ))}

              {error && <p className="ps-caption">{error.message}</p>}

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
