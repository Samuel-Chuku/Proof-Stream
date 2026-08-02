'use client';

import { useState } from 'react';

/// Six leading, five trailing, a real `…`. Chips are the one place radius
/// exists in this system.
export function truncate(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-5)}`;
}

export function AddressChip({ address, href }: { address: string; href?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1000);
    } catch {
      // Clipboard is permission-gated and can simply refuse. The address is
      // still on screen and still selectable, so there is nothing to report.
    }
  }

  return (
    <span className="ps-chip-group">
      <button
        type="button"
        onClick={copy}
        className={`ps-chip${copied ? ' ps-chip-copied' : ''}`}
        title={address}
        aria-label={`Copy ${address}`}
      >
        {truncate(address)}
        <span aria-hidden>{copied ? '✓' : '⧉'}</span>
      </button>
      {href && (
        <a href={href} target="_blank" rel="noreferrer" className="ps-chip-link" aria-label="View on explorer">
          ↗
        </a>
      )}
    </span>
  );
}
