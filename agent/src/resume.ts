// RESUMING A CERTIFICATION THE POLICY CLIPPED.
//
// `maxTranche` bounds how much ONE attestation may add and `dailyUnlockCap`
// bounds a UTC day. When both agents agree a milestone is 97% done and the cap
// admits 30%, the pipeline certifies 30% and records the 97% it concluded. It
// then waited for the next merge to climb further, and on a finished milestone
// there is no next merge: on 2026-08-08 the grace window closed first and 67
// USDC of agreed work was refunded to the employer.
//
// This pass climbs toward the concluded figure on its own, from the sweep.
// It is bounded hard, because it sends transactions with no merge behind them:
//
//   - it only ever climbs toward a figure the agents ALREADY CONCLUDED for work
//     ALREADY MERGED, taken from the most recent certification on this exact
//     milestone (hash and index), and only when that certification was clipped;
//   - it never re-judges: no inference, no second opinion, no new verdict. The
//     judgment on file is the judgment;
//   - it takes one policy-sized step per sweep, clipped to what the daily cap
//     still allows today, so it respects the rate limit across days rather
//     than defeating it within one. That is what a rate limit means;
//   - a later certification supersedes it: if anything was certified after the
//     clipped one, that judgment saw the final tree and stands on its own.
//
// `RESUME_CLIPPED=off` turns it off.
import { readFileSync } from 'node:fs';
import { formatUsdc } from '@proofstream/config';
import { type Attestation, readDailyHeadroom, readStream, sendCertification, signAttestation } from './chain';
import { env, ledgerPath } from './env';
import { meterCertification } from './metering';
import { knownStreams } from './registry';
import { serialize } from './serialize';

type Logger = (entry: Record<string, unknown>) => void;

const FULL_BPS = 10_000n;

/// What a clipped certification left on the table, from the ledger.
export type Clipped = {
  pr: number;
  commitSha: string;
  /** What the agents agreed the milestone was worth, 0-1. */
  agreedFraction: number;
  /** The attestor's confidence at the time, carried unchanged. */
  confidence: number;
  earnerId?: `0x${string}`;
};

/// The most recent certification on this exact milestone, if it was clipped.
///
/// THE MOST RECENT, not the highest. A later certification was judged against
/// the final tree and supersedes anything before it, clipped or not; and on a
/// public stream it names a different earner, whose share is their own. Only
/// the last word on the milestone can still be owed something.
export function latestClipped(
  rows: readonly Record<string, unknown>[],
  streamAddress: string,
  milestoneHash: string,
  milestoneIndex: number,
): Clipped | null {
  const mine = rows.filter(
    (r) =>
      r.event === 'unlocked' &&
      typeof r.workStream === 'string' &&
      r.workStream.toLowerCase() === streamAddress.toLowerCase() &&
      typeof r.milestoneHash === 'string' &&
      r.milestoneHash.toLowerCase() === milestoneHash.toLowerCase() &&
      r.milestoneIndex === milestoneIndex,
  );
  const last = mine[mine.length - 1];
  if (!last || last.meteredByPolicy !== true) return null;
  const verdict = last.verdict as { confidence?: number } | undefined;
  if (typeof last.agreedFraction !== 'number' || typeof last.pr !== 'number' || typeof last.commitSha !== 'string') return null;
  return {
    pr: last.pr,
    commitSha: last.commitSha,
    agreedFraction: last.agreedFraction,
    confidence: typeof verdict?.confidence === 'number' ? verdict.confidence : 0,
    earnerId: typeof last.earnerId === 'string' ? (last.earnerId as `0x${string}`) : undefined,
  };
}

/// Read the ledger fresh each sweep: the pipeline appends while we work.
function ledgerRows(): Record<string, unknown>[] {
  try {
    return readFileSync(ledgerPath('verdicts.jsonl'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as Record<string, unknown>];
        } catch {
          return []; // a truncated final line is normal mid-write
        }
      });
  } catch {
    return [];
  }
}

