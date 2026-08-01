// Dry run for the attestor agent (constitution §5.10). Read-only apart from
// asking Circle to sign one throwaway attestation — it is never sent on-chain.
// The signature check is the one that matters: if Circle's signature does not
// recover to AGENT_ADDRESS, every unlock will revert with WrongSigner.
import { createPublicClient, erc20Abi, http, recoverTypedDataAddress } from 'viem';
import { arcTestnet } from 'viem/chains';
import { USDC_ADDRESS, formatNative, formatUsdc, parseNative } from '@proofstream/config';

type Check = { name: string; ok: boolean; detail: string };
const checks: Check[] = [];
const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

// Arc's RPC rate-limits; retry the -32011 it answers with.
async function withRetry<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (err) {
      const rateLimited = String((err as Error).message).includes('request limit reached');
      if (!rateLimited || i >= attempts - 1) throw err;
      await new Promise((r) => setTimeout(r, 500 * 2 ** i));
    }
  }
}

const MIN_AGENT_GAS = parseNative('1');

const requiredVars = [
  'CIRCLE_API_KEY',
  'ENTITY_SECRET',
  'AGENT_WALLET_ID',
  'AGENT_ADDRESS',
  'GITHUB_TOKEN',
  'GITHUB_WEBHOOK_SECRET',
] as const;

let envOk = true;
for (const name of requiredVars) {
  const present = Boolean(process.env[name]);
  if (!present) envOk = false;
  add(`env ${name}`, present, present ? 'set' : 'MISSING');
}

// LLM_API_KEY is the current name; OPENROUTER_API_KEY still works.
const hasLlmKey = Boolean(process.env.LLM_API_KEY || process.env.OPENROUTER_API_KEY);
if (!hasLlmKey) envOk = false;
add(
  'env LLM_API_KEY or OPENROUTER_API_KEY',
  hasLlmKey,
  hasLlmKey ? `via ${process.env.LLM_BASE_URL || 'https://openrouter.ai/api/v1'}` : 'MISSING — set one',
);

// Either discovery mode is fine, but with neither the agent watches nothing.
const hasSource = Boolean(process.env.REGISTRY_ADDRESS || process.env.WORKSTREAM_ADDRESS);
if (!hasSource) envOk = false;
add(
  'env REGISTRY_ADDRESS or WORKSTREAM_ADDRESS',
  hasSource,
  process.env.REGISTRY_ADDRESS
    ? `registry ${process.env.REGISTRY_ADDRESS}`
    : process.env.WORKSTREAM_ADDRESS
      ? `single stream ${process.env.WORKSTREAM_ADDRESS}`
      : 'MISSING — set one',
);

if (!envOk) {
  report();
}

const { env } = await import('../agent/src/env');
const { readStream, signAttestation } = await import('../agent/src/chain');

const client = createPublicClient({ chain: arcTestnet, transport: http(env.arcRpcUrl) });

// agent wallet gas
try {
  const balance = await withRetry(() => client.getBalance({ address: env.agentAddress }));
  add(`agent gas ≥ ${formatNative(MIN_AGENT_GAS)}`, balance >= MIN_AGENT_GAS, `${formatNative(balance)} USDC`);
} catch (err) {
  add('agent gas', false, `RPC error: ${(err as Error).message.split('\n')[0]}`);
}

// Which streams will this agent actually serve? Same discovery path the agent
// uses, so a green preflight means the running agent sees the same fleet.
const { knownStreams, refresh } = await import('../agent/src/registry');
await refresh(() => {});
const served = knownStreams();

add(
  'streams discovered',
  served.length > 0,
  served.length > 0
    ? served.map((s) => `${s.repo} → ${s.stream}`).join(', ')
    : 'none — no registered stream appoints this agent (check REGISTRY_ADDRESS and the stream\'s agent())',
);

/// How many discovered streams are actually funded and accruing. A fleet with
/// none is green on plumbing but has nothing to do, so it is checked once.
let liveStreams = 0;

const ATTESTATION_TYPES = {
  Attestation: [
    { name: 'nonce', type: 'uint256' },
    { name: 'tranche', type: 'uint256' },
    { name: 'prNumber', type: 'uint256' },
    { name: 'commitSha', type: 'string' },
    { name: 'confidenceBps', type: 'uint256' },
    { name: 'issuedAt', type: 'uint256' },
    { name: 'milestoneHash', type: 'bytes32' },
  ],
} as const;

