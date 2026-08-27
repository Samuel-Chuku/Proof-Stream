import { exists, PACKAGE_ROOT } from '../lib/files.mjs';
import { join } from 'node:path';

const topics = {
  concepts: 'references/concepts.md',
  architecture: 'references/architecture.md',
  lifecycle: 'references/lifecycle-and-money-flow.md',
  integration: 'references/integration-guide.md',
  contracts: 'references/contracts.md',
  certification: 'references/contracts.md',
  payout: 'references/integration-guide.md',
  cli: 'references/cli.md',
  agent: 'references/agents-and-verification.md',
  evidence: 'references/evidence-and-audit-trail.md',
  security: 'references/security.md',
  react: 'references/ui-ux.md',
  ui: 'references/ui-ux.md',
  operations: 'references/operations.md',
  troubleshooting: 'references/troubleshooting.md',
  limitations: 'references/limitations.md',
  creative: 'references/creative-production.md',
  media: 'references/creative-production.md',
  flyer: 'references/creative-production.md',
  banner: 'references/creative-production.md',
  social: 'references/creative-production.md',
  video: 'references/creative-production.md',
};

export async function docs(topic, { path = false } = {}) {
  if (!topic) return { topics: Object.keys(topics).sort(), root: PACKAGE_ROOT };
  const rel = topics[topic.toLowerCase()];
  if (!rel || !(await exists(join(PACKAGE_ROOT, rel)))) throw new Error(`Unknown documentation topic: ${topic}`);
  return path ? join(PACKAGE_ROOT, rel) : { topic, file: rel };
}
