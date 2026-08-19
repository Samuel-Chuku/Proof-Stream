'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAccount, useConfig, useWriteContract } from 'wagmi';
import { waitForTransactionReceipt } from 'wagmi/actions';
import { capStops, stopFor, stopIndexFor } from '../lib/caps';
import { ERC20_ABI, USDC } from '../lib/chain';
import type { Stream } from '../lib/stream';
import { Amount } from './amount';
import { Connect } from './connect';
import { passkeysConfigured } from '../lib/passkey';

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
  // Caps as micro-USDC numbers rather than free text. Two text boxes made the
  // employer work out for themselves which numbers the contract would accept —
  // both may only rise, and the daily cap may never sit below the per-
  // certification one. A track bounded by the current value and the budget makes
  // the legal range the only reachable range, so RAISE cannot revert.
  // Which folded panel is open, if any. One at a time: these are rare employer
  // actions, and two open at once buries the buttons that opened them.
  const [panel, setPanel] = useState<'caps' | 'repo' | null>(null);
  const [capsTranche, setCapsTranche] = useState(() => Number(stream.maxTranche));
  const [capsDaily, setCapsDaily] = useState(() => Number(stream.dailyUnlockCap));

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

  const capBudget = Number(stream.budget);

  /// Each slider is indexed over its own list of stops rather than driven by
  /// min/max/step, so every position is a real value and the budget is always
  /// reachable. See lib/caps.ts for why snapping in the handler was worse than
  /// the bug it appeared to fix.
  ///
  /// Memoised because `capStops` is O(budget in whole USDC) where the min/max/step
  /// it replaced was O(1), and this component re-renders every 30 seconds off the
  /// `now` clock above. Unmemoised, a large-budget stream rebuilt both lists on
  /// every tick for a panel that is usually closed. The inputs are the caps and
  /// the budget, all of which only change when a `raisePolicy` lands.
  const trancheStops = useMemo(
    () => capStops(Number(stream.maxTranche), capBudget),
    [stream.maxTranche, capBudget],
  );
  const dailyStops = useMemo(
    () => capStops(Number(stream.dailyUnlockCap), capBudget),
    [stream.dailyUnlockCap, capBudget],
  );
  // A stream already at the budget on both counts has nothing left to raise.
  const capsRaisable = Number(stream.maxTranche) < capBudget || Number(stream.dailyUnlockCap) < capBudget;
  const capsValid =
    capsDaily >= capsTranche &&
    capsTranche >= Number(stream.maxTranche) &&
    capsDaily >= Number(stream.dailyUnlockCap) &&
    (capsTranche > Number(stream.maxTranche) || capsDaily > Number(stream.dailyUnlockCap));

  /// The daily cap can never sit below the per-certification one, so raising the
  /// latter pushes the former up with it rather than leaving an invalid pair.
  /// The pushed value is snapped onto the DAILY slider's own stops, because a
  /// value that is not one of its stops is exactly how the element and React
  /// start disagreeing about what is selected.
  function setTranche(v: number) {
    setCapsTranche(v);
    if (v > capsDaily) setCapsDaily(stopFor(dailyStops, v));
  }

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

  // The duration has run out. Pausing a clock that has already stopped changes
  // nothing — `accrued()` is capped at the milestone's end either way — so the
  // button was offering an action with no effect, and it stayed on offer after
  // the contributor had been paid in full.
  const ended =
    stream.activatedAt > 0 && now !== null && now >= stream.activatedAt + Number(stream.duration);

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
      // The page is server-rendered from chain state, so a reload is what makes
      // the new balance appear rather than a hand-maintained cache. `fresh`
      // additionally forces the event scan to skip ITS cache — without it a
      // withdrawal confirmed seconds ago was answered from a stale snapshot and
      // never showed up in the transaction list.
      window.location.href = `${window.location.pathname}?fresh=${hash.slice(2, 10)}`;
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
        {/* A contributor sent a link to this page has probably never held a
            wallet. Saying so here costs one line and is the difference between
            onboarding and a dead end. */}
        {passkeysConfigured && (
          <p className="ps-caption" style={{ marginTop: 'var(--ps-2)' }}>
            BEING PAID BY THIS STREAM AND HAVE NO WALLET?{' '}
            <a href="/#passkey">CREATE A PASSKEY WALLET →</a>
          </p>
        )}
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
        {/* Hidden once there is nothing left to take AND something has already
            been taken — a dead button after a successful withdrawal is clutter,
            and the line underneath already says how much was paid. Still shown
            disabled before anything is earned, where it tells a contributor the
            action exists and is waiting on the agent. */}
        {isContributor && !(withdrawable === 0n && BigInt(stream.withdrawn) > 0n) && (
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

        {isEmployer && !settled && !ended && (
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

        {/* Rare employer actions. They sit in the action row as buttons like
            everything else rather than as a panel that is simply always there —
            a control that is permanently open reads as something you are
            expected to be doing. */}
        {isEmployer && !settled && capsRaisable && (
          <button
            type="button"
            className="ps-button"
            aria-expanded={panel === 'caps'}
            onClick={() => setPanel((p) => (p === 'caps' ? null : 'caps'))}
          >
            [ AGENT LIMITS {panel === 'caps' ? '▴' : '▾'} ]
          </button>
        )}

        {isEmployer && canRepoint && (
          <button
            type="button"
            className="ps-button"
            aria-expanded={panel === 'repo'}
            onClick={() => setPanel((p) => (p === 'repo' ? null : 'repo'))}
          >
            [ CHANGE REPOSITORY {panel === 'repo' ? '▴' : '▾'} ]
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
      {isEmployer && canRepoint && panel === 'repo' && (
        <section className="ps-mandate">
          <div className="ps-range-head">
            <span className="ps-label">CHANGE THE REPOSITORY</span>
            <button type="button" className="ps-button" onClick={() => setPanel(null)}>
              [ CLOSE ]
            </button>
          </div>
          <label className="ps-caption" htmlFor="repoint">
            NOW WATCHING {stream.repo || '(none)'} · FORMAT OWNER/NAME#BRANCH — NO BRANCH MEANS MAIN
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
              disabled={busy !== null || !/^[^/\s#]+\/[^/\s#]+(#[\w.\-/]+)?$/.test(newRepo)}
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
            TAKES EFFECT WITHIN A MINUTE — THE AGENT READS IT FROM THE CONTRACT. GONE ONCE THE AGENT
            HAS RELEASED ANYTHING.
          </p>
        </section>
      )}

      {/* The employer may LOOSEN the mandate and never tighten it. A cap the
          employer could lower mid-milestone is a way to strand work the agent
          has already certified, so the contract refuses it — and refuses any
          change to the payee, which is the contributor's protection rather than
          the employer's convenience. The agent cannot call this at all.

          Needed in practice: a stream whose caps are below its budget cannot
          release everything the agent certifies, and the only alternative was
          exporting a key into a keystore. */}
      {isEmployer && !settled && capsRaisable && panel === 'caps' && (
        <section className="ps-mandate">
          <div className="ps-range-head">
            <span className="ps-label">THE AGENT&rsquo;S SPENDING LIMITS</span>
            <button type="button" className="ps-button" onClick={() => setPanel(null)}>
              [ CLOSE ]
            </button>
          </div>
          <p className="ps-caption">
            RAISE ONLY. BOUNDS THE AGENT, NOT THE CONTRIBUTOR.
          </p>

          <div className="ps-range-row" style={{ marginTop: 'var(--ps-3)' }}>
            <div className="ps-range-head">
              <span className="ps-label">PER CERTIFICATION</span>
              <Amount raw={capsTranche} size="s" />
            </div>
            <input
              type="range"
              className="ps-range"
              min={0}
              max={trancheStops.length - 1}
              step={1}
              value={stopIndexFor(trancheStops, capsTranche)}
              aria-label="Per-certification cap"
              onChange={(e) => setTranche(trancheStops[Number(e.target.value)])}
            />
          </div>

          <div className="ps-range-row">
            <div className="ps-range-head">
              <span className="ps-label">PER DAY</span>
              <Amount raw={capsDaily} size="s" />
            </div>
            <input
              type="range"
              className="ps-range"
              min={0}
              max={dailyStops.length - 1}
              step={1}
              value={stopIndexFor(dailyStops, capsDaily)}
              aria-label="Daily cap"
              onChange={(e) => {
                // Never below the per-certification cap, and always on a stop.
                const picked = dailyStops[Number(e.target.value)];
                const clamped = picked < capsTranche ? stopFor(dailyStops, capsTranche) : picked;
                setCapsDaily(clamped);
                // Put the DOM back ourselves. When the clamp lands on the value
                // already in state, React bails out of re-rendering, so the
                // thumb stays where the drag ended while the label reads the
                // clamped figure. The committed value is the correct one either
                // way, but a control that disagrees with its own label is the
                // exact divergence caps.ts was written to remove.
                e.target.value = String(stopIndexFor(dailyStops, clamped));
              }}
            />
          </div>

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
                  args: [BigInt(capsTranche), BigInt(capsDaily)],
                }),
              )
            }
          >
            [ {busy === 'caps' ? 'RAISING…' : 'RAISE'} ]
          </button>
        </section>
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
