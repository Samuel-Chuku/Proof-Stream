'use client';

import { useEffect, useState } from 'react';
import { useAccount, useConnect, useDisconnect, useSwitchChain } from 'wagmi';
import { arcTestnet } from '../lib/chain';
import { truncate } from './address-chip';

/// Wallet connect, built on wagmi connectors so it obeys the design system:
/// hard shadows, radius 0, no modal, no animation.
///
/// The wrong-network state is not an edge case here — every transaction this
/// app sends is on Arc Testnet, and a wallet defaulting to mainnet would fail
/// at signing time with a message the user cannot act on.
export function Connect() {
  const { address, isConnected, chainId } = useAccount();
  const { connectors, connect, isPending, error } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();

  // The server cannot know which wallets exist, and the connector list differs
  // between server and client — WalletConnect is browser-only. Rendering
  // nothing until mounted avoids both a hydration mismatch and a flash of
  // "no wallet detected" before extensions are detected.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <p className="ps-caption">…</p>;

  if (isConnected && chainId !== arcTestnet.id) {
    return (
      <div className="ps-invert">
        <p className="ps-label" style={{ marginBottom: 'var(--ps-2)' }}>
          ⚠ WRONG NETWORK
        </p>
        <p className="ps-body" style={{ margin: '0 0 var(--ps-3)' }}>
          This wallet is on chain {chainId}. ProofStream runs on Arc Testnet, chain{' '}
          {arcTestnet.id}.
        </p>
        <button type="button" className="ps-button" onClick={() => switchChain({ chainId: arcTestnet.id })}>
          [ SWITCH NETWORK ]
        </button>
      </div>
    );
  }

  if (isConnected && address) {
    return (
      <div className="ps-connect-row">
        <span className="ps-label">CONNECTED {truncate(address)}</span>
        <button type="button" className="ps-button" onClick={() => disconnect()}>
          [ DISCONNECT ]
        </button>
      </div>
    );
  }

  return (
    <div className="ps-connect-row">
      {connectors.map((connector) => (
        <button
          key={connector.uid}
          type="button"
          className="ps-button"
          disabled={isPending}
          onClick={() => connect({ connector })}
        >
          [ {connector.name.toUpperCase()} ]
        </button>
      ))}
      {connectors.length === 0 && (
        <p className="ps-caption">NO WALLET DETECTED — INSTALL A BROWSER WALLET TO CONTINUE</p>
      )}
      {error && <p className="ps-caption">{error.message}</p>}
    </div>
  );
}
