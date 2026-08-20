import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { env, ledgerPath } from './env';
import { parseMergedPr, verifySignature, webhookSecretFor } from './github';
import { log, processPr } from './pipeline';
import { reconcile } from './reconcile';
import { isServed, knownStreams, startRegistry } from './registry';

// Three ways in, and the difference between them is only WHICH SECRET signs the
// delivery. Routing to a stream is identical afterwards: by repository, through
// the registry.
//
//   /webhook/github  the GitHub App. One URL and one secret for every
//                    installation — installing the App on a repo is what
//                    subscribes it, so there are no per-repo webhooks to create.
//   /webhook/0x…     manual setup, signed with that stream's derived secret.
//                    This is the terminal path: `pnpm webhook:secret <stream>`.
//   /webhook         the original single-stream fallback, master secret.
const STREAM_ROUTE = /^\/webhook\/(0x[0-9a-fA-F]{40})$/;
const APP_ROUTE = '/webhook/github';

/// The agents' logs, served so the dashboard does not need to share a
/// filesystem with the agent. Everything here is already public — reasoning,
/// costs, transaction hashes — and is the same material EVIDENCE.md is built
/// from, so it is deliberately unauthenticated.
function readLog(file: string, limit: number): unknown[] {
  try {
    const raw = readFileSync(ledgerPath(file), 'utf8');
    return raw
      .split('\n')
      .filter(Boolean)
      .slice(-limit)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

// Registry activity is operational plumbing, not judgment, so it goes to stdout
// and NOT into verdicts.jsonl. That file is the decision ledger the dashboard
// and EVIDENCE.md read; a scan or a refusal appearing there as a row with no PR
// and no verdict is noise in the one artifact a judge actually reads.
const registryLog = (entry: Record<string, unknown>) =>
  console.log(JSON.stringify({ at: new Date().toISOString(), ...entry }));

createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        ok: true,
        agent: env.agentAddress,
        registry: env.registryAddress,
        streams: knownStreams().map((s) => ({ stream: s.stream, repo: s.repo })),
      }),
    );
    return;
  }

  const url = req.url ?? '';

  if (req.method === 'GET' && url.startsWith('/events')) {
    const limit = Math.min(Number(new URL(url, 'http://x').searchParams.get('limit') ?? 500) || 500, 2000);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        verdicts: readLog('verdicts.jsonl', limit),
        reviews: readLog('reviews.jsonl', limit),
        payouts: readLog('payouts.jsonl', limit),
      }),
    );
    return;
  }

  const isApp = url === APP_ROUTE;
  const match = STREAM_ROUTE.exec(url);
  const legacy = url === '/webhook';

  if (req.method !== 'POST' || (!isApp && !match && !legacy)) {
    res.writeHead(404).end();
    return;
  }

  // An App delivery cannot be verified without the App's secret, and accepting
  // it unverified would let anyone who finds the URL trigger a payout.
  if (isApp && !env.githubAppWebhookSecret) {
    log({ event: 'rejected', reason: 'GITHUB_APP_WEBHOOK_SECRET is not set — App deliveries cannot be verified' });
    res.writeHead(503).end();
    return;
  }

  const routedStream = match?.[1];

  // Refuse a stream this agent does not serve BEFORE doing any work. Answering
  // 404 rather than 401 is deliberate: an unknown stream is not a credential
  // failure, and we should not imply the address exists.
  if (routedStream && !isServed(routedStream)) {
    log({ event: 'rejected', stream: routedStream, reason: 'not a stream this agent serves' });
    res.writeHead(404).end();
    return;
  }

  let raw = '';
  req.on('data', (chunk) => {
    raw += chunk;
  });
  req.on('end', () => {
    const secret = isApp
      ? (env.githubAppWebhookSecret as string)
      : routedStream
        ? webhookSecretFor(routedStream)
        : env.webhookSecret;

    if (!verifySignature(raw, req.headers['x-hub-signature-256'] as string | undefined, secret)) {
      log({ event: 'rejected', stream: routedStream, source: isApp ? 'app' : 'manual', reason: 'bad webhook signature' });
      res.writeHead(401).end();
      return;
    }

    // Acknowledge immediately, then work — GitHub times deliveries out after
    // ~10s and the pipeline takes far longer.
    res.writeHead(202).end();

    if (req.headers['x-github-event'] !== 'pull_request') return;
    const pr = parseMergedPr(JSON.parse(raw));
    if (!pr) return;

    processPr(pr).catch((err) =>
      log({ event: 'error', message: err instanceof Error ? err.message : String(err) }),
    );
  });
}).listen(env.port, async () => {
  console.log(`attestor listening on :${env.port}`);
  console.log(`  agent wallet: ${env.agentAddress}`);
  console.log(`  registry:     ${env.registryAddress ?? '(none — single-stream mode)'}`);
  console.log(`  ingress:      ${env.ingressUrl}`);
  console.log(`  model:        ${env.model}`);
  console.log(`  github app:   ${env.githubAppWebhookSecret ? 'POST /webhook/github' : 'not configured'}`);

  // Discover the fleet before announcing readiness, so the startup banner shows
  // what this process will actually serve rather than an empty list.
  await startRegistry(registryLog);
  const streams = knownStreams();
  if (streams.length === 0) {
    console.log('  streams:      NONE — no registered stream appoints this agent');
  }
  for (const s of streams) {
    console.log(`  serving:      ${s.repo} → ${s.stream}`);
  }

  // Catch anything merged while this process was not listening. Runs after the
  // fleet is known, and deliberately does not block startup — the webhook
  // endpoint is already accepting deliveries by now.
  reconcile(registryLog, processPr).catch((err) =>
    registryLog({ event: 'reconcile_failed', message: err instanceof Error ? err.message : String(err) }),
  );
});
