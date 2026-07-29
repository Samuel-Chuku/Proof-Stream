// Env for the attestor agent. Fails loudly at startup rather than at the
// moment a webhook arrives — a missing key mid-demo is the worst time to find
// out. AGENT_INGRESS_URL is the single knob for where GitHub reaches us (T7),
// so the tunnel can be swapped for a VPS without touching code.
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set — see .env.example`);
  return value;
}

export const env = {
  arcRpcUrl: process.env.ARC_RPC_URL || 'https://rpc.testnet.arc.network',
  workStream: required('WORKSTREAM_ADDRESS') as `0x${string}`,

  circleApiKey: required('CIRCLE_API_KEY'),
  entitySecret: required('ENTITY_SECRET'),
  agentWalletId: required('AGENT_WALLET_ID'),
  agentAddress: required('AGENT_ADDRESS') as `0x${string}`,

  githubRepo: required('GITHUB_REPO'),
  githubToken: required('GITHUB_TOKEN'),
  webhookSecret: required('GITHUB_WEBHOOK_SECRET'),

  openRouterKey: required('OPENROUTER_API_KEY'),
  model: process.env.AGENT_MODEL || 'anthropic/claude-sonnet-5',

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
  // not a second opinion.
  verifierModel: process.env.VERIFIER_MODEL || 'google/gemini-2.5-pro',
};