/// The step this sweep may take, or null if there is none to take.
///
/// `meterCertification` applies `maxTranche`; the daily headroom is applied on
/// top, in USDC, then converted back to basis points rounded DOWN so the step
/// can never exceed what the contract will accept. Pure, so it is tested.
export function resumeStep(
  agreedFraction: number,
  stream: { budget: bigint; target: bigint; maxTranche: bigint; certifiedBps: bigint },
  dailyHeadroom: bigint,
): { certifiedBps: bigint; trancheAdded: bigint } | null {
  const m = meterCertification(agreedFraction, stream);
  if (!m.raises) return null;
  if (m.trancheAdded <= dailyHeadroom) return { certifiedBps: m.certifiedBps, trancheAdded: m.trancheAdded };
  if (dailyHeadroom <= 0n) return null;
  const target = stream.target + dailyHeadroom;
  const certifiedBps = (target * FULL_BPS) / stream.budget;
  if (certifiedBps <= stream.certifiedBps) return null;
  return { certifiedBps, trancheAdded: (stream.budget * certifiedBps) / FULL_BPS - stream.target };
}

/// One pass over every served stream. Called from the sweep.
///
/// Two loggers, because they are two different records: `log` is operational
/// and goes to stdout with the registry's own events; `record` is the verdict
/// ledger, and a resumed certification is a row in it, exactly like the
/// certification it continues. Injected rather than imported so this module
/// never pulls the pipeline in.
export async function resumeClipped(log: Logger, record: Logger): Promise<void> {
  if (!env.resumeClipped) return;
  const rows = ledgerRows();

  for (const entry of knownStreams()) {
    const streamAddress = entry.stream as `0x${string}`;
    try {
      // Same lock as a live judgment on this stream, so a resume and a webhook
      // can never both read one nonce and race for it.
      await serialize(streamAddress.toLowerCase(), async () => {
        const stream = await readStream(streamAddress);
        if (!stream.isActive || stream.certifiedBps >= FULL_BPS) return;

        const clipped = latestClipped(rows, streamAddress, stream.milestoneHash, Number(stream.milestoneIndex));
        if (!clipped) return;

        const headroom = await readDailyHeadroom(streamAddress, stream.dailyUnlockCap);
        const step = resumeStep(clipped.agreedFraction, stream, headroom);
        if (!step) {
          if (headroom === 0n) {
            log({
              event: 'resume_waiting',
              workStream: streamAddress,
              pr: clipped.pr,
              reason: `concluded ${Math.round(clipped.agreedFraction * 100)}%, certified ${Number(stream.certifiedBps) / 100}%; today's cap is spent, next UTC day`,
            });
          }
          return;
        }

        const attestation: Attestation = {
          nonce: stream.nonce,
          certifiedBps: step.certifiedBps,
          prNumber: BigInt(clipped.pr),
          commitSha: clipped.commitSha,
          confidenceBps: BigInt(Math.round(clipped.confidence * 10_000)),
          issuedAt: BigInt(Math.floor(Date.now() / 1000)),
          milestoneHash: stream.milestoneHash,
          earnerId: clipped.earnerId,
        };

        const signature = await signAttestation(streamAddress, attestation, stream.version);
        const result = await sendCertification(streamAddress, attestation, signature, stream.version);
        const outcome = result.state === 'COMPLETE' ? 'unlocked' : 'unlock_failed';

        // An `unlocked` row like the pipeline's, so the dashboard's transaction
        // feed and EVIDENCE.md see it as the certification it is, marked as a
        // resume and WITHOUT a verdict: nothing was judged here. `judged` is
        // deliberately absent too, so `alreadyJudged` keeps treating the
        // original pull request as judged.
        record({
          event: outcome,
          resumed: true,
          workStream: streamAddress,
          repo: stream.repo,
          pr: clipped.pr,
          commitSha: clipped.commitSha,
          milestone: stream.milestone,
          milestoneHash: stream.milestoneHash,
          milestoneIndex: Number(stream.milestoneIndex),
          earnerId: clipped.earnerId,
          agreedFraction: clipped.agreedFraction,
          certifiedPercent: Number(step.certifiedBps) / 100,
          trancheUsdc: formatUsdc(step.trancheAdded),
          meteredByPolicy: step.certifiedBps < BigInt(Math.round(clipped.agreedFraction * 10_000)) || undefined,
          reason: `resumed toward the ${Math.round(clipped.agreedFraction * 100)}% the agents concluded on PR #${clipped.pr}; no new judgment`,
          nonce: Number(attestation.nonce),
          circleTransactionId: result.transactionId,
          state: result.state,
          txHash: result.txHash,
          errorReason: result.errorReason,
          explorer: result.txHash ? `https://testnet.arcscan.app/tx/${result.txHash}` : undefined,
        });
      });
    } catch (err) {
      log({ event: 'resume_failed', workStream: streamAddress, message: err instanceof Error ? err.message : String(err) });
    }
  }
}
