import { appendFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { formatUsdc } from '@proofstream/config';
import { readStream, sendUnlock, signAttestation, type Attestation } from './chain';
import { env } from './env';
import { fetchDiff, parseMergedPr, verifySignature } from './github';
import { judge } from './verdict';

const LOG_PATH = new URL('../verdicts.jsonl', import.meta.url).pathname;

function log(entry: Record<string, unknown>) {
  const line = { at: new Date().toISOString(), ...entry };
  appendFileSync(LOG_PATH, `${JSON.stringify(line)}\n`);
  console.log(JSON.stringify(line));
}

/// The full pipeline for one merged PR. Runs detached from the HTTP response
/// because GitHub times deliveries out after ~10s and this takes far longer.
async function handleMerge(payload: unknown) {
  const pr = parseMergedPr(payload);
  if (!pr) return;

  const stream = await readStream();
  if (stream.paused) {
    log({ event: 'skipped', pr: pr.number, reason: 'stream is paused' });
    return;
  }

  const diff = await fetchDiff(pr.number);
  const { verdict, costUsd, model } = await judge(pr, stream.milestone, diff);

  const base = {
    pr: pr.number,
    title: pr.title,
    commitSha: pr.commitSha,
    milestone: stream.milestone,
    model,
    inferenceCostUsd: costUsd,
    verdict,
  };

  // Judgment gates, in order. Each of these is a decision the agent makes on
  // its own — none of them is "the PR merged, therefore pay" (T5).
  if (!verdict.satisfies_milestone) {
    log({ event: 'declined', ...base, reason: 'work does not satisfy the milestone' });
    return;
  }
  if (verdict.confidence < env.confidenceThreshold) {
    log({
      event: 'escalated',
      ...base,
      reason: `confidence ${verdict.confidence} below threshold ${env.confidenceThreshold}`,
    });
    return;
  }

  // tranche_fraction scales the policy ceiling, then the stream's own accrual
  // caps it — the agent can never certify money that has not been earned yet.
  const available = stream.accrued - stream.unlocked;
  const desired = (stream.maxTranche * BigInt(Math.round(verdict.tranche_fraction * 10_000))) / 10_000n;
  const tranche = desired < available ? desired : available;

  if (tranche <= 0n) {
    log({ event: 'skipped', ...base, reason: 'nothing accrued to unlock yet' });
    return;
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

  const signature = await signAttestation(attestation);
  const result = await sendUnlock(attestation, signature);

  log({
    event: result.state === 'COMPLETE' ? 'unlocked' : 'unlock_failed',
    ...base,
    trancheUsdc: formatUsdc(tranche),
    nonce: Number(attestation.nonce),
    circleTransactionId: result.transactionId,
    state: result.state,
    txHash: result.txHash,
    errorReason: result.errorReason,
    explorer: result.txHash ? `https://testnet.arcscan.app/tx/${result.txHash}` : undefined,
  });
}

createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, agent: env.agentAddress, workStream: env.workStream }));
    return;
  }

  if (req.method !== 'POST' || req.url !== '/webhook') {
    res.writeHead(404).end();
    return;
  }

  let raw = '';
  req.on('data', (chunk) => {
    raw += chunk;
  });
  req.on('end', () => {
    if (!verifySignature(raw, req.headers['x-hub-signature-256'] as string | undefined)) {
      log({ event: 'rejected', reason: 'bad webhook signature' });
      res.writeHead(401).end();
      return;
    }

    // Acknowledge immediately, then work.
    res.writeHead(202).end();

    if (req.headers['x-github-event'] !== 'pull_request') return;
    handleMerge(JSON.parse(raw)).catch((err) =>
      log({ event: 'error', message: err instanceof Error ? err.message : String(err) }),
    );
  });
}).listen(env.port, () => {
  console.log(`attestor listening on :${env.port}`);
  console.log(`  agent wallet: ${env.agentAddress}`);
  console.log(`  WorkStream:   ${env.workStream}`);
  console.log(`  ingress:      ${env.ingressUrl}`);
  console.log(`  model:        ${env.model}`);
});
