'use client';

import { useState } from 'react';
import { useAccount, useConfig, useWriteContract } from 'wagmi';
import { waitForTransactionReceipt } from 'wagmi/actions';
import { ERC20_ABI, USDC } from '../lib/chain';
import type { Stream } from '../lib/stream';
import { Amount } from './amount';
import { Connect } from './connect';

const WORK_STREAM_ABI = [
  { type: 'function', name: 'fund', stateMutability: 'nonpayable', inputs: [{ name: 'amount', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'pause', stateMutability: 'nonpayable', inputs: [], outputs: [] },
  { type: 'function', name: 'resume', stateMutability: 'nonpayable', inputs: [], outputs: [] },
  { type: 'function', name: 'closeMilestone', stateMutability: 'nonpayable', inputs: [], outputs: [] },
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

  const me = address?.toLowerCase();
  const isEmployer = me === stream.employer.toLowerCase();
  const isContributor = me === stream.contributor.toLowerCase();

  const withdrawable = BigInt(stream.withdrawable);
  const outstanding = BigInt(stream.budget) - BigInt(stream.funded);

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
      setError(err instanceof Error ? err.message.split('\n')[0] : String(err));
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

        {isEmployer && outstanding > 0n && (
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

        {isEmployer && (
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

        {isEmployer && (
          <button
            type="button"
            className="ps-button"
            disabled={busy !== null}
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
          {withdrawable > 0n ? (
            <>
              <Amount raw={Number(withdrawable)} size="s" /> READY — PAID ONLY TO THE ALLOWLISTED
              PAYEE
            </>
          ) : (
            'NOTHING TO WITHDRAW YET — THE AGENT RELEASES A TRANCHE WHEN IT VERIFIES WORK'
          )}
        </p>
      )}

      {isEmployer && (
        <p className="ps-caption" style={{ marginTop: 'var(--ps-2)' }}>
          CLOSING RETURNS ONLY WHAT WAS NEVER RELEASED, AND ONLY ONCE THE DURATION HAS RUN
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
