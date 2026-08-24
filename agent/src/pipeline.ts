// The judgment pipeline for one pull request, lifted out of the webhook
// handler so the Phase 5 seeder drives the SAME gates the live agent does.
// Duplicating these would let the demo and the product drift apart, and these
// gates are the product.
import { appendFileSync } from 'node:fs';
import { formatUsdc, matchesRepoSpec, parseRepoSpec } from '@proofstream/config';
import { readStream, sendCertification, signAttestation, type Attestation } from './chain';
import { checkCorrectness, type CorrectnessResult } from './correctness';
import { env, ledgerPath } from './env';
import { fetchDiff, fetchSourceFiles, type MergedPr } from './github';
import { meterCertification } from './metering';
import { buySecondOpinion } from './pay';
import { resolveStreams, type StreamEntry } from './registry';
import { serialize } from './serialize';
import { judge } from './verdict';

const LOG_PATH = ledgerPath('verdicts.jsonl');

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
  //
  // That orders the streams WITHIN one call only. Webhook deliveries start this
  // function unawaited and `reconcile()` runs alongside them, so judgments for a
  // single stream are serialized ACROSS calls as well: two overlapping ones read
  // the same nonce, both pay for a second opinion, and the loser reverts. See
  // serialize.ts.
  const outcomes: PipelineOutcome[] = [];
  for (const entry of entries) {
    try {
      outcomes.push(await serialize(entry.stream.toLowerCase(), () => judgeForStream(pr, entry)));
    } catch (err) {
      log({
        event: 'unlock_failed',
        workStream: entry.stream,
        repo: entry.repo,
        pr: pr.number,
        reason: `judgment threw: ${err instanceof Error ? err.message : String(err)}`,
        // NOTHING WAS JUDGED HERE, and `reconcile` must be able to tell.
        //
        // Its `alreadyJudged` counts any row carrying this pr and stream, so a
        // row written by this catch used to mean the pull request could never be
        // retried — by the one mechanism built to recover from exactly these
        // failures. An LLM 404 or a read-only ledger throws here, and every
        // subsequent restart then skips the pull request as already judged —
        // turning an ordinary config fault into a dead end.
        //
        // Deliberately narrow. `unlock_failed` also covers a send that reverted,
        // ran out of gas, or timed out — and those DID reach a verdict and paid
        // for a second opinion, so re-judging them would buy another opinion for
        // work already judged. Only a judgment that never happened is retryable.
        judged: false,
      });
      outcomes.push('unlock_failed');
    }
  }
  return outcomes;
}

