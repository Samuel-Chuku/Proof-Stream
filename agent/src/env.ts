// Env for the attestor agent. Fails loudly at startup rather than at the
// moment a webhook arrives — a missing key mid-demo is the worst time to find
// out. AGENT_INGRESS_URL is the single knob for where GitHub reaches us (T7),
// so the tunnel can be swapped for a VPS without touching code.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

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

/// Where the runtime ledgers live: `verdicts.jsonl` and `reviews.jsonl`.
///
/// Defaults to `agent/` inside the checkout, which is right for local
/// development and WRONG for a deployed host. On the VPS these files are
/// written by a running process while that same directory is a deploy target,
/// so every `git pull`, `git checkout` or fresh clone competes with them.
///
/// A deploy that overwrites `verdicts.jsonl` with a committed snapshot destroys
/// every decision the running agent has recorded. Untracking the files stops
/// `git pull`, but NOT `git clean -fdx`, a fresh clone, or an rsync with
/// `--delete`. Moving the directory OUT of the checkout is what makes it
/// permanent, because no git operation can reach a path git does not manage.
///
/// Set `PROOFSTREAM_LOG_DIR` to a path outside the repo, e.g.
/// `/var/lib/proofstream`. `||` not `??`: a blank value in a copied .env must
/// mean "default", not an empty path that resolves to the filesystem root.
const LOG_DIR = process.env.PROOFSTREAM_LOG_DIR || new URL('../', import.meta.url).pathname;

