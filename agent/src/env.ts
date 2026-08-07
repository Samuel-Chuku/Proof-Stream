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

/// First name wins; the later ones are legacy aliases kept so an existing
/// .env does not break when a variable is renamed.
function required2(...names: string[]): string {
  for (const n of names) {
    const value = process.env[n];
    if (value) return value;
  }
  throw new Error(`set ${names[0]} (or ${names.slice(1).join('/')}) — see .env.example`);
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

  /// How long after a milestone's end date the agent keeps certifying work.
  ///
  /// Earning and certifying are separate events with real time between them. A
  /// pull request merged minutes before the end still has to be fetched,
  /// judged, verified, signed and sent — so a hard stop at the end date would
  /// leave money that was genuinely earned permanently unpayable, and
  /// `closeMilestone` would refund it to the EMPLOYER. That is the contributor
  /// losing pay to a race they do not control.
  ///
  /// But the window must not be unbounded: the contract's `unlock` has no
  /// end-date check at all, so without this an unrelated merge months later
  /// still releases from a stream everyone considered finished. Four hours is
  /// long enough to absorb any plausible delivery delay and short enough that a
  /// finished stream stops being armed the same day.
  ///
  /// This is ROUTING, not a security boundary — a malicious agent could ignore
  /// it. What bounds a compromised key is the on-chain policy (T1/T6).
  milestoneGraceHours: Number(process.env.MILESTONE_GRACE_HOURS ?? 4),

  circleApiKey: required('CIRCLE_API_KEY'),
  entitySecret: required('ENTITY_SECRET'),
  agentWalletId: required('AGENT_WALLET_ID'),
  agentAddress: required('AGENT_ADDRESS') as `0x${string}`,

  // No GITHUB_REPO here any more. A multi-tenant agent has no single "the
  // repo" — each stream names its own on-chain, and the registry routes on
  // that. Requiring it would refuse to start a fleet agent over a value it
  // never reads. Deploy.s.sol still uses GITHUB_REPO when creating a stream.
  githubToken: required('GITHUB_TOKEN'),

  // --- GitHub App --------------------------------------------------------
  // A GitHub App has ONE webhook URL and ONE secret, set on the App itself;
  // installing it on a repo is what subscribes that repo. So there are no
  // per-repo webhooks to create, and deliveries for every installation arrive
  // together carrying `repository.full_name` — which is all the registry needs
  // to route them. Optional: without it the manual per-stream path still works.
  githubAppWebhookSecret: process.env.GITHUB_APP_WEBHOOK_SECRET,

  // --- missed-webhook recovery -------------------------------------------
  // GitHub discards a delivery after a few failed retries, so a PR merged
  // while the agent was down is never judged and nobody is paid. On startup
  // the agent looks back over this window for merged PRs with no verdict.
  // Both bounds matter: this spends money without being asked, and an
  // unbounded lookback against a repo with history would judge years of old
  // work on first run. Set either to 0 to disable.
  reconcileLookbackHours: Number(process.env.RECONCILE_LOOKBACK_HOURS ?? 24),
  reconcileMaxPrs: Number(process.env.RECONCILE_MAX_PRS ?? 5),
  webhookSecret: required('GITHUB_WEBHOOK_SECRET'),

  // --- LLM provider (any OpenAI-compatible endpoint) -----------------------
  // Ollama, Together, Groq, vLLM, a local model — anything that serves
  // POST {base}/chat/completions. Only the base URL changes.
  llmBaseUrl: (process.env.LLM_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/+$/, ''),

  // LLM_API_KEY is the name to use. OPENROUTER_API_KEY still works so existing
  // setups keep running, and a local provider that wants no key can pass any
  // placeholder rather than being forced to invent one.
  llmApiKey: required2('LLM_API_KEY', 'OPENROUTER_API_KEY'),

  // FREE by default. Development and seeding replay the same judgments many
  // times over; paying frontier prices for that is waste. Both free models were
  // checked against a known-good and a known-bad diff and matched
  // claude-sonnet-5's verdicts. Override with a paid model for the recorded
  // demo, where reasoning quality is what is on screen.
  model: process.env.AGENT_MODEL || 'openai/gpt-oss-20b:free',

  port: Number(process.env.PORT || 8787),
  ingressUrl: process.env.AGENT_INGRESS_URL || '(not set — tunnel URL goes here)',

  // Below this the agent releases nothing and stops (T5d). Nothing reviews it —
  // there is no queue and no appeal; the work waits for a later pull request.
  confidenceThreshold: Number(process.env.AGENT_CONFIDENCE_THRESHOLD || 0.7),

  // --- verifier agent (Phase 3) -------------------------------------------
  // Its own Circle wallet, its own process, its own model. The seller side
  // only ever needs the address: Gateway credits it, it holds no key here.
  verifierAddress: required('VERIFIER_ADDRESS') as `0x${string}`,
  verifierPort: Number(process.env.VERIFIER_PORT || 8788),
  verifierUrl: process.env.VERIFIER_URL || 'http://localhost:8788/verify',

  // A different vendor on purpose — a second opinion from the same model is
  // not a second opinion. Free tier by default, same reasoning as above.
  //
  // Was `cohere/north-mini-code:free`, which could not return a verdict at all:
  // it expands its reasoning to fill whatever `max_tokens` it is given (9511
  // against a 8000 ceiling, then 27476 against 24000), so every review arrived
  // truncated and every one was PAID FOR — x402 settles before the handler runs.
  //
  // Chosen against the alternatives on a real diff with `pnpm review:test`, and
  // the negative control is what picked it: given the same diff and a milestone
  // it does not satisfy, it returns `satisfies=false, fraction 0` with specific
  // red flags rather than rubber-stamping (T5).
  //
  // `nvidia/nemotron-3-super-120b-a12b:free` was rejected, and HOW it failed is
  // the point. It judged the easy case correctly in seconds, then on the
  // mismatch spent 8384 completion tokens of which 8384 were reasoning — every
  // single one — and returned nothing after seven minutes. Same class of
  // failure as the model it would have replaced, and it only appeared on the
  // case that needed judgment. **A verifier must be qualified on a diff that
  // does NOT satisfy the milestone.** Testing only the happy path would have
  // shipped this one.
  //
  // The default stays on the FREE tier so a stranger who clones this is never
  // billed by surprise. For a recorded run set VERIFIER_MODEL to the paid slug
  // `poolside/laguna-s-2.1` — the same model on dedicated capacity, off the
  // shared free pool and its 429s. Measured on both cases above: $0.0003 to
  // approve, $0.0001 to refuse, verdicts identical to the free tier.
  //
  // That price is the interesting part. VERIFICATION_FEE is $0.005, so at
  // ~$0.0002 a review the verifier finally earns more than it spends. It has
  // sold at a loss since Phase 3 (roadmap R1) — $0.005 charged against
  // $0.0103-$0.0124 of measured inference, about 6x underwater on every call.
  verifierModel: process.env.VERIFIER_MODEL || 'poolside/laguna-s-2.1:free',
};
