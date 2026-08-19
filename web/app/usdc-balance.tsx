'use client';

import { erc20Abi } from 'viem';
import { useAccount, useReadContract } from 'wagmi';
import { USDC } from '../lib/chain';

/// The connected wallet's USDC balance, in the nav, on every page.
///
/// On Arc, USDC is also the gas token — so this is not a nicety. It is the
/// number that decides whether the next action succeeds, and a user who cannot
/// see it discovers the answer from a failed transaction instead.
///
/// Polled rather than pushed: Arc has no reliable log for a plain balance
/// change, and a wallet's balance moves for reasons this app never sees (a
/// faucet, a transfer from elsewhere). Ten seconds is frequent enough to feel
/// live and far below the RPC's rate limit for one read.
///
/// `refetchOnWindowFocus` covers the case polling cannot: a user who signs a
/// transaction in a wallet popup and comes back expects the new number
/// immediately, not up to ten seconds later. Actions in this app reload the
/// page after a receipt, which refetches anyway.
export function UsdcBalance() {
  const { address, isConnected } = useAccount();

  const { data, isLoading } = useReadContract({
    address: USDC,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: {
      enabled: Boolean(address),
      refetchInterval: 10_000,
      refetchOnWindowFocus: true,
      // Keeps the last figure on screen while a refetch is in flight, so the
      // number does not blink to a placeholder every ten seconds.
      placeholderData: (prev) => prev,
    },
  });

  if (!isConnected || !address) return null;

  return (
    <span className="ps-wallet-balance" title="USDC balance — also the gas token on Arc">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/usdc.svg" alt="" width={14} height={14} aria-hidden />
      <span className="ps-wallet-figure">
        {data === undefined ? (isLoading ? '…' : '—') : format(data as bigint)}
      </span>
    </span>
  );
}

/// Two decimal places, truncated rather than rounded. A balance shown as more
/// than you hold is the one direction that costs someone a failed transaction,
/// and rounding 1.999 up to 2.00 does exactly that.
function format(raw: bigint): string {
  const whole = raw / 1_000_000n;
  const hundredths = (raw % 1_000_000n) / 10_000n;
  return `${whole.toLocaleString('en-US')}.${hundredths.toString().padStart(2, '0')}`;
}
