// The judgment pipeline for one pull request, lifted out of the webhook
// handler so the Phase 5 seeder drives the SAME gates the live agent does.
// Duplicating these would let the demo and the product drift apart, and these
// gates are the product.
import { appendFileSync } from 'node:fs';
import { formatUsdc, matchesRepoSpec, parseRepoSpec } from '@proofstream/config';
import { readStream, sendCertification, signAttestation, type Attestation } from './chain';
import { env } from './env';
import { fetchDiff, type MergedPr } from './github';
import { buySecondOpinion } from './pay';
import { resolveStreams, type StreamEntry } from './registry';
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

/// Judge one PR against EVERY stream watching its repo.
///
/// One repository can carry several streams — two contributors, two milestones,
/// two budgets, one codebase — and each is a separate employer's money with its
/// own definition of done. So each is judged on its own: the same merge can
/// satisfy one milestone and fail another, and a decision on one stream never
/// touches the other's funds.
///
/// An earlier version routed to a single stream and refused to act when it
/// found two. That treated an ordinary arrangement as an error, and left a new
/// stream unserved whenever a previous one on the same repo had merely run out
/// of time without being closed.
export async function processPr(pr: MergedPr): Promise<PipelineOutcome[]> {
  if (!pr.repo) {
    log({ event: 'skipped', pr: pr.number, reason: 'event carries no repo — cannot route it to a stream' });
    return ['skipped'];
  }

  const entries = resolveStreams(pr.repo);
  if (entries.length === 0) {
    log({ event: 'skipped', pr: pr.number, reason: `no registered stream watches ${pr.repo}` });
    return ['skipped'];
  }

  if (entries.length > 1) {
    log({
      event: 'fan_out',
      pr: pr.number,
      repo: pr.repo,
      streams: entries.map((e) => e.stream),
      reason: 'several streams watch this repo — each is judged separately against its own milestone',
    });
  }

  // Sequential, not parallel. Each stream costs an inference call and a
  // verifier fee, and Arc's RPC rate-limits hard enough that a burst of
  // concurrent reads is the thing most likely to fail.
  const outcomes: PipelineOutcome[] = [];
  for (const entry of entries) {
    try {
      outcomes.push(await judgeForStream(pr, entry));
    } catch (err) {
      log({
        event: 'unlock_failed',
        workStream: entry.stream,
        repo: entry.repo,
        pr: pr.number,
        reason: `judgment threw: ${err instanceof Error ? err.message : String(err)}`,
      });
      outcomes.push('unlock_failed');
    }
  }
  return outcomes;
}

