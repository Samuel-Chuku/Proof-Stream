import { createServer } from 'node:http';
import { env } from './env';
import { parseMergedPr, verifySignature } from './github';
import { log, processPr } from './pipeline';

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
}).listen(env.port, () => {
  console.log(`attestor listening on :${env.port}`);
  console.log(`  agent wallet: ${env.agentAddress}`);
  console.log(`  WorkStream:   ${env.workStream}`);
  console.log(`  ingress:      ${env.ingressUrl}`);
  console.log(`  model:        ${env.model}`);
});