/// Fetch what the correctness check needs and run it. Never throws.
///
/// TWO SNAPSHOTS OF THE REPOSITORY, and the second one is what makes the check
/// usable. Generated tests over-specify — they assert requirements the milestone
/// never stated — so a failure means nothing until it is measured against code
/// already known to be acceptable. That reference is the branch as it stood
/// BEFORE this merge: the work the employer already has, and already certified.
async function correctnessOf(pr: MergedPr, repo: string, milestone: string): Promise<CorrectnessResult> {
  if (!env.correctnessCheck) {
    return { outcome: 'unavailable', kept: [], discarded: [], filtered: false, passed: 0, total: 0, costUsd: 0, reason: 'the correctness check is switched off' };
  }

  const merged = await fetchSourceFiles(repo, pr.commitSha);
  // Missing on an event we could not fully read. Its absence costs the filter,
  // not the check: failures are then reported as unadjudicated rather than
  // being treated as defects.
  const reference = pr.baseSha ? await fetchSourceFiles(repo, pr.baseSha) : undefined;

  return checkCorrectness({ milestone, merged, reference });
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

  // DOES THE CODE DO WHAT THE MILESTONE ASKED, not merely contain something
  // that looks like it? The judgment below reads the code; this runs it. See
  // correctness.ts for why a failing test is evidence handed to the judge
  // rather than a payout gate of its own.
  //
  // IT RUNS BEFORE THE GATES THAT COULD REFUSE, and that costs money. Its
  // result is an input to the judgment, and the cheap gates below all need a
  // verdict before they can decide — so a redelivered webhook on a stream that
  // is already fully certified still pays for a check nothing will use. That is
  // a known cost, not an oversight; `alreadyJudged` is what bounds it on the
  // reconcile path.
  //
  // It never throws and it is never required: with the check off, or
  // unavailable, `judge` receives nothing and behaves exactly as it always has.
  const correctness = await correctnessOf(pr, want.repo, stream.milestone);

  const { verdict, costUsd, model } = await judge(pr, stream.milestone, diff, correctness);

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
    // Logged whenever it ran, INCLUDING when it concluded nothing. A check that
    // only appears in the ledger when it worked would make it look far more
    // reliable than it is, and "how often is this actually conclusive" is the
    // number we will want first.
    correctness: correctness.outcome === 'unavailable' ? undefined : correctness,
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

  // Cheapest gate that can refuse, and it has to come BEFORE the fee.
  //
  // The agreed fraction is min(attestor, verifier), so it can never exceed the
  // attestor's own: if THIS verdict already could not raise the standing
  // certification, no second opinion can rescue it. The equivalent check further
  // down runs after `buySecondOpinion`, so every redelivered webhook and every
  // reconcile pass over already-judged work spent $0.005 of the agent's money to
  // be told what the number on chain already said.
  const attestorBps = BigInt(Math.round(verdict.tranche_fraction * 10_000));
  if (attestorBps <= stream.certifiedBps) {
    log({
      event: 'skipped',
      ...base,
      reason: `already certified at ${Number(stream.certifiedBps) / 100}% — this verdict (${Number(attestorBps) / 100}%) cannot raise it, so no second opinion was bought`,
    });
    return 'skipped';
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
  // All of the certification arithmetic lives in `metering.ts` so it can be
  // tested without an .env or a chain (`pnpm test:metering`). It had none, and
  // it decides what a contributor is paid.
  const { desiredBps, certifiedBps, cappedTarget, trancheAdded, metered, raises } =
    meterCertification(agreedFraction, stream);

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

  // `meterCertification` clipped to the policy rather than letting the contract
  // revert: `maxTranche` caps how much entitlement ONE attestation may create,
  // and throwing the whole verdict away over it would be worse than certifying
  // part of it, because certification is monotonic and the next judgment can
  // add the remainder.
  if (!raises) {
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

  // COULD THE POLICY HAVE REFUSED THIS, OR DID WE NEVER GET AS FAR AS ASKING?
  //
  // `unlock_failed` covers both, and asserting the first — "THE CONTRACT
  // REFUSED THIS RELEASE ... because it would have exceeded the on-chain
  // limits" — is a claim about a release the contract may never have seen. The
  // identical certification, same percentage and same caps, can succeed
  // untouched minutes later, so the policy was never what stood in the way.
  //
  // We can tell the difference, because the agent already read the caps. It
  // METERS to `maxTranche`, so a per-certification violation is impossible by
  // construction; and a step at or under the daily ceiling cannot be the first
  // thing that day to breach it. When both hold, whatever refused this was not
  // the mandate, and claiming otherwise turns the strongest demo in the product
  // into a claim that does not survive being checked.
  const withinKnownPolicy = trancheAdded <= stream.maxTranche && trancheAdded <= stream.dailyUnlockCap;

  log({
    event: outcome,
    ...base,
    ...verification,
    agreedFraction,
    certifiedPercent: Number(certifiedBps) / 100,
    // What this attestation added to the contributor's claim. The money itself
    // arrives on the stream's schedule, not here.
    trancheUsdc: formatUsdc(trancheAdded),
    claimUsdc: formatUsdc(cappedTarget),
    meteredByPolicy: metered || undefined,
    // False means the send failed for a reason the mandate cannot explain:
    // gas, the estimator, the network. The UI must not call that a policy block.
    policyCouldExplain: outcome === 'unlock_failed' ? !withinKnownPolicy : undefined,
    nonce: Number(attestation.nonce),
    circleTransactionId: result.transactionId,
    state: result.state,
    txHash: result.txHash,
    errorReason: result.errorReason,
    explorer: result.txHash ? `https://testnet.arcscan.app/tx/${result.txHash}` : undefined,
  });

  return outcome;
}
