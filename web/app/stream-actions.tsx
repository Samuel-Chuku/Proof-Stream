'use client';

import { useEffect, useState } from 'react';
import { useAccount, useConfig, useWriteContract } from 'wagmi';
import { waitForTransactionReceipt } from 'wagmi/actions';
import { ERC20_ABI, USDC } from '../lib/chain';
import type { Stream } from '../lib/stream';
import { Amount } from './amount';
import { Connect } from './connect';

/// Not every failure is a failed transaction, and calling them all one thing
/// sends people hunting for chain problems that do not exist.
///
/// A stale chunk in particular never reaches the wallet: the page simply could
/// not load the code to build the call. Saying "TRANSACTION FAILED" there is
/// actively misleading.
function classify(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);

  if (/Loading chunk|ChunkLoadError|dynamically imported module/i.test(message)) {
    return 'This page is running out-of-date code and could not load part of itself. Nothing was sent to your wallet or to the chain. Reload the page and try again.';
  }
  if (/User rejected|User denied|rejected the request/i.test(message)) {
    return 'You declined the signature in your wallet. Nothing was sent.';
  }
  if (/insufficient funds/i.test(message)) {
    return 'Not enough USDC to cover this transaction and its gas. On Arc, gas is paid in the same USDC.';
  }
  return message.split('\n')[0];
}

