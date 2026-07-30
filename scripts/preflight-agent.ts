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
  'WORKSTREAM_ADDRESS',
  'CIRCLE_API_KEY',
  'ENTITY_SECRET',
  'AGENT_WALLET_ID',
  'AGENT_ADDRESS',
  'GITHUB_REPO',
  'GITHUB_TOKEN',
  'GITHUB_WEBHOOK_SECRET',
  'OPENROUTER_API_KEY',
] as const;

let envOk = true;
for (const name of requiredVars) {
  const present = Boolean(process.env[name]);
  if (!present) envOk = false;
  add(`env ${name}`, present, present ? 'set' : 'MISSING');
}
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

// contract reachable and sane
let stream: Awaited<ReturnType<typeof readStream>> | undefined;
try {
  stream = await readStream();
  add('WorkStream readable', true, `nonce ${stream.nonce}, milestone "${stream.milestone.slice(0, 40)}…"`);
  add('stream not paused', !stream.paused, stream.paused ? 'PAUSED — unlocks will revert' : 'active');
  add('stream has accrued', stream.accrued > stream.unlocked, `${formatUsdc(stream.accrued - stream.unlocked)} USDC unlockable`);
} catch (err) {
  add('WorkStream readable', false, (err as Error).message.split('\n')[0]);
}

// contract is funded enough to pay out a max tranche
if (stream) {
  try {
    const held = await withRetry(() =>
      client.readContract({
        address: USDC_ADDRESS,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [env.workStream],
      }),
    );
    add('contract funded ≥ maxTranche', held >= stream.maxTranche, `${formatUsdc(held)} USDC held`);
  } catch (err) {
    add('contract funded', false, `RPC error: ${(err as Error).message.split('\n')[0]}`);
  }
}

// THE critical check — Circle signature must recover to the agent address
if (stream) {
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
    const signature = await signAttestation(probe);
    const recovered = await recoverTypedDataAddress({
      domain: {
        name: 'ProofStream',
        version: '1',
        chainId: arcTestnet.id,
        verifyingContract: env.workStream,
      },
      types: {
        Attestation: [
          { name: 'nonce', type: 'uint256' },
          { name: 'tranche', type: 'uint256' },
          { name: 'prNumber', type: 'uint256' },
          { name: 'commitSha', type: 'string' },
          { name: 'confidenceBps', type: 'uint256' },
          { name: 'issuedAt', type: 'uint256' },
          { name: 'milestoneHash', type: 'bytes32' },
        ],
      },
      primaryType: 'Attestation',
      message: probe,
      signature,
    });
    const match = recovered.toLowerCase() === env.agentAddress.toLowerCase();
    add('EIP-712 signature recovers to agent', match, match ? recovered : `got ${recovered}, expected ${env.agentAddress}`);
  } catch (err) {
    add('EIP-712 signature recovers to agent', false, (err as Error).message.split('\n')[0]);
  }
}

// GitHub + OpenRouter reachable with our credentials
try {
  const repo = stream?.repo ?? env.githubRepo;
  const res = await fetch(`https://api.github.com/repos/${repo}`, {
    headers: { Authorization: `Bearer ${env.githubToken}`, 'User-Agent': 'proofstream-preflight' },
  });
  add('on-chain repo readable', res.ok, `HTTP ${res.status} for ${repo} (from contract)`);
} catch (err) {
  add('GitHub repo readable', false, (err as Error).message);
}

try {
  const res = await fetch('https://openrouter.ai/api/v1/key', {
    headers: { Authorization: `Bearer ${env.openRouterKey}` },
  });
  add('OpenRouter key valid', res.ok, `HTTP ${res.status}, model ${env.model}`);
} catch (err) {
  add('OpenRouter key valid', false, (err as Error).message);
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