/// Absolute path to one ledger, creating the directory on first use.
///
/// The mkdir matters: on a fresh host the first append would otherwise throw
/// mid-judgment, AFTER the agent has already paid the verifier for its second
/// opinion. Losing the money and the record together is the worst version of
/// this failure.
export function ledgerPath(name: string): string {
  mkdirSync(LOG_DIR, { recursive: true });
  return join(LOG_DIR, name);
}

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
  /// `||`, not `??`: a blank line in a copied .env is present-but-empty, which
  /// `??` passes straight through to Number('') === 0. Here that would end the
  /// grace window instantly and strand work merged near the deadline. An
  /// explicit '0' still wins, because '0' is a truthy string.
  milestoneGraceHours: Number(process.env.MILESTONE_GRACE_HOURS || 4),

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
  /// Telegram alerts (telegram.ts, alerts.ts). Unset means none, said once.
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
  /// Where alerts send people. The app, not the agent.
  appUrl: (process.env.PUBLIC_APP_URL || 'https://app.proofstream.site').replace(/\/$/, ''),
  /// Email alerts (email.ts). Any provider taking {from,to,subject,text}
  /// works; no provider name belongs in this repository. All three unset
  /// means no email, said once.
  emailApiUrl: process.env.EMAIL_API_URL,
  emailApiKey: process.env.EMAIL_API_KEY,
  emailFrom: process.env.EMAIL_FROM,
  /// The day's send ceiling across every stream, kept under a free tier's
  /// limit on purpose.
  emailDailyMax: Number(process.env.EMAIL_DAILY_MAX || 80),
  /// And per stream per day, so one busy stream cannot spend the whole budget
  /// and leave another stream's deadline unannounced. Four covers the three
  /// timed alerts plus one judgment; a stream with more judgments than that in
  /// a day is having a busy day on Telegram.
  emailMaxPerStreamPerDay: Number(process.env.EMAIL_MAX_PER_STREAM_PER_DAY || 4),

  // --- missed-webhook recovery -------------------------------------------
  // GitHub discards a delivery after a few failed retries, so a PR merged
  // while the agent was down is never judged and nobody is paid. On startup
  // the agent looks back over this window for merged PRs with no verdict.
  // Both bounds matter: this spends money without being asked, and an
  // unbounded lookback against a repo with history would judge years of old
  // work on first run. Set either to 0 to disable.
  // `||` for the same reason as above. Setting either to '0' still disables
  // reconciliation as documented; leaving one BLANK now means "default" rather
  // than silently meaning "off".
  reconcileLookbackHours: Number(process.env.RECONCILE_LOOKBACK_HOURS || 24),
  reconcileMaxPrs: Number(process.env.RECONCILE_MAX_PRS || 5),
  /// How often to sweep for merges the webhook never delivered. Zero sweeps
  /// once at startup and never again, which is how this behaved before the
  /// loop existed.
  reconcileEveryMinutes: Number(process.env.RECONCILE_EVERY_MINUTES || 15),
  /// Whether the sweep also resumes certifications the policy clipped. On by
  /// default because leaving it off is what refunded 67 USDC of agreed work
  /// to an employer; `off` is the kill switch, since this sends transactions
  /// with no merge behind them.
  resumeClipped: (process.env.RESUME_CLIPPED || 'on') !== 'off',
  webhookSecret: required('GITHUB_WEBHOOK_SECRET'),

  // --- Inference provider --------------------------------------------------
  // Anything serving POST {base}/chat/completions, hosted or local. Only the
  // base URL changes.
  //
  // REQUIRED, WITH NO DEFAULT, and the same goes for every model below. A
  // default would put one provider's name and one vendor's model slug in a
  // public file and make them this project's implied recommendation. Which
  // provider and which model you run is your decision and your bill.
  llmBaseUrl: required('LLM_BASE_URL').replace(/\/+$/, ''),

  // A provider wanting no key at all can pass any placeholder rather than being
  // forced to invent one.
  llmApiKey: required('LLM_API_KEY'),

  /// The model that judges merged work.
  ///
  /// Qualify any model before trusting it here, on a diff that does NOT satisfy
  /// the milestone as well as one that does. A model that cannot tell them
  /// apart does not error; it approves, in the direction that releases money.
  model: required('AGENT_MODEL'),

  /// Tried in order when the primary is rate-limited or unavailable. Shared
  /// capacity means a 429 says nothing about this project's usage and
  /// everything about who else is busy, and a stream that happens to merge
  /// during someone else's spike would otherwise get no judgment at all.
  /// Comma-separated; blank disables fallback.
  fallbackModels: (process.env.AGENT_FALLBACK_MODELS ?? '')
    .split(',').map((m) => m.trim()).filter(Boolean),

  port: Number(process.env.PORT || 8787),
  ingressUrl: process.env.AGENT_INGRESS_URL || '(not set — tunnel URL goes here)',

  // Below this the agent releases nothing and stops (T5d). Nothing reviews it —
  // there is no queue and no appeal; the work waits for a later pull request.
  confidenceThreshold: Number(process.env.AGENT_CONFIDENCE_THRESHOLD || 0.7),

  // --- the correctness check ----------------------------------------------
  //
  // OFF BY DEFAULT. It needs an isolated execution environment configured and
  // costs inference on every judgment, so it is opt-in: a clone runs the same
  // system whether or not one is available.
  //
  // Off, the agents judge whether the milestone's work is PRESENT in the code.
  // On, a suite generated from the milestone is executed against the merged
  // code and the result becomes evidence in that judgment. It never becomes the
  // judgment itself — see correctness.ts for why a failing test may not be
  // wired straight to a payout.
  correctnessCheck: process.env.CORRECTNESS_CHECK === 'on',

  /// THE MODEL IS THE MAIN CONTROL HERE, not a tuning detail. It moves this
  /// result far more than any prompt does.
  ///
  /// Qualify any model before trusting it. A weak oracle does not error — it
  /// writes a suite that passes everything and reports the code correct, so the
  /// check degrades into a rubber stamp pointing in the direction that releases
  /// money. It needs to write a suite that compiles AND discriminates, which is
  /// a harder job than judging a diff.
  ///
  /// Required only when the check is switched on, so a clone that never uses it
  /// is not asked to choose a model for it.
  oracleModel: process.env.CORRECTNESS_CHECK === 'on' ? required('ORACLE_MODEL') : (process.env.ORACLE_MODEL ?? ''),

  /// Wall-clock ceiling for one suite run in the sandbox. Generous: a cold
  /// sandbox has to start before a test can run, and killing a slow run reports
  /// a timeout, never a failure — blaming a contributor for our own ceiling is
  /// the one outcome this must not produce.
  oracleTimeoutSeconds: Number(process.env.ORACLE_TIMEOUT_SECONDS || 180),

  // --- verifier agent (Phase 3) -------------------------------------------
  // Its own Circle wallet, its own process, its own model. The seller side
  // only ever needs the address: Gateway credits it, it holds no key here.
  verifierAddress: required('VERIFIER_ADDRESS') as `0x${string}`,
  verifierPort: Number(process.env.VERIFIER_PORT || 8788),
  verifierUrl: process.env.VERIFIER_URL || 'http://localhost:8788/verify',

  // A different vendor from the attestor on purpose — a second opinion from the
  // same model is not a second opinion.
  //
  // QUALIFY WHATEVER YOU CHOOSE ON A DIFF THAT DOES NOT SATISFY THE MILESTONE,
  // not just one that does. More than one candidate has judged the easy case
  // correctly in seconds and then, on the mismatch, expanded its reasoning to
  // fill the entire token budget and returned nothing at all. That arrives as
  // "not valid JSON", it only appears on the case that actually needs judgment,
  // and every one of them is PAID FOR — x402 settles before the handler runs.
  //
  // The negative control is the whole test: given a diff and a milestone it
  // does not satisfy, the verifier must return `satisfies=false, fraction 0`
  // with specific red flags rather than rubber-stamping (T5).
  // `pnpm review:test <pr> "<a milestone the diff fails>"` is how you run it.
  //
  // Required, and worth choosing deliberately rather than copying the attestor:
  // a second opinion from the same model is not a second opinion. Whether the
  // fee covers the inference depends entirely on what you pick, so price it
  // against VERIFICATION_FEE before running it in anger.
  verifierModel: required('VERIFIER_MODEL'),

  /// Same idea for the second opinion. Keep it on a DIFFERENT vendor from the
  /// attestor's list — a fallback that lands both agents on the same model
  /// would quietly turn the second opinion into an echo.
  verifierFallbackModels: (process.env.VERIFIER_FALLBACK_MODELS ?? '')
    .split(',').map((m) => m.trim()).filter(Boolean),
};
