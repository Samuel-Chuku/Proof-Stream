// Dry run for the Phase 1 deploy (constitution §5.10): every check must PASS
// before the human runs the live forge script. Read-only — sends nothing.
//
// Arc quirk: USDC transfers cannot be fork-simulated (blocklist precompile
// 0x1800…0001 is missing from local EVMs), so this checks balances directly
// instead of simulating the funding transfer.
import { execSync } from 'node:child_process';
import { createPublicClient, erc20Abi, http, isAddress } from 'viem';
import { arcTestnet } from 'viem/chains';
import { USDC_ADDRESS, formatNative, formatUsdc, parseNative, parseUsdc } from '@proofstream/config';

// Must match Deploy.s.sol INITIAL_FUNDING.
// The milestone budget the deployer must be able to deposit. Matches
// Deploy.s.sol's default; override with STREAM_BUDGET (6-dp raw units) to
// preflight a different sized job.
const INITIAL_FUNDING = process.env.STREAM_BUDGET
  ? BigInt(process.env.STREAM_BUDGET)
  : parseUsdc('40');
// Enough native gas for a deploy + a handful of txs.
const MIN_DEPLOYER_GAS = parseNative('1');
const MIN_AGENT_GAS = parseNative('1');

type Check = { name: string; ok: boolean; detail: string };
const checks: Check[] = [];

const env = (name: string) => process.env[name] ?? '';
// VAULT_ADDRESS was here until 2026-08-05 and blocked the deploy preflight on a
// variable the contract has not used since the 15% vesting split was removed —
// a fresh clone failed for a wallet it never needs.
const addressVars = ['DEPLOYER_ADDRESS', 'AGENT_ADDRESS', 'CONTRIBUTOR_ADDRESS'] as const;

for (const name of addressVars) {
  const ok = isAddress(env(name));
  checks.push({ name: `env ${name}`, ok, detail: ok ? env(name) : 'missing or not an address' });
}

const client = createPublicClient({ chain: arcTestnet, transport: http(process.env.ARC_RPC_URL) });

try {
  const chainId = await client.getChainId();
  checks.push({
    name: 'RPC chain id',
    ok: chainId === arcTestnet.id,
    detail: `${chainId} (expected ${arcTestnet.id})`,
  });
} catch (err) {
  checks.push({ name: 'RPC chain id', ok: false, detail: `RPC unreachable: ${(err as Error).message}` });
}

// Arc's public RPC rate-limits aggressively — space the calls out and never
// let one RPC failure crash the whole checklist.
const pause = () => new Promise((r) => setTimeout(r, 400));

async function nativeBalance(address: `0x${string}`): Promise<bigint> {
  await pause();
  return client.getBalance({ address });
}

async function usdcBalance(address: `0x${string}`): Promise<bigint> {
  await pause();
  return client.readContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [address],
  });
}

async function balanceCheck(name: string, ok: (v: bigint) => boolean, fetch: () => Promise<bigint>, unit: (v: bigint) => string) {
  try {
    const v = await fetch();
    checks.push({ name, ok: ok(v), detail: `${unit(v)} USDC` });
  } catch (err) {
    checks.push({ name, ok: false, detail: `RPC error: ${(err as Error).message.split('\n')[0]}` });
  }
}

if (isAddress(env('DEPLOYER_ADDRESS'))) {
  const deployer = env('DEPLOYER_ADDRESS') as `0x${string}`;
  await balanceCheck(`deployer USDC ≥ budget ${formatUsdc(INITIAL_FUNDING)}`, (v) => v >= INITIAL_FUNDING, () => usdcBalance(deployer), formatUsdc);
  await balanceCheck(`deployer native gas ≥ ${formatNative(MIN_DEPLOYER_GAS)}`, (v) => v >= MIN_DEPLOYER_GAS, () => nativeBalance(deployer), formatNative);
}

for (const name of ['AGENT_ADDRESS', 'CONTRIBUTOR_ADDRESS'] as const) {
  if (!isAddress(env(name))) continue;
  const label = name.replace('_ADDRESS', '').toLowerCase();
  await balanceCheck(`${label} native gas ≥ ${formatNative(MIN_AGENT_GAS)}`, (v) => v >= MIN_AGENT_GAS, () => nativeBalance(env(name) as `0x${string}`), formatNative);
}

try {
  execSync('forge build', { cwd: 'contracts', stdio: 'pipe' });
  checks.push({ name: 'forge build', ok: true, detail: 'compiles' });
} catch (err) {
  checks.push({ name: 'forge build', ok: false, detail: String((err as { stderr?: Buffer }).stderr ?? err).slice(0, 200) });
}

try {
  execSync('forge test', { cwd: 'contracts', stdio: 'pipe' });
  checks.push({ name: 'forge test', ok: true, detail: 'all tests pass' });
} catch {
  checks.push({ name: 'forge test', ok: false, detail: 'failing tests — run forge test for detail' });
}

let allOk = true;
for (const c of checks) {
  if (!c.ok) allOk = false;
  console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name.padEnd(38)} ${c.detail}`);
}
console.log(allOk ? '\nALL GREEN — safe to run the live deploy command.' : '\nNOT READY — fix the FAIL lines before deploying.');
process.exit(allOk ? 0 : 1);
