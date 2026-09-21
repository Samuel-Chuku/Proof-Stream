'use client';

import { useEffect, useState } from 'react';
import { erc20Abi, isAddress } from 'viem';
import { createBundlerClient } from 'viem/account-abstraction';
import { useReadContract } from 'wagmi';
import { AddressChip } from './address-chip';
import { Amount } from './amount';
import { arcTestnet, EXPLORER, USDC } from '../lib/chain';
import { recallCredential, smartAccountFor } from '../lib/passkey';

/// MOVE MONEY OUT OF A PASSKEY WALLET.
///
/// THE PROBLEM THIS EXISTS TO SOLVE. A passkey wallet is a smart account whose
/// owner is a WebAuthn credential scoped to THIS SITE's domain. That is what
/// makes it a good way to be paid with no wallet, and it is also a trap: the
/// account can only be driven from here, with that device's passkey. There is
/// no seed phrase to import elsewhere and no way to export the key, because the
/// key never leaves the device's secure enclave. Money paid into it and left
/// there depends on this site continuing to exist.
///
/// So the account needs an exit, and this is it: a plain ERC-20 transfer to any
/// address the earner names: an exchange, a browser wallet, a friend. Gas is
/// sponsored, so it costs them nothing and needs no balance first.
///
/// NOT GREEN. This moves USDC that has already been released and withdrawn; the
/// green belongs to the withdrawal that released it.
export function PasskeySweep() {
  const [address, setAddress] = useState<`0x${string}` | null>(null);
  const [to, setTo] = useState('');
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

  const { data: balance, refetch } = useReadContract({
    address: USDC,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address), refetchInterval: 15_000, placeholderData: (prev) => prev },
  });

  // Silent until there is a passkey wallet on this device. Somebody using a
  // browser wallet has no use for any of this.
  if (!address) return null;

  const held = (balance as bigint | undefined) ?? 0n;
  const destination = to.trim();
  const valid = isAddress(destination) && !/^0x0{40}$/i.test(destination);

  async function move() {
    setBusy(true);
    setError(null);
    try {
      const credential = recallCredential();
      if (!credential) throw new Error('Passkey not found on this device.');
      const { account, modularTransport } = await smartAccountFor(credential);
      const bundler = createBundlerClient({ account, chain: arcTestnet, transport: modularTransport });

      const hash = await bundler.sendUserOperation({
        account,
        calls: [
          {
            to: USDC,
            abi: erc20Abi,
            functionName: 'transfer',
            args: [destination as `0x${string}`, held],
          },
        ],
        // Sponsored, so moving the money out never needs the money for gas.
        paymaster: true,
      });
      // A user operation hash is not a transaction hash; the receipt is what
      // carries the one an explorer can open.
      const receipt = await bundler.waitForUserOperationReceipt({ hash });
      setSent(receipt.receipt.transactionHash);
      setTo('');
      refetch();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(
        /NotAllowedError|cancel|abort/i.test(message)
          ? 'The passkey prompt was dismissed. Nothing was sent.'
          : message.split('\n')[0],
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="ps-earner-actions">
      <p className="ps-label">
        YOUR PASSKEY WALLET <AddressChip address={address} href={`${EXPLORER}/address/${address}`} />
      </p>
      <p className="ps-identity-value">
        HOLDS <Amount raw={held} size="m" />
      </p>

      {/* ONE LINE, AND THE REST BEHIND A FOLD. The warning matters and the
          paragraph was not read; a person with money in front of them reads
          the number and the button. */}
      <p className="ps-caption">
        ONLY THIS SITE AND THIS DEVICE CAN SPEND FROM IT. MOVE IT TO A WALLET YOU HOLD.
      </p>

      <div className="ps-repoint-row">
        <input
          className="ps-input"
          value={to}
          placeholder="[ 0x… THE ADDRESS TO SEND IT TO ]"
          aria-label="Destination address"
          onChange={(e) => setTo(e.target.value)}
        />
        <button type="button" className="ps-button" disabled={busy || !valid || held === 0n} onClick={move}>
          [ {busy ? 'SENDING…' : 'MOVE IT ALL OUT'} ]
        </button>
      </div>

      {to.length > 0 && !valid && <p className="ps-caption">THAT IS NOT AN ARC ADDRESS</p>}
      {held === 0n && <p className="ps-caption">NOTHING TO MOVE YET</p>}
      {error && (
        <p className="ps-caption" role="alert">
          {error}
        </p>
      )}
      {sent && (
        <p className="ps-caption">
          SENT ·{' '}
          <a href={`${EXPLORER}/tx/${sent}`} target="_blank" rel="noreferrer">
            {sent.slice(0, 10)}…{sent.slice(-6)} ↗
          </a>
        </p>
      )}
      <details className="ps-never-more">
        <summary className="ps-caption">WHY, AND WHAT TO CHECK ▾</summary>
        <p className="ps-caption">
          A PASSKEY WALLET HAS NO SEED PHRASE: THE KEY NEVER LEAVES THIS DEVICE, SO NO OTHER APP CAN
          DRIVE IT. GAS IS SPONSORED, SO MOVING IT COSTS NOTHING. CHECK THE ADDRESS FIRST: A TRANSFER
          CANNOT BE UNDONE.
        </p>
      </details>
    </section>
  );
}