// Every served stream gets the full battery. The signature check is run PER
// STREAM on purpose: each WorkStream builds its EIP-712 domain separator from
// its own address, so one shared signature would be rejected everywhere but the
// stream it was made for. Running this across two streams is what proves the
// multi-tenant signing path is actually per-stream and not silently hardcoded.
for (const entry of served) {
  const label = served.length > 1 ? ` [${entry.repo}]` : '';
  let stream: Awaited<ReturnType<typeof readStream>> | undefined;

  try {
    stream = await readStream(entry.stream);
    add(`WorkStream readable${label}`, true, `nonce ${stream.nonce}, milestone "${stream.milestone.slice(0, 40)}…"`);
  } catch (err) {
    add(`WorkStream readable${label}`, false, (err as Error).message.split('\n')[0]);
    continue;
  }

  // A stream that is not live is WAITING, not broken — the agent discovers it
  // and correctly skips it. Reporting that as a failure would mean a fleet
  // could never go green while any one employer had yet to fund, and it hides
  // the actual instruction (fund it / open a new milestone) behind "0 USDC".
  const live = stream.fullyFunded && stream.isActive;
  if (live) liveStreams += 1;
  add(
    `milestone live${label}`,
    true,
    live
      ? 'funded and accruing'
      : !stream.fullyFunded
        ? `WAITING — funded ${formatUsdc(stream.funded)} of ${formatUsdc(stream.budget)} USDC; deposit the rest to start it`
        : 'WAITING — milestone closed; openMilestone() then fund() to run another',
  );

  // Accrual and balance only mean anything on a live milestone. The signature
  // checks below run for EVERY stream regardless — they prove the agent can
  // sign for that tenant at all, which is worth knowing before it is funded.
  if (live) {
    add(`stream not paused${label}`, !stream.paused, stream.paused ? 'PAUSED — unlocks will revert' : 'active');
    add(
      `stream has accrued${label}`,
      stream.accrued > stream.milestoneUnlocked,
      `${formatUsdc(stream.accrued - stream.milestoneUnlocked)} USDC unlockable`,
    );

    try {
      const held = await withRetry(() =>
        client.readContract({
          address: USDC_ADDRESS,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [entry.stream],
        }),
      );
      add(`contract funded ≥ maxTranche${label}`, held >= stream.maxTranche, `${formatUsdc(held)} USDC held`);
    } catch (err) {
      add(`contract funded${label}`, false, `RPC error: ${(err as Error).message.split('\n')[0]}`);
    }
  }

  try {
    const probe = {
      nonce: stream.nonce,
      tranche: 1n,
      prNumber: 0n,
      commitSha: 'preflight',
      confidenceBps: 10_000n,
      issuedAt: BigInt(Math.floor(Date.now() / 1000)),
      milestoneHash: stream.milestoneHash,
    };
    const signature = await signAttestation(entry.stream, probe);
    const recovered = await recoverTypedDataAddress({
      domain: {
        name: 'ProofStream',
        version: '1',
        chainId: arcTestnet.id,
        verifyingContract: entry.stream,
      },
      types: ATTESTATION_TYPES,
      primaryType: 'Attestation',
      message: probe,
      signature,
    });
    const match = recovered.toLowerCase() === env.agentAddress.toLowerCase();
    add(
      `EIP-712 recovers to agent${label}`,
      match,
      match ? recovered : `got ${recovered}, expected ${env.agentAddress}`,
    );

    // Negative control: the SAME signature must NOT verify against a different
    // verifyingContract. Without this, a domain that ignored the stream address
    // would still pass the check above and quietly break every second tenant.
    const wrongContract = await recoverTypedDataAddress({
      domain: {
        name: 'ProofStream',
        version: '1',
        chainId: arcTestnet.id,
        verifyingContract: '0x000000000000000000000000000000000000dEaD',
      },
      types: ATTESTATION_TYPES,
      primaryType: 'Attestation',
      message: probe,
      signature,
    });
    const isolated = wrongContract.toLowerCase() !== env.agentAddress.toLowerCase();
    add(
      `signature is bound to THIS stream${label}`,
      isolated,
      isolated ? 'does not verify against another address' : 'DOMAIN IGNORES THE STREAM — signatures are cross-valid',
    );
  } catch (err) {
    add(`EIP-712 recovers to agent${label}`, false, (err as Error).message.split('\n')[0]);
  }
}

add(
  'at least one live milestone',
  liveStreams > 0,
  liveStreams > 0
    ? `${liveStreams} of ${served.length} stream(s) funded and accruing`
    : 'none funded — the agent will run but has nothing to certify',
);

// Every served repo must be readable with our token — one unreachable repo is
// one stream that silently never gets judged.
for (const entry of served) {
  try {
    const res = await fetch(`https://api.github.com/repos/${entry.repo}`, {
      headers: { Authorization: `Bearer ${env.githubToken}`, 'User-Agent': 'proofstream-preflight' },
    });
    add(`on-chain repo readable [${entry.repo}]`, res.ok, `HTTP ${res.status} (repo from contract)`);
  } catch (err) {
    add(`on-chain repo readable [${entry.repo}]`, false, (err as Error).message);
  }
}

// A real (tiny) completion rather than OpenRouter's /key endpoint, which no
// other provider serves. This proves three things at once that a key lookup
// cannot: the endpoint is reachable, the key is accepted, and AGENT_MODEL
// actually exists on that provider — the last being the usual failure when
// someone points LLM_BASE_URL somewhere new and keeps a model slug that only
// OpenRouter has.
try {
  const res = await fetch(`${env.llmBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.llmApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: env.model,
      messages: [{ role: 'user', content: 'ok' }],
      max_tokens: 1,
    }),
  });
  const detail = res.ok
    ? `${env.llmBaseUrl}, model ${env.model}`
    : `HTTP ${res.status} from ${env.llmBaseUrl} for model ${env.model}: ${(await res.text()).slice(0, 120)}`;
  add('LLM endpoint + key + model', res.ok, detail);
} catch (err) {
  add('LLM endpoint + key + model', false, `${env.llmBaseUrl} — ${(err as Error).message}`);
}

report();

function report(): never {
  let allOk = true;
  for (const c of checks) {
    if (!c.ok) allOk = false;
    console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name.padEnd(38)} ${c.detail}`);
  }
  console.log(
    allOk
      ? '\nALL GREEN — the agent can sign and unlock. Start it with pnpm agent:dev.'
      : '\nNOT READY — fix the FAIL lines before running the agent.',
  );
  process.exit(allOk ? 0 : 1);
}
