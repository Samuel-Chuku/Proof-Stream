'use client';

import { useEffect, useState } from 'react';
import { useAccount, useConfig, useWriteContract } from 'wagmi';
import { waitForTransactionReceipt } from 'wagmi/actions';
import { createBundlerClient } from 'viem/account-abstraction';
import { AddressChip } from './address-chip';
import { Amount } from './amount';
import { Connect } from './connect';
import { arcTestnet, EXPLORER } from '../lib/chain';
import type { Position } from '../lib/earnings';
import {
  authenticatePasskey,
  forgetCredential,
  passkeysConfigured,
  recallCredential,
  smartAccountFor,
} from '../lib/passkey';
import { withdrawableNow } from '../lib/withdraw-cap';

/// The three functions a contributor ever calls, hand-written like
/// stream-actions.tsx so the client bundle does not carry the generated ABI.
/// `withdraw` is the named stream's; the other two are the public stream's.
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
  {
    type: 'function',
    name: 'bindPayee',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'earnerId', type: 'bytes32' },
      { name: 'payee_', type: 'address' },
      { name: 'deadline', type: 'uint256' },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'withdrawFor',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'm', type: 'uint256' },
      { name: 'earnerId', type: 'bytes32' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
] as const;

type Call =
  | { functionName: 'withdraw'; args: readonly [`0x${string}`, bigint] }
  | { functionName: 'bindPayee'; args: readonly [`0x${string}`, `0x${string}`, bigint, `0x${string}`] }
  | { functionName: 'withdrawFor'; args: readonly [bigint, `0x${string}`, bigint] };

/// Not every failure is a failed transaction. The contract's own refusals are
/// named here in the interface's voice; everything else is passed through.
function explain(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/User rejected|User denied|rejected the request/i.test(message)) {
    return 'You declined the signature in your wallet. Nothing was sent.';
  }
  if (/NotAllowedError|cancel|abort/i.test(message)) {
    return 'The passkey prompt was dismissed. Nothing was sent.';
  }
  if (/AlreadyBound/.test(message)) return 'This account already chose where to be paid. Reload to see it.';
  if (/StaleBinding/.test(message)) return 'The authorisation expired before it was sent. Choose again to get a fresh one.';
  if (/NotPayee/.test(message)) return 'The wallet sending the transaction must be the one being paid.';
  if (/NotContributor/.test(message)) return 'Only the contributor address this stream was created with can withdraw.';
  if (/OverClaimCap|DailyClaimCapExceeded|ExceedsWithdrawable/.test(message)) {
    return 'The stream refused that amount. Reload: the ceilings have moved since this page was read.';
  }
  if (/insufficient funds/i.test(message)) {
    return 'Not enough USDC to cover gas. On Arc gas is USDC; a passkey wallet has it sponsored.';
  }
  return message.split('\n')[0];
}