const WORK_STREAM_ABI = [
  { type: 'function', name: 'fund', stateMutability: 'nonpayable', inputs: [{ name: 'amount', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'pause', stateMutability: 'nonpayable', inputs: [], outputs: [] },
  { type: 'function', name: 'resume', stateMutability: 'nonpayable', inputs: [], outputs: [] },
  { type: 'function', name: 'closeMilestone', stateMutability: 'nonpayable', inputs: [], outputs: [] },
  { type: 'function', name: 'setRepo', stateMutability: 'nonpayable', inputs: [{ name: 'newRepo', type: 'string' }], outputs: [] },
  {
    type: 'function',
    name: 'raisePolicy',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'newMaxTranche', type: 'uint256' },
      { name: 'newDailyUnlockCap', type: 'uint256' },
    ],
    outputs: [],
  },
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

/// Whole units only. A countdown to a four-hour window does not need seconds,
/// and a figure that changes every second reads as urgent when it is not.
function formatWait(seconds: number): string {
  if (seconds >= 3600) {
    const h = Math.floor(seconds / 3600);
    const m = Math.round((seconds % 3600) / 60);
    return m > 0 ? `${h}H ${m}M` : `${h}H`;
  }
  if (seconds >= 60) return `${Math.ceil(seconds / 60)}M`;
  return 'UNDER A MINUTE';
}

/// What the connected wallet may do with this stream.
///
/// Role comes from the CONTRACT, not from the app: employer, contributor and
/// payee are immutable fields, and every one of these functions reverts for the
/// wrong caller. Hiding a button is a courtesy — the contract is the authority,
/// and showing an action that would revert wastes a signature and teaches
/// nothing.
export function StreamActions({ stream }: { stream: Stream }) {
  const { address, isConnected } = useAccount();
  const config = useConfig();
  const { writeContractAsync } = useWriteContract();

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [newRepo, setNewRepo] = useState('');
  const [newMaxTranche, setNewMaxTranche] = useState('');
  const [newDailyCap, setNewDailyCap] = useState('');

  // `closeMilestone` reverts with MilestoneStillRunning until the milestone has
  // ended AND the certification grace window has passed. The button was offered
  // regardless, so pressing it early cost a signature and gas for a guaranteed
  // revert. Starts null and fills in after mount: a clock compared on the
  // server disagrees with the first client frame.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Math.floor(Date.now() / 1000));
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 30_000);
    return () => clearInterval(t);
  }, []);

  const me = address?.toLowerCase();
  const isEmployer = me === stream.employer.toLowerCase();
  const isContributor = me === stream.contributor.toLowerCase();

  const withdrawable = BigInt(stream.withdrawable);
  // Certified by the agent but not yet delivered by the clock. This is the
  // state the old model had no way to be in — certification and payment used
  // to be the same event.
  const arriving = BigInt(stream.target) > BigInt(stream.earned)
    ? BigInt(stream.target) - BigInt(stream.earned)
    : 0n;
  const outstanding = BigInt(stream.budget) - BigInt(stream.funded);

  // Caps may only RISE, so the current values are the floor for both inputs.
  // Parsed to 6dp USDC the same way the contract stores them.
  const toUnits = (v: string) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? BigInt(Math.round(n * 1e6)) : null;
  };
  const nextMaxTranche = toUnits(newMaxTranche);
  const nextDailyCap = toUnits(newDailyCap);
  const capsValid =
    nextMaxTranche !== null &&
    nextDailyCap !== null &&
    nextMaxTranche >= BigInt(stream.maxTranche) &&
    nextDailyCap >= BigInt(stream.dailyUnlockCap) &&
    nextDailyCap >= nextMaxTranche;

  // A settled milestone rejects fund, pause and close. Offering a button that
  // is guaranteed to revert wastes a signature and teaches the user nothing —
  // the contract already refuses, so the UI should not pretend otherwise.
  const settled = stream.milestoneClosed;

  // Repointing is only offered before the agent has released anything.
  // Afterwards it would change what future work is judged against while money
  // has already moved against the old repository — the employer editing the
  // deal mid-job. Before any unlock it is harmless, and it is the only way to
  // retire a duplicate stream or follow a renamed repository.
  const canRepoint = stream.certifiedBps === 0 && !settled;

  // An unstarted milestone can be closed at once — there is no work in flight
  // to protect. Otherwise the contract waits until end + CLOSE_GRACE.
  const closable = stream.activatedAt === 0 || (now !== null && now >= stream.closableAt);
  const closableIn = now === null ? null : Math.max(0, stream.closableAt - now);

  async function run(label: string, send: () => Promise<`0x${string}`>) {
    setBusy(label);
    setError(null);
    setSent(null);
    try {
      const hash = await send();
      await waitForTransactionReceipt(config, { hash });
      setSent(hash);
      // The page is server-rendered from chain state, so a reload is what
      // makes the new balance appear rather than a hand-maintained cache.
      window.location.reload();
    } catch (err) {
      setError(classify(err));
    } finally {
      setBusy(null);
    }
  }

  if (!isConnected) {
    return (
      <div>
        <p className="ps-caption" style={{ marginBottom: 'var(--ps-2)' }}>
          CONNECT TO FUND, PAUSE OR WITHDRAW FROM THIS STREAM
        </p>
        <Connect />
      </div>
    );
  }

  if (!isEmployer && !isContributor) {
    return (
      <p className="ps-caption">
        READ ONLY — THIS WALLET IS NEITHER THE EMPLOYER NOR THE CONTRIBUTOR OF THIS STREAM
      </p>
    );
  }

  return (
    <div>
      <div className="ps-actions">
        {isContributor && (
          <button
            type="button"
            className="ps-button ps-button-primary"
            disabled={withdrawable === 0n || busy !== null}
            onClick={() =>
              run('withdraw', () =>
                writeContractAsync({
                  address: stream.address as `0x${string}`,
                  abi: WORK_STREAM_ABI,
                  functionName: 'withdraw',
                  args: [stream.payee as `0x${string}`, withdrawable],
                }),
              )
            }
          >
            [ {busy === 'withdraw' ? 'WITHDRAWING…' : 'WITHDRAW'} ]
          </button>
        )}

        {isEmployer && outstanding > 0n && !settled && (
          <button
            type="button"
            className="ps-button"
            disabled={busy !== null}
            onClick={() =>
              run('fund', async () => {
                // approve then fund: the stream pulls with transferFrom.
                const approval = await writeContractAsync({
                  address: USDC,
                  abi: ERC20_ABI,
                  functionName: 'approve',
                  args: [stream.address as `0x${string}`, outstanding],
                });
                await waitForTransactionReceipt(config, { hash: approval });
                return writeContractAsync({
                  address: stream.address as `0x${string}`,
                  abi: WORK_STREAM_ABI,
                  functionName: 'fund',
                  args: [outstanding],
                });
              })
            }
          >
            [ {busy === 'fund' ? 'DEPOSITING…' : 'DEPOSIT THE REMAINDER'} ]
          </button>
        )}

        {isEmployer && !settled && (
          <button
            type="button"
            className="ps-button"
            disabled={busy !== null}
            onClick={() =>
              run('pause', () =>
                writeContractAsync({
                  address: stream.address as `0x${string}`,
                  abi: WORK_STREAM_ABI,
                  functionName: stream.paused ? 'resume' : 'pause',
                }),
              )
            }
          >
            [ {stream.paused ? 'RESUME THE CLOCK' : 'PAUSE THE CLOCK'} ]
          </button>
        )}

        {isEmployer && !settled && (
          <button
            type="button"
            className="ps-button"
            disabled={busy !== null || !closable}
            title={
              closable
                ? undefined
                : 'The contract refuses this until the milestone has ended and the agent has had time to certify work merged just before the deadline'
            }
            onClick={() =>
              run('close', () =>
                writeContractAsync({
                  address: stream.address as `0x${string}`,
                  abi: WORK_STREAM_ABI,
                  functionName: 'closeMilestone',
                }),
              )
            }
          >
            [ CLOSE MILESTONE ]
          </button>
        )}
      </div>

      {isContributor && (
        <p className="ps-caption" style={{ marginTop: 'var(--ps-2)' }}>
          {/* Zero withdrawable has three quite different causes, and collapsing
              them into one message told a contributor who had just been paid
              that they had never earned anything. */}
          {withdrawable > 0n ? (
            <>
              <Amount raw={Number(withdrawable)} size="s" /> READY — PAID ONLY TO THE ALLOWLISTED
              PAYEE
            </>
          ) : BigInt(stream.withdrawn) > 0n ? (
            <>
              ALL EARNED PAY WITHDRAWN — <Amount raw={Number(stream.withdrawn)} size="s" /> PAID OUT
              SO FAR
              {arriving > 0n && (
                <>
                  {' · '}
                  <Amount raw={Number(arriving)} size="s" /> CERTIFIED, ARRIVING AS THE STREAM RUNS
                </>
              )}
            </>
          ) : arriving > 0n ? (
            <>
              <Amount raw={Number(arriving)} size="s" /> CERTIFIED BY THE AGENT — IT ARRIVES AS THE
              STREAM RUNS, WITH NO FURTHER PULL REQUESTS
            </>
          ) : (
            'NOTHING TO WITHDRAW YET — THE AGENT CERTIFIES WORK BEFORE ANYTHING IS OWED'
          )}
        </p>
      )}

      {/* setRepo exists on the contract and had no interface at all, which left
          the only route to it exporting a private key into a keystore. An
          employer legitimately needs this: repositories get renamed, and two
          streams claiming one repo are BOTH refused by the agent until one is
          pointed elsewhere. Folded away, because it is a rare action. */}
      {isEmployer && canRepoint && (
        <details className="ps-repoint">
          <summary className="ps-label">CHANGE THE REPOSITORY ▾</summary>
          <label className="ps-caption" htmlFor="repoint">
            CURRENTLY WATCHING {stream.repo || '(none)'}
          </label>
          <div className="ps-repoint-row">
            <input
              id="repoint"
              className="ps-input"
              value={newRepo}
              placeholder={`[ ${stream.repo || 'owner/name'} ]`}
              onChange={(e) => setNewRepo(e.target.value)}
            />
            <button
              type="button"
              className="ps-button"
              disabled={busy !== null || !/^[^/\s]+\/[^/\s]+$/.test(newRepo)}
              onClick={() =>
                run('repo', () =>
                  writeContractAsync({
                    address: stream.address as `0x${string}`,
                    abi: WORK_STREAM_ABI,
                    functionName: 'setRepo',
                    args: [newRepo],
                  }),
                )
              }
            >
              [ {busy === 'repo' ? 'UPDATING…' : 'REPOINT'} ]
            </button>
          </div>
          <p className="ps-caption">
            THE AGENT READS THIS FROM THE CONTRACT, SO IT TAKES EFFECT WITHIN A MINUTE WITH NO
            RE-REGISTRATION. TWO STREAMS ON ONE REPOSITORY ARE BOTH REFUSED, SO POINT ONE AT A DEAD
            NAME LIKE RETIRED/DUPLICATE TO RETIRE IT. UNAVAILABLE ONCE THE AGENT HAS RELEASED
            ANYTHING.
          </p>
        </details>
      )}

      {/* The employer may LOOSEN the mandate and never tighten it. A cap the
          employer could lower mid-milestone is a way to strand work the agent
          has already certified, so the contract refuses it — and refuses any
          change to the payee, which is the contributor's protection rather than
          the employer's convenience. The agent cannot call this at all.

          Needed in practice: a stream whose caps are below its budget cannot
          release everything the agent certifies, and the only alternative was
          exporting a key into a keystore. */}
      {isEmployer && !settled && (
        <details className="ps-repoint">
          <summary className="ps-label">RAISE THE AGENT&rsquo;S LIMITS ▾</summary>
          <p className="ps-caption">
            NOW: <Amount raw={Number(stream.maxTranche)} size="s" suffix={false} /> PER
            CERTIFICATION · <Amount raw={Number(stream.dailyUnlockCap)} size="s" suffix={false} />{' '}
            PER DAY · BUDGET <Amount raw={Number(stream.budget)} size="s" />
          </p>
          <div className="ps-repoint-row">
            <input
              className="ps-input"
              inputMode="decimal"
              value={newMaxTranche}
              placeholder={`PER CERTIFICATION ≥ ${(Number(stream.maxTranche) / 1e6).toString()}`}
              onChange={(e) => setNewMaxTranche(e.target.value)}
            />
            <input
              className="ps-input"
              inputMode="decimal"
              value={newDailyCap}
              placeholder={`PER DAY ≥ ${(Number(stream.dailyUnlockCap) / 1e6).toString()}`}
              onChange={(e) => setNewDailyCap(e.target.value)}
            />
            <button
              type="button"
              className="ps-button"
              disabled={busy !== null || !capsValid}
              onClick={() =>
                run('caps', () =>
                  writeContractAsync({
                    address: stream.address as `0x${string}`,
                    abi: WORK_STREAM_ABI,
                    functionName: 'raisePolicy',
                    args: [nextMaxTranche as bigint, nextDailyCap as bigint],
                  }),
                )
              }
            >
              [ {busy === 'caps' ? 'RAISING…' : 'RAISE'} ]
            </button>
          </div>
          <p className="ps-caption">
            BOTH MAY ONLY GO UP, AND THE DAILY CAP MAY NOT SIT BELOW THE PER-CERTIFICATION ONE — THE
            CONTRACT REVERTS OTHERWISE. THE PAYEE NEVER CHANGES. RAISING CANNOT PAY OUT MORE THAN THE
            AGENT HAS ALREADY CERTIFIED; IT ONLY STOPS A CAP BLOCKING WHAT IT DID.
          </p>
        </details>
      )}

      {/* A disabled button with no explanation reads as broken. This is the one
          wait in the product that protects someone else's money, so it is worth
          a sentence rather than a shrug. */}
      {isEmployer && !settled && !closable && closableIn !== null && (
        <p className="ps-caption" style={{ marginTop: 'var(--ps-2)' }}>
          CLOSING UNLOCKS IN {formatWait(closableIn)} — THE MILESTONE MUST END, THEN THE AGENT GETS
          FOUR HOURS TO CERTIFY WORK MERGED JUST BEFORE THE DEADLINE. CLOSING SOONER WOULD REFUND
          PAY THAT WAS ALREADY EARNED.
        </p>
      )}

      {isEmployer && (
        <p className="ps-caption" style={{ marginTop: 'var(--ps-2)' }}>
          {settled
            ? 'THIS MILESTONE IS SETTLED — UNSPENT BUDGET HAS BEEN RETURNED. OPEN A NEW ONE TO CONTINUE.'
            : 'CLOSING RETURNS ONLY WHAT WAS NEVER RELEASED, AND ONLY ONCE THE DURATION HAS RUN'}
        </p>
      )}

      {error && (
        <div className="ps-invert" style={{ marginTop: 'var(--ps-3)' }}>
          <p className="ps-label" style={{ marginBottom: 'var(--ps-2)' }}>
            ⚠ TRANSACTION FAILED
          </p>
          <p className="ps-body" style={{ margin: 0 }}>
            {error}
          </p>
        </div>
      )}
      {sent && <p className="ps-caption">SENT {sent.slice(0, 10)}…</p>}
    </div>
  );
}
