// Dry run for announcing a stream to the StreamRegistry (§5.10). Read-only.
//
// Registration is cheap but silently useless if it names the wrong actors: a
// stream whose agent is not OUR agent will be skipped by the agent at runtime,
// and a stream whose employer is not the sending key cannot be registered at
// all. Both are worth finding out here rather than from a revert or, worse,
// from an agent that quietly ignores a stream the employer thinks is live.
//
// The employer's key lives in a Foundry keystore, never in .env (constitution
// §3), so this preflight does not send anything — it prints the exact
// `cast send` for the human to run, the same shape as deploy and fund.
import { EXPLORER_URL, formatNative } from '@proofstream/config';
import { createPublicClient, http, isAddress } from 'viem';
import { arcTestnet } from 'viem/chains';

type Check = { name: string; ok: boolean; detail: string };
const checks: Check[] = [];
const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

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

// Declared here rather than imported: no file in scripts/ may import another
// (see STATE.md — a preflight that runs at import time hijacks its caller).
const WORK_STREAM_ABI = [
  { type: 'function', name: 'employer', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'agent', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'repo', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
] as const;

const REGISTRY_ABI = [
  {
    type: 'function',
    name: 'register',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'stream', type: 'address' }],
    outputs: [],
  },
] as const;

const stream = (process.argv[2] ?? process.env.WORKSTREAM_ADDRESS ?? '') as `0x${string}`;
const argOk = isAddress(stream);
add(
  'stream address given',
  argOk,
  argOk ? stream : 'pass one: pnpm preflight:register <stream address> (or set WORKSTREAM_ADDRESS)',
);

const requiredVars = ['REGISTRY_ADDRESS', 'ARC_RPC_URL', 'DEPLOYER_ADDRESS', 'AGENT_ADDRESS'] as const;
let envOk = argOk;
for (const name of requiredVars) {
  const present = Boolean(process.env[name]);
  if (!present) envOk = false;
  add(`env ${name}`, present, present ? 'set' : 'MISSING');
}
if (!envOk) report();

const registry = process.env.REGISTRY_ADDRESS as `0x${string}`;
const employer = process.env.DEPLOYER_ADDRESS as `0x${string}`;
const expectedAgent = process.env.AGENT_ADDRESS as `0x${string}`;
const client = createPublicClient({ chain: arcTestnet, transport: http(process.env.ARC_RPC_URL) });

const read = <T>(functionName: string) =>
  withRetry(
    () => client.readContract({ address: stream, abi: WORK_STREAM_ABI, functionName: functionName as never }) as Promise<T>,
  );

try {
  const chainId = await withRetry(() => client.getChainId());
  add('chain is Arc testnet', chainId === 5042002, `chain id ${chainId}`);

  const registryCode = await withRetry(() => client.getCode({ address: registry }));
  add('registry is deployed', Boolean(registryCode && registryCode !== '0x'), registry);

  const streamCode = await withRetry(() => client.getCode({ address: stream }));
  const isContract = Boolean(streamCode && streamCode !== '0x');
  add('stream is a contract', isContract, isContract ? stream : 'no code at that address');
  if (!isContract) report();

  // The whole reason for option three: whoever deployed the stream owns it,
  // and only they can announce it.
  const onChainEmployer = await read<`0x${string}`>('employer');
  const employerOk = onChainEmployer.toLowerCase() === employer.toLowerCase();
  add(
    'sending key is the stream employer',
    employerOk,
    employerOk ? onChainEmployer : `stream says ${onChainEmployer}, DEPLOYER_ADDRESS is ${employer}`,
  );

  // Not enforced on-chain, deliberately — the registry records what the stream
  // says. But an agent refuses streams that did not appoint it, so registering
  // one is a no-op the employer would otherwise never see.
  const onChainAgent = await read<`0x${string}`>('agent');
  const agentOk = onChainAgent.toLowerCase() === expectedAgent.toLowerCase();
  add(
    'stream appoints THIS agent',
    agentOk,
    agentOk ? onChainAgent : `stream appoints ${onChainAgent}; our agent ${expectedAgent} will skip it`,
  );

  const repo = await read<string>('repo');
  add('stream names a repo', repo.length > 0, repo.length > 0 ? repo : 'empty — the agent has nothing to watch');

  const gas = await withRetry(() => client.getBalance({ address: employer }));
  add('employer has gas', gas > 0n, `${formatNative(gas)} USDC (native, 18dp)`);

  // The real proof: runs the employer check without sending.
  try {
    await withRetry(() =>
      client.simulateContract({
        address: registry,
        abi: REGISTRY_ABI,
        functionName: 'register',
        args: [stream],
        account: employer,
      }),
    );
    add('register WOULD succeed (simulated, NOT sent)', true, `${stream} → registry`);
  } catch (err) {
    add('register simulates cleanly', false, (err as Error).message.split('\n')[0].slice(0, 90));
  }

  console.log(`\nstream   ${EXPLORER_URL}/address/${stream}`);
  console.log(`registry ${EXPLORER_URL}/address/${registry}\n`);
} catch (err) {
  add('chain readable', false, (err as Error).message.split('\n')[0]);
}

report();

function report(): never {
  let allOk = true;
  for (const c of checks) {
    if (!c.ok) allOk = false;
    console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name.padEnd(42)} ${c.detail}`);
  }
  if (allOk) {
    console.log('\nALL GREEN — nothing has been announced yet. Now run:\n');
    console.log(`  bash -c 'set -a; source .env; set +a
  cast send "$REGISTRY_ADDRESS" "register(address)" ${stream} \\
    --rpc-url "$ARC_RPC_URL" --account proofstream-deployer'\n`);
  } else {
    console.log('\nNOT READY — fix the FAIL lines first.');
  }
  process.exit(allOk ? 0 : 1);
}
