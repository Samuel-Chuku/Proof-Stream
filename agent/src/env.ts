// Env for the attestor agent. Fails loudly at startup rather than at the
// moment a webhook arrives — a missing key mid-demo is the worst time to find
// out. AGENT_INGRESS_URL is the single knob for where GitHub reaches us (T7),
// so the tunnel can be swapped for a VPS without touching code.
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set — see .env.example`);
  return value;
}

// One agent serves many streams. It finds them one of two ways, and it must
// have at least one of them or it would sit there watching nothing:
//
//   REGISTRY_ADDRESS   multi-tenant. Read StreamRegistered logs, filtered to
//                      the streams that appointed THIS agent.
//   WORKSTREAM_ADDRESS single-stream fallback, the original setup. Still
//                      supported on purpose — a technical user with one repo
//                      should not have to deploy a registry.
//
// Both may be set: the registry supplies the fleet and WORKSTREAM_ADDRESS is
// folded in as a seed entry, so an existing deployment keeps working the day
// the registry appears.
function requireOneOf(...names: string[]): void {
  if (names.some((n) => process.env[n])) return;
  throw new Error(`set one of ${names.join(' or ')} — see .env.example`);
}

requireOneOf('REGISTRY_ADDRESS', 'WORKSTREAM_ADDRESS');

export const env = {
  arcRpcUrl: process.env.ARC_RPC_URL || 'https://rpc.testnet.arc.network',
  workStream: process.env.WORKSTREAM_ADDRESS as `0x${string}` | undefined,

  registryAddress: process.env.REGISTRY_ADDRESS as `0x${string}` | undefined,
  // Where to start scanning. Genesis would be both slow and pointless, and
  // Arc caps a getLogs window at 100k blocks (~14 hours at 0.51s blocks), so
  // the scan is paged from here. Override when you deploy your own registry.
  registryDeployBlock: BigInt(process.env.REGISTRY_DEPLOY_BLOCK || '54593230'),
  // How often to re-scan for newly registered streams.
  registryRefreshMs: Number(process.env.REGISTRY_REFRESH_MS || 60_000),

  circleApiKey: required('CIRCLE_API_KEY'),
  entitySecret: required('ENTITY_SECRET'),
  agentWalletId: required('AGENT_WALLET_ID'),
  agentAddress: required('AGENT_ADDRESS') as `0x${string}`,

  githubRepo: required('GITHUB_REPO'),
  githubToken: required('GITHUB_TOKEN'),
  webhookSecret: required('GITHUB_WEBHOOK_SECRET'),

  openRouterKey: required('OPENROUTER_API_KEY'),

  // FREE by default. Development and seeding replay the same judgments many
  // times over; paying frontier prices for that is waste. Both free models were
  // checked against a known-good and a known-bad diff and matched
  // claude-sonnet-5's verdicts. Override with a paid model for the recorded
  // demo, where reasoning quality is what is on screen.
  model: process.env.AGENT_MODEL || 'openai/gpt-oss-20b:free',

  port: Number(process.env.PORT || 8787),
  ingressUrl: process.env.AGENT_INGRESS_URL || '(not set — tunnel URL goes here)',

  // Below this the agent escalates to a human instead of unlocking (T5d).
  confidenceThreshold: Number(process.env.AGENT_CONFIDENCE_THRESHOLD || 0.7),

  // --- verifier agent (Phase 3) -------------------------------------------
  // Its own Circle wallet, its own process, its own model. The seller side
  // only ever needs the address: Gateway credits it, it holds no key here.
  verifierAddress: required('VERIFIER_ADDRESS') as `0x${string}`,
  verifierPort: Number(process.env.VERIFIER_PORT || 8788),
  verifierUrl: process.env.VERIFIER_URL || 'http://localhost:8788/verify',

  // A different vendor on purpose — a second opinion from the same model is
  // not a second opinion. Free tier by default, same reasoning as above.
  verifierModel: process.env.VERIFIER_MODEL || 'cohere/north-mini-code:free',
};
