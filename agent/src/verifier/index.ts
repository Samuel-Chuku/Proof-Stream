// The verifier agent: a real x402 seller on Arc testnet. It is a separate
// process with its own Circle wallet and its own model, and it earns USDC per
// call through Circle Gateway nanopayments.
//
// Independence is the whole point, so it takes only a PR number from the payer
// and gathers the evidence itself: the milestone comes from the WorkStream
// contract, the diff from GitHub. A verifier that grades the buyer's own copy
// of the evidence is not a check on the buyer.
import { appendFileSync } from 'node:fs';
import { createGatewayMiddleware } from '@circle-fin/x402-batching/server';
import { ARC_CAIP2, GATEWAY_FACILITATOR_URL, REASONING, VERIFICATION_FEE, VERIFIER_MAX_TOKENS, formatUsdc } from '@proofstream/config';
import express from 'express';
import { isAddress } from 'viem';
import { readStream } from '../chain';
import { env } from '../env';
import { fetchDiff } from '../github';
import { review } from './review';

const LOG_PATH = new URL('../../reviews.jsonl', import.meta.url).pathname;

function log(entry: Record<string, unknown>) {
  const line = { at: new Date().toISOString(), ...entry };
  appendFileSync(LOG_PATH, `${JSON.stringify(line)}\n`);
  console.log(JSON.stringify(line));
}

type PaidRequest = express.Request & {
  payment?: { verified: boolean; payer: string; amount: string; network: string; transaction?: string };
};

const app = express();
app.use(express.json());

// facilitatorUrl defaults to MAINNET in the SDK. Arc testnet only (§3).
const gateway = createGatewayMiddleware({
  sellerAddress: env.verifierAddress,
  facilitatorUrl: GATEWAY_FACILITATOR_URL,
  networks: [ARC_CAIP2],
  description: 'ProofStream independent milestone verification',
});

// maxTokens is reported so the preflight can tell whether this process is
// running current code. A stale seller is invisible otherwise — the buyer pays
// in full and only then finds out (it cost three paid calls to learn that).
app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    verifier: env.verifierAddress,
    price: VERIFICATION_FEE,
    model: env.verifierModel,
    maxTokens: VERIFIER_MAX_TOKENS,
    reasoning: REASONING,
  });
});

app.post('/verify', gateway.require(VERIFICATION_FEE), async (req: PaidRequest, res) => {
  const prNumber = Number(req.body?.prNumber);
  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    res.status(400).json({ error: 'prNumber must be a positive integer' });
    return;
  }

  // The buyer names the stream; the fallback keeps single-stream setups working
  // unchanged. This is a POINTER to evidence, not the evidence: everything
  // judged below is read from that contract and from GitHub, never from the
  // request body. A buyer can choose which stream it pays to have reviewed —
  // it cannot choose what the review finds.
  const streamAddress = (req.body?.stream ?? env.workStream) as `0x${string}` | undefined;
  if (!streamAddress || !isAddress(streamAddress)) {
    res.status(400).json({ error: 'stream must be a contract address' });
    return;
  }

  const payment = req.payment;

  try {
    const stream = await readStream(streamAddress);
    const diff = await fetchDiff(stream.repo, prNumber);
    const { review: verdict, costUsd, model } = await review(prNumber, stream.milestone, diff);

    log({
      event: 'reviewed',
      pr: prNumber,
      workStream: streamAddress,
      repo: stream.repo,
      milestone: stream.milestone,
      model,
      inferenceCostUsd: costUsd,
      review: verdict,
      paidBy: payment?.payer,
      feeUsdc: payment ? formatUsdc(BigInt(payment.amount)) : undefined,
      network: payment?.network,
      gatewayTransfer: payment?.transaction,
    });

    res.json({
      pr: prNumber,
      milestoneHash: stream.milestoneHash,
      model,
      ...verdict,
    });
  } catch (err) {
    // The payment has already settled at this point — say so plainly rather
    // than pretending the call was free.
    const message = err instanceof Error ? err.message : String(err);
    log({
      event: 'review_failed',
      pr: prNumber,
      workStream: streamAddress,
      message,
      gatewayTransfer: payment?.transaction,
    });
    res.status(500).json({ error: message });
  }
});

app.listen(env.verifierPort, () => {
  console.log(`verifier listening on :${env.verifierPort}`);
  console.log(`  seller wallet: ${env.verifierAddress}`);
  console.log(`  price:         ${VERIFICATION_FEE} per call, ${ARC_CAIP2}`);
  console.log(`  model:         ${env.verifierModel}`);
  console.log(`  reasoning:     ${JSON.stringify(REASONING)}`);
  console.log(`  facilitator:   ${GATEWAY_FACILITATOR_URL}`);
});