/// One PR, one stream. Every gate below is about THIS stream's terms.
async function judgeForStream(pr: MergedPr, entry: StreamEntry): Promise<PipelineOutcome> {
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

  // The contract says which repo AND which branch this job is about. An event
  // from anywhere else is not this stream's business, whatever the agent's own
  // env happens to say.
  //
  // The branch half is not bureaucracy. Without it, a contributor could open a
  // pull request into a throwaway branch, merge it themselves — nobody protects
  // a non-default branch — and be paid for work the employer never reviewed and
  // that never reached the codebase. Fails closed: a base we cannot read is
  // treated as the wrong one.
  const want = parseRepoSpec(stream.repo);
  if (pr.repo && !matchesRepoSpec(stream.repo, pr.repo, pr.baseBranch)) {
    log({
      event: 'skipped',
      pr: pr.number,
      reason:
        pr.repo.toLowerCase() !== want.repo.toLowerCase()
          ? `event is for ${pr.repo} but this stream watches ${want.repo}`
          : `merged into ${pr.baseBranch ?? 'an unreadable branch'} but this stream only pays for work merged into ${want.branch}`,
    });
    return 'skipped';
  }

  const diff = await fetchDiff(want.repo, pr.number);
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
  //
  // THE FRACTION IS THE GATE, not the boolean. `tranche_fraction` already says
  // everything the boolean does — 0.0 is "this earns nothing" — and it is the
  // only value the contract consumes. Gating on the boolean as well meant one
  // flaky field could veto a payment the rest of the verdict supported: the
  // same model on the same prompt returned satisfies=false with fraction=0.5
  // and a reasoning paragraph describing partial work, while a local run of
  // the identical input returned true. Shared free-model pools are not
  // deterministic, and a boolean has no way to be partly right.
  //
  // Nothing is lost against T5: genuinely unrelated or gamed work scores 0.0
  // on the fraction as well, from both agents independently — that is what the
  // negative-control tests check.
  if (verdict.tranche_fraction <= 0) {
    log({ event: 'declined', ...base, reason: 'work earns nothing against this milestone' });
    return 'declined';
  }

  // Worth recording rather than silently resolving: it means the prompt and the
  // model disagree about what the boolean is for, and that is a prompt bug to
  // fix, not noise.
  if (!verdict.satisfies_milestone) {
    log({
      event: 'contradiction',
      ...base,
      reason: `attestor scored ${verdict.tranche_fraction} while answering satisfies_milestone=false — proceeding on the fraction`,
    });
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

  // Same rule for the second opinion: the verifier vetoes by pricing the work at
  // zero, not by a boolean that can contradict its own reasoning.
  if (opinion.tranche_fraction <= 0) {
    log({ event: 'vetoed', ...base, ...verification, reason: 'verifier values this work at nothing' });
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

  // The fraction IS the certification: how much of the milestone this work
  // satisfies. It no longer scales a per-release ceiling, which is what used to
  // cap an honest contributor at a quarter of the budget for finishing the job.
  //
  // Deliberately NOT clamped to accrual. Certification records what was EARNED;
  // the contract's `earned()` meters when it arrives. The agent may certify a
  // milestone complete on day one and the contributor still collects on
  // schedule — which is why one certification keeps paying with no further PRs.
  const desiredBps = BigInt(Math.round(agreedFraction * 10_000));

  // On-chain `certifiedBps` is monotonic, so a verdict at or below the standing
  // one reverts. Judging the same work twice — a redelivered webhook, a
  // reconcile after a restart — is normal and must not burn gas on a revert.
  if (desiredBps <= stream.certifiedBps) {
    log({
      event: 'skipped',
      ...base,
      ...verification,
      agreedFraction,
      reason: `already certified at ${Number(stream.certifiedBps) / 100}% — this verdict (${Number(desiredBps) / 100}%) would not raise it`,
    });
    return 'skipped';
  }

  // Meter to the policy rather than reverting against it. `maxTranche` caps how
  // much entitlement ONE attestation may create; exceeding it would revert and
  // throw the verdict away, when certification is monotonic and the remainder
  // can simply be added by the next judgment.
  const fullTarget = (stream.budget * desiredBps) / 10_000n;
  const headroom = stream.target + stream.maxTranche;
  const cappedTarget = fullTarget > headroom ? headroom : fullTarget;
  const certifiedBps = (cappedTarget * 10_000n) / stream.budget;
  const metered = certifiedBps < desiredBps;

  if (certifiedBps <= stream.certifiedBps) {
    log({
      event: 'skipped',
      ...base,
      ...verification,
      agreedFraction,
      reason: `policy maxTranche ${formatUsdc(stream.maxTranche)} leaves no room to raise certification above ${Number(stream.certifiedBps) / 100}%`,
    });
    return 'skipped';
  }

  const attestation: Attestation = {
    nonce: stream.nonce,
    certifiedBps,
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
  const result = await sendCertification(streamAddress, attestation, signature);
  const outcome: PipelineOutcome = result.state === 'COMPLETE' ? 'unlocked' : 'unlock_failed';

  log({
    event: outcome,
    ...base,
    ...verification,
    agreedFraction,
    certifiedPercent: Number(certifiedBps) / 100,
    // What this attestation added to the contributor's claim. The money itself
    // arrives on the stream's schedule, not here.
    trancheUsdc: formatUsdc(cappedTarget - stream.target),
    claimUsdc: formatUsdc(cappedTarget),
    meteredByPolicy: metered || undefined,
    nonce: Number(attestation.nonce),
    circleTransactionId: result.transactionId,
    state: result.state,
    txHash: result.txHash,
    errorReason: result.errorReason,
    explorer: result.txHash ? `https://testnet.arcscan.app/tx/${result.txHash}` : undefined,
  });

  return outcome;
}
