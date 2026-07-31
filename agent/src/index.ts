import { createServer } from 'node:http';
import { env } from './env';
import { parseMergedPr, verifySignature, webhookSecretFor } from './github';
import { log, processPr } from './pipeline';
import { isServed, knownStreams, startRegistry } from './registry';

// Per-stream ingress. GitHub signs each delivery with the secret configured on
// that repo's webhook, and each stream has its own (see webhookSecretFor), so
// the path tells us which secret to check the signature against. The legacy
// `/webhook` path keeps working against the master secret for the original
// single-stream setup.
const STREAM_ROUTE = /^\/webhook\/(0x[0-9a-fA-F]{40})$/;

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

  const match = req.url ? STREAM_ROUTE.exec(req.url) : null;
  const legacy = req.url === '/webhook';

  if (req.method !== 'POST' || (!match && !legacy)) {
    res.writeHead(404).end();
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
    const secret = routedStream ? webhookSecretFor(routedStream) : env.webhookSecret;

    if (!verifySignature(raw, req.headers['x-hub-signature-256'] as string | undefined, secret)) {
      log({ event: 'rejected', stream: routedStream, reason: 'bad webhook signature' });
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
});
