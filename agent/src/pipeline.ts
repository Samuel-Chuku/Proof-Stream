// The judgment pipeline for one pull request, lifted out of the webhook
// handler so the Phase 5 seeder drives the SAME gates the live agent does.
// Duplicating these would let the demo and the product drift apart, and these
// gates are the product.
import { appendFileSync } from 'node:fs';
import { formatUsdc } from '@proofstream/config';
import { readStream, sendUnlock, signAttestation, type Attestation } from './chain';
import { env } from './env';
import { fetchDiff, type MergedPr } from './github';
import { buySecondOpinion } from './pay';
import { resolveStream } from './registry';
import { judge } from './verdict';

const LOG_PATH = new URL('../verdicts.jsonl', import.meta.url).pathname;

export function log(entry: Record<string, unknown>) {
  const line = { at: new Date().toISOString(), ...entry };
  appendFileSync(LOG_PATH, `${JSON.stringify(line)}\n`);
  console.log(JSON.stringify(line));
}

export type PipelineOutcome =
  | 'skipped'
  | 'declined'
  | 'escalated'
  | 'vetoed'
  | 'unlocked'
  | 'unlock_failed';

/// Judge one PR and, if it earns it, unlock a tranche. Returns what happened so
/// a caller can tally outcomes; every step is also written to verdicts.jsonl.
export async function processPr(pr: MergedPr): Promise<PipelineOutcome> {
  // Route the event to the stream that owns this repo. Deliberately refuses to
  // guess: with many streams served by one agent, picking "probably that one"
  // would mean signing an attestation against the wrong employer's money.
  if (!pr.repo) {
    log({ event: 'skipped', pr: pr.number, reason: 'event carries no repo — cannot route it to a stream' });
    return 'skipped';
  }

  const entry = resolveStream(pr.repo);
  if (!entry) {
    log({
      event: 'skipped',
      pr: pr.number,
      reason: `no registered stream watches ${pr.repo}`,
    });
    return 'skipped';
  }

  const streamAddress = entry.stream;
  const stream = await readStream(streamAddress);

  // A milestone that the employer has not fully funded has not started, so
  // there is nothing to certify and nothing was earned. Judging it would burn
  // inference for a payout that cannot happen.
  if (!stream.fullyFunded || !stream.isActive) {
    log({
      event: 'skipped',
      pr: pr.number,
      reason: `milestone ${stream.milestoneIndex} is not funded (${formatUsdc(stream.funded)} of ${formatUsdc(stream.budget)} USDC)`,
    });
    return 'skipped';
  }

  // Pause stops the clock, not certification: work already earned stays
  // releasable. Nothing new accrues, so the accrual check below does the work.
  if (stream.paused) {
    log({ event: 'skipped', pr: pr.number, reason: 'stream is paused — no new accrual' });
    return 'skipped';
  }

  // The contract says which repo this job is about. An event from anywhere else
  // is not this stream's business, whatever the agent's own env happens to say.
  if (pr.repo && pr.repo.toLowerCase() !== stream.repo.toLowerCase()) {
    log({
      event: 'skipped',
      pr: pr.number,
      reason: `event is for ${pr.repo} but this stream watches ${stream.repo}`,
    });
    return 'skipped';
  }

  const diff = await fetchDiff(stream.repo, pr.number);
  const { verdict, costUsd, model } = await judge(pr, stream.milestone, diff);

  const base = {
    // Which contract this judgment was made against. Without it, a redeploy —
    // or now a second tenant — silently mixes two contracts' transactions into
    // one evidence table.
    workStream: streamAddress,
    repo: stream.repo,
    pr: pr.number,
    title: pr.title,
    commitSha: pr.commitSha,
    milestone: stream.milestone,
    model,
    inferenceCostUsd: costUsd,
    verdict,
  };

  // Judgment gates, in order. None of them is "the PR merged, therefore pay" (T5).
  if (!verdict.satisfies_milestone) {
    log({ event: 'declined', ...base, reason: 'work does not satisfy the milestone' });
    return 'declined';
  }
  if (verdict.confidence < env.confidenceThreshold) {
    log({
      event: 'escalated',
      ...base,
      reason: `confidence ${verdict.confidence} below threshold ${env.confidenceThreshold}`,
    });
    return 'escalated';
  }

  // The attestor is convinced. Before it acts on its own conviction it buys an
  // independent second opinion and pays for it out of its own wallet. Fails
  // closed: if the verifier cannot be paid or does not answer, nothing unlocks.
  let purchase: Awaited<ReturnType<typeof buySecondOpinion>>;
  try {
    purchase = await buySecondOpinion(streamAddress, pr.number);
  } catch (err) {
    log({
      event: 'escalated',
      ...base,
      reason: `second opinion unavailable: ${err instanceof Error ? err.message : String(err)}`,
    });
    return 'escalated';
  }

  const { opinion, feePaid, transfer } = purchase;
  const verification = {
    verifier: opinion,
    verificationFeeUsdc: formatUsdc(feePaid),
    gatewayTransfer: transfer,
  };

  if (!opinion.satisfies_milestone) {
    log({ event: 'vetoed', ...base, ...verification, reason: 'verifier disagrees that the work satisfies the milestone' });
    return 'vetoed';
  }
  if (opinion.confidence < env.confidenceThreshold) {
    log({
      event: 'escalated',
      ...base,
      ...verification,
      reason: `verifier confidence ${opinion.confidence} below threshold ${env.confidenceThreshold}`,
    });
    return 'escalated';
  }

  // Both agree. Take the LOWER of the two fractions — the second opinion can
  // shrink the payout, which is what makes buying it worth anything.
  const agreedFraction = Math.min(verdict.tranche_fraction, opinion.tranche_fraction);

  // The fraction scales the policy ceiling, then accrual caps it — the agent
  // can never certify money that has not been earned yet. Measured against
  // THIS milestone's accrual and its own released total, which is what
  // `unlock` checks on-chain; using the stream's lifetime `unlocked` here
  // would under-count on every milestone after the first.
  const available = stream.accrued - stream.milestoneUnlocked;
  const desired = (stream.maxTranche * BigInt(Math.round(agreedFraction * 10_000))) / 10_000n;
  const tranche = desired < available ? desired : available;

  if (tranche <= 0n) {
    log({ event: 'skipped', ...base, ...verification, reason: 'nothing accrued to unlock yet' });
    return 'skipped';
  }

  const attestation: Attestation = {
    nonce: stream.nonce,
    tranche,
    prNumber: BigInt(pr.number),
    commitSha: pr.commitSha,
    confidenceBps: BigInt(Math.round(verdict.confidence * 10_000)),
    issuedAt: BigInt(Math.floor(Date.now() / 1000)),
    milestoneHash: stream.milestoneHash,
  };

  // Signed against THIS stream: the EIP-712 domain's verifyingContract is the
  // stream address, so a signature is only ever valid at the contract it was
  // made for.
  const signature = await signAttestation(streamAddress, attestation);
  const result = await sendUnlock(streamAddress, attestation, signature);
  const outcome: PipelineOutcome = result.state === 'COMPLETE' ? 'unlocked' : 'unlock_failed';

  log({
    event: outcome,
    ...base,
    ...verification,
    agreedFraction,
    trancheUsdc: formatUsdc(tranche),
    nonce: Number(attestation.nonce),
    circleTransactionId: result.transactionId,
    state: result.state,
    txHash: result.txHash,
    errorReason: result.errorReason,
    explorer: result.txHash ? `https://testnet.arcscan.app/tx/${result.txHash}` : undefined,
  });

  return outcome;
}