/// Withdraw, and on a public stream, first choose where to.
///
/// A named stream fixed the payee at deploy and only its contributor may call
/// `withdraw`. A public stream lets each earner bind a payee once, and only
/// that payee may call `withdrawFor`. Either way the contract names ONE
/// address that has to send, and this component sends through whichever
/// wallet that is: a browser wallet through the nav's CONNECT, or a passkey
/// smart account whose gas is sponsored. A withdrawal is never attempted from
/// an address the contract will refuse.
///
/// NEVER an approval. Every call here is to the stream's own contract, and its
/// address is on the page above before any is offered.
export function EarnerActions({ position: p, login }: { position: Position; login: string | null }) {
  const stream = p;
  const earnerId = (p.earnerId ?? `0x${'0'.repeat(64)}`) as `0x${string}`;
  const name = login ?? 'you';
  const { address: browserAddress, isConnected, chainId } = useAccount();
  const config = useConfig();
  const { writeContractAsync } = useWriteContract();

  const [passkeyAddress, setPasskeyAddress] = useState<`0x${string}` | null>(null);
  const [passkeyName, setPasskeyName] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ what: string; hash: string } | null>(null);
  // Which address the earner is about to make permanent. Chosen, then
  // confirmed on a second press: a one-click permanent binding is the wrong
  // shape for something that cannot be undone.
  const [chosen, setChosen] = useState<`0x${string}` | null>(null);
  const [now, setNow] = useState<number | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setNow(Math.floor(Date.now() / 1000));
    const credential = recallCredential();
    if (!credential) return;
    smartAccountFor(credential)
      .then(({ account }) => setPasskeyAddress(account.address))
      .catch(() => forgetCredential());
  }, []);

  const onArc = !isConnected || chainId === arcTestnet.id;
  const streamAddress = stream.address as `0x${string}`;
  const payee = stream.payee;
  // Who the contract requires as sender: the payee on a public stream, the
  // contributor on a named one (whose payee may be a different, allowlisted
  // address that never sends anything).
  const sender = p.kind === 'named' ? p.contributor : payee;
  const browserIsSender = !!sender && browserAddress?.toLowerCase() === sender.toLowerCase();
  const passkeyIsSender = !!sender && passkeyAddress?.toLowerCase() === sender.toLowerCase();

  /// Send one call as whichever wallet holds `from`. A passkey account goes
  /// through the bundler as a user operation; the receipt it returns carries
  /// the real transaction hash, which is what the explorer link needs.
  async function send(from: `0x${string}`, call: Call): Promise<string> {
    if (passkeyAddress && from.toLowerCase() === passkeyAddress.toLowerCase()) {
      const credential = recallCredential();
      if (!credential) throw new Error('Passkey not found on this device.');
      const { account, modularTransport } = await smartAccountFor(credential);
      const bundler = createBundlerClient({ account, chain: arcTestnet, transport: modularTransport });
      const hash = await bundler.sendUserOperation({
        account,
        calls: [{ to: streamAddress, abi: WORK_STREAM_ABI, functionName: call.functionName, args: call.args }],
      });
      const receipt = await bundler.waitForUserOperationReceipt({ hash });
      return receipt.receipt.transactionHash;
    }
    // `from` is the connected browser wallet here; wagmi signs as it.
    const hash = await writeContractAsync({
      address: streamAddress,
      abi: WORK_STREAM_ABI,
      functionName: call.functionName,
      args: call.args,
    } as Parameters<typeof writeContractAsync>[0]);
    await waitForTransactionReceipt(config, { hash });
    return hash;
  }

  async function bind(to: `0x${string}`) {
    setBusy('bind');
    setError(null);
    try {
      // The agent's authorisation names this exact address. Anyone who
      // intercepts it gets a signature for OUR address, which the contract
      // only accepts from OUR address.
      const res = await fetch('/api/earnings/bind', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ stream: stream.address, payee: to }),
      });
      const body = (await res.json()) as { error?: string; deadline?: string; signature?: `0x${string}` };
      if (!res.ok || !body.signature || !body.deadline) throw new Error(body.error ?? `the agent answered ${res.status}`);

      const hash = await send(to, {
        functionName: 'bindPayee',
        args: [earnerId, to, BigInt(body.deadline), body.signature],
      });
      setSent({ what: 'BOUND', hash });
      setChosen(null);
      // A fresh query string, so the server re-reads the chain rather than
      // serving the cached position from before this transaction.
      window.location.assign(`/earnings?fresh=${Date.now()}#${stream.address}`);
    } catch (err) {
      setError(explain(err));
    } finally {
      setBusy(null);
    }
  }

  async function withdraw(milestoneIndex: number, amount: bigint) {
    if (!sender || !payee) return;
    setBusy(`withdraw:${milestoneIndex}`);
    setError(null);
    try {
      const hash = await send(
        sender,
        p.kind === 'named'
          ? { functionName: 'withdraw', args: [payee, amount] }
          : { functionName: 'withdrawFor', args: [BigInt(milestoneIndex), earnerId, amount] },
      );
      setSent({ what: 'WITHDRAWN', hash });
      // A fresh query string, so the server re-reads the chain rather than
      // serving the cached position from before this transaction.
      window.location.assign(`/earnings?fresh=${Date.now()}#${stream.address}`);
    } catch (err) {
      setError(explain(err));
    } finally {
      setBusy(null);
    }
  }

  async function passkey(mode: 'register' | 'login') {
    setBusy(mode);
    setError(null);
    try {
      const credential = await authenticatePasskey(mode, passkeyName.trim() || `proofstream ${name}`);
      const { account } = await smartAccountFor(credential);
      setPasskeyAddress(account.address);
      setChosen(account.address);
    } catch (err) {
      setError(explain(err));
    } finally {
      setBusy(null);
    }
  }

  if (!mounted) return null;

  const feedback = (
    <>
      {error && (
        <p className="ps-caption" role="alert">
          {error}
        </p>
      )}
      {sent && (
        <p className="ps-caption">
          {sent.what} ·{' '}
          <a href={`${EXPLORER}/tx/${sent.hash}`} target="_blank" rel="noreferrer">
            {sent.hash.slice(0, 10)}…{sent.hash.slice(-6)} ↗
          </a>
        </p>
      )}
    </>
  );

  // ---------------------------------------------------------------- bind
  if (p.kind === 'public' && !payee) {
    return (
      <div className="ps-earner-actions">
        <p className="ps-label">WHERE SHOULD THIS STREAM PAY YOU?</p>
        <p className="ps-body">
          Chosen once, for this stream, and never changed. The address you pick must send the
          transaction itself, so a typo cannot be bound. This moves no money and grants no approval.
        </p>

        {chosen ? (
          <div className="ps-earner-confirm">
            <p className="ps-label">
              BIND <AddressChip address={chosen} /> AS THE ONLY ADDRESS THIS STREAM WILL EVER PAY{' '}
              <b>{name.toUpperCase()}</b>
            </p>
            <p className="ps-caption">
              YOUR WALLET WILL BE ASKED TO SEND <code>bindPayee</code> TO{' '}
              <AddressChip address={stream.address} href={`${EXPLORER}/address/${stream.address}`} /> ·
              NOTHING ELSE
            </p>
            <div className="ps-earner-buttons">
              <button
                type="button"
                className="ps-button"
                disabled={busy !== null || !onArc}
                onClick={() => bind(chosen)}
              >
                [ {busy === 'bind' ? 'BINDING…' : 'CONFIRM, THIS IS PERMANENT'} ]
              </button>
              <button type="button" className="ps-button" disabled={busy !== null} onClick={() => setChosen(null)}>
                [ CHOOSE ANOTHER ]
              </button>
            </div>
            {!onArc && <p className="ps-caption">SWITCH YOUR WALLET TO ARC TESTNET FIRST</p>}
            {feedback}
          </div>
        ) : (
          <>
            <div className="ps-earner-options">
              <div className="ps-earner-option">
                <p className="ps-label">A BROWSER WALLET</p>
                {isConnected && browserAddress ? (
                  <>
                    <AddressChip address={browserAddress} />
                    <button
                      type="button"
                      className="ps-button"
                      disabled={busy !== null}
                      onClick={() => setChosen(browserAddress)}
                    >
                      [ PAY ME HERE ]
                    </button>
                  </>
                ) : (
                  <Connect />
                )}
              </div>

              <div className="ps-earner-option">
                <p className="ps-label">A PASSKEY WALLET</p>
                {!passkeysConfigured ? (
                  <p className="ps-caption">NOT CONFIGURED ON THIS DEPLOYMENT</p>
                ) : passkeyAddress ? (
                  <>
                    <AddressChip address={passkeyAddress} />
                    <button
                      type="button"
                      className="ps-button"
                      disabled={busy !== null}
                      onClick={() => setChosen(passkeyAddress)}
                    >
                      [ PAY ME HERE ]
                    </button>
                  </>
                ) : (
                  <>
                    <p className="ps-caption">
                      NO WALLET? YOUR DEVICE&rsquo;S FINGERPRINT OR FACE UNLOCK BECOMES ONE. GAS IS
                      SPONSORED, SO YOU CAN COLLECT WITHOUT HOLDING A TOKEN FIRST.
                    </p>
                    <input
                      className="ps-input"
                      value={passkeyName}
                      placeholder={`[ e.g. proofstream ${name} ]`}
                      aria-label="A name your device will show you later"
                      onChange={(e) => setPasskeyName(e.target.value)}
                    />
                    <div className="ps-earner-buttons">
                      <button type="button" className="ps-button" disabled={busy !== null} onClick={() => passkey('register')}>
                        [ {busy === 'register' ? 'CREATING…' : 'CREATE'} ]
                      </button>
                      <button type="button" className="ps-button" disabled={busy !== null} onClick={() => passkey('login')}>
                        [ {busy === 'login' ? 'OPENING…' : 'I HAVE ONE'} ]
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
            {feedback}
          </>
        )}
      </div>
    );
  }

  // ------------------------------------------------------------ withdraw
  if (!payee || !sender) return null;
  const owed = stream.earnings.filter((e) => BigInt(e.withdrawable) > 0n);
  const canSend = browserIsSender || passkeyIsSender;
  const payeeIsSender = payee.toLowerCase() === sender.toLowerCase();

  return (
    <div className="ps-earner-actions">
      <p className="ps-label">
        PAID TO <AddressChip address={payee} href={`${EXPLORER}/address/${payee}`} />
        {!payeeIsSender && (
          <>
            {' '}
            · SENT BY <AddressChip address={sender} />
          </>
        )}
        {passkeyIsSender && ' · YOUR PASSKEY WALLET, GAS SPONSORED'}
        {browserIsSender && ' · CONNECTED'}
      </p>

      {owed.length === 0 ? (
        <p className="ps-caption">
          {stream.state === 'ended' || stream.state === 'settled'
            ? stream.earnings.some((e) => BigInt(e.paid) > 0n)
              ? 'PAID OUT. EVERYTHING THIS STREAM RELEASED TO YOU HAS BEEN WITHDRAWN.'
              : 'THIS STREAM HAS ENDED WITHOUT RELEASING ANYTHING TO YOU.'
            : 'NOTHING TO WITHDRAW RIGHT NOW. THE CLOCK RELEASES YOUR SHARE AS THE MILESTONE RUNS.'}
        </p>
      ) : !canSend ? (
        <p className="ps-caption">
          TO WITHDRAW, CONNECT <AddressChip address={sender} />{' '}
          {passkeysConfigured && 'OR SIGN IN WITH THE PASSKEY THAT HOLDS IT'} · THE CONTRACT ONLY PAYS
          WHEN THAT ADDRESS SENDS
        </p>
      ) : (
        owed.map((e) => {
          // A named stream has no payout ceilings: the whole balance goes.
          const cap =
            p.kind === 'named'
              ? { amount: BigInt(e.withdrawable), boundBy: 'share' as const }
              : withdrawableNow({
                  withdrawable: BigInt(e.withdrawable),
                  claimCap: BigInt(stream.claimCap),
                  dailyClaimCap: BigInt(stream.dailyClaimCap),
                  claimedToday: BigInt(stream.claimedToday),
                  claimDayBucket: BigInt(stream.claimDayBucket),
                  now: now ?? Math.floor(Date.now() / 1000),
                });
          const key = `withdraw:${e.milestoneIndex}`;
          return (
            <div className="ps-earner-withdraw" key={e.milestoneIndex}>
              <button
                type="button"
                className="ps-button ps-button-primary"
                disabled={busy !== null || cap.amount === 0n || !onArc}
                onClick={() => withdraw(e.milestoneIndex, cap.amount)}
              >
                [{' '}
                {busy === key ? (
                  'WITHDRAWING…'
                ) : (
                  <>
                    WITHDRAW <Amount raw={cap.amount} size="s" />
                    {p.kind === 'public' && <> · MILESTONE {e.milestoneIndex}</>}
                  </>
                )}{' '}
                ]
              </button>
              <span className="ps-caption">
                {cap.boundBy === 'share' && (p.kind === 'named' ? 'EVERYTHING RELEASED AND NOT YET TAKEN' : 'YOUR WHOLE RELEASED SHARE')}
                {cap.boundBy === 'call' && 'THE PER-WITHDRAWAL CEILING · WITHDRAW AGAIN FOR THE REST'}
                {cap.boundBy === 'day' &&
                  (cap.amount === 0n
                    ? "TODAY'S CEILING ON THIS STREAM IS SPENT · TRY AGAIN AFTER 00:00 UTC"
                    : "WHAT IS LEFT OF TODAY'S CEILING · THE REST TOMORROW")}
              </span>
            </div>
          );
        })
      )}
      {!onArc && <p className="ps-caption">SWITCH YOUR WALLET TO ARC TESTNET FIRST</p>}
      {feedback}
    </div>
  );
}
