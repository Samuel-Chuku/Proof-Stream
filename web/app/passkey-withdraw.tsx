'use client';

import { createBundlerClient } from 'viem/account-abstraction';
import { useEffect, useState } from 'react';
import { arcTestnet, EXPLORER } from '../lib/chain';
import { recallCredential, smartAccountFor } from '../lib/passkey';
import type { Stream } from '../lib/stream';
import { Amount } from './amount';

const WORK_STREAM_ABI = [
  {
    type: 'function',
    name: 'withdraw',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
] as const;

/// Withdraw from a passkey wallet, without a browser wallet anywhere.
///
/// This is the whole point of the passkey path. The contract's `withdraw` is a
/// call to an existing address, which is exactly what an ERC-4337 user
/// operation can do — and Circle's paymaster sponsors the gas, so a contributor
/// who has never held a token can still collect what they earned. On Arc gas is
/// USDC, so without sponsorship the first withdrawal would need USDC to fetch
/// USDC.
///
/// Rendered only when the passkey account IS this stream's contributor. Anyone
/// else pressing it would spend a signature on a guaranteed `NotContributor`.
export function PasskeyWithdraw({ stream }: { stream: Stream }) {
  const [address, setAddress] = useState<`0x${string}` | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  useEffect(() => {
    const credential = recallCredential();
    if (!credential) return;
    smartAccountFor(credential)
      .then(({ account }) => setAddress(account.address))
      .catch(() => setAddress(null));
  }, []);

  const withdrawable = BigInt(stream.withdrawable);
  const isContributor = address?.toLowerCase() === stream.contributor.toLowerCase();

  // Silent unless this passkey is the one that gets paid. A contributor using a
  // browser wallet has their own button; showing both would be two routes to
  // the same money with no way to tell which applies.
  if (!address || !isContributor) return null;

  async function withdraw() {
    setBusy(true);
    setError(null);
    try {
      const credential = recallCredential();
      if (!credential) throw new Error('Passkey not found on this device.');

      const { account, modularTransport } = await smartAccountFor(credential);
      const bundler = createBundlerClient({
        account,
        chain: arcTestnet,
        transport: modularTransport,
      });

      const hash = await bundler.sendUserOperation({
        account,
        calls: [
          {
            to: stream.address as `0x${string}`,
            abi: WORK_STREAM_ABI,
            functionName: 'withdraw',
            args: [stream.payee as `0x${string}`, withdrawable],
          },
        ],
      });

      // A user operation hash is not a transaction hash. Waiting for the
      // receipt is what turns it into one, and it is the receipt that carries
      // the transaction a judge can open on the explorer.
      const receipt = await bundler.waitForUserOperationReceipt({ hash });
      setSent(receipt.receipt.transactionHash);
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message.split('\n')[0] : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ps-passkey">
      <p className="ps-label">PASSKEY WALLET — THIS STREAM PAYS YOU</p>
      <button
        type="button"
        className="ps-button ps-button-primary"
        disabled={busy || withdrawable === 0n}
        onClick={withdraw}
      >
        [ {busy ? 'WITHDRAWING…' : 'WITHDRAW WITH PASSKEY'} ]
      </button>

      <p className="ps-caption">
        {withdrawable > 0n ? (
          <>
            <Amount raw={Number(withdrawable)} size="s" /> READY · GAS IS SPONSORED, SO YOU DO NOT
            NEED A BALANCE TO COLLECT
          </>
        ) : (
          'NOTHING TO WITHDRAW YET — THE AGENT CERTIFIES WORK BEFORE ANYTHING IS OWED'
        )}
      </p>

      {error && <p className="ps-caption">{error}</p>}
      {sent && (
        <p className="ps-caption">
          SENT ·{' '}
          <a href={`${EXPLORER}/tx/${sent}`} target="_blank" rel="noreferrer">
            {sent.slice(0, 10)}…{sent.slice(-6)} ↗
          </a>
        </p>
      )}
    </div>
  );
}
