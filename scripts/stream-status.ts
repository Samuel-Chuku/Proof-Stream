// One stream's full on-chain state, in one screen.
//
//   pnpm stream:status <address>
//   pnpm stream:status                 # falls back to WORKSTREAM_ADDRESS
//
// Read-only. `pnpm watch` answers "what did the agent decide"; this answers
// "what does the CONTRACT currently say", which otherwise takes a dozen
// separate `cast call`s.
//
// The three lines worth reading together are certified/target, accrued, and
// earned. `target` is what the agent says is owed and `accrued` is what the
// clock has released; `earned` is the smaller of the two. A contributor seeing
// accrued money they cannot take is the design working, not a fault.
import { createPublicClient, erc20Abi, http, type ContractFunctionName } from 'viem';
import { arcTestnet } from 'viem/chains';
import { USDC_ADDRESS, WORK_STREAM_ABI, formatUsdc, parseRepoSpec } from '@proofstream/config';

const address = (process.argv[2] ?? process.env.WORKSTREAM_ADDRESS) as `0x${string}` | undefined;
if (!address) {
  console.error('usage: pnpm stream:status <address>   (or set WORKSTREAM_ADDRESS)');
  process.exit(1);
}

/// Checked against the generated ABI, so a typo fails the build rather than
/// silently reading nothing at runtime.
type ReadFn = ContractFunctionName<typeof WORK_STREAM_ABI, 'view' | 'pure'>;

const client = createPublicClient({ chain: arcTestnet, transport: http(process.env.ARC_RPC_URL) });
const read = <T>(functionName: ReadFn) =>
  client.readContract({ address, abi: WORK_STREAM_ABI, functionName }) as Promise<T>;

/// Matches the agent's own routing window (MILESTONE_GRACE_HOURS, default 4).
/// The contract enforces the same number as CLOSE_GRACE, deliberately.
const GRACE_HOURS = Number(process.env.MILESTONE_GRACE_HOURS || 4);

const stamp = (v: bigint) =>
  v === 0n ? '—' : `${new Date(Number(v) * 1000).toISOString().slice(0, 19).replace('T', ' ')} UTC`;
const span = (s: number) =>
  s <= 0 ? 'elapsed' : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;

const [
  repo, milestone, budget, duration, policy, employer, contributor, agent,
  activatedAt, endsAt, closableAt, fullyFunded, isActive, paused, closed,
  accrued, target, earned, withdrawable, withdrawn, certifiedBps, nonce, funded,
] = await Promise.all([
  read<string>('repo'), read<string>('milestone'), read<bigint>('budget'), read<bigint>('duration'),
  read<[bigint, bigint, `0x${string}`]>('policy'), read<string>('employer'), read<string>('contributor'),
  read<string>('agent'), read<bigint>('activatedAt'), read<bigint>('milestoneEndsAt'),
  read<bigint>('closableAt'), read<boolean>('fullyFunded'), read<boolean>('isActive'),
  read<boolean>('paused'), read<boolean>('milestoneClosed'), read<bigint>('accrued'),
  read<bigint>('target'), read<bigint>('earned'), read<bigint>('withdrawable'),
  read<bigint>('withdrawn'), read<bigint>('certifiedBps'), read<bigint>('nonce'), read<bigint>('funded'),
]);

const held = await client.readContract({
  address: USDC_ADDRESS, abi: erc20Abi, functionName: 'balanceOf', args: [address],
});

const [maxTranche, dailyUnlockCap, payee] = policy;
const { repo: name, branch } = parseRepoSpec(repo);
const now = Math.floor(Date.now() / 1000);

console.log(`
  STREAM     ${address}
  repo       ${name}
  branch     ${branch}${repo.includes('#') ? '' : '  (implicit — no #branch in the on-chain spec)'}
  agent      ${agent}
  employer   ${employer}
  payee      ${payee}${payee.toLowerCase() === contributor.toLowerCase() ? '  (= contributor)' : '  ⚠ NOT the contributor'}

  STATE      funded=${fullyFunded}  active=${isActive}  paused=${paused}  closed=${closed}
  started    ${stamp(activatedAt)}
  ends       ${stamp(endsAt)}${activatedAt === 0n ? '' : `   accrual left ${span(Number(endsAt) - now)}`}
  certifiable${activatedAt === 0n ? ' —' : ` for another ${span(Number(endsAt) + GRACE_HOURS * 3600 - now)}`}   (closable ${stamp(closableAt)})

  MONEY      budget ${formatUsdc(budget)}  over ${Number(duration)}s     held ${formatUsdc(held)}   funded ${formatUsdc(funded)}
  certified  ${Number(certifiedBps) / 100}%  ->  target ${formatUsdc(target)}      the AGENT decides this
  accrued    ${formatUsdc(accrued)}                        the CLOCK meters it
  earned     ${formatUsdc(earned)}  = min(accrued, target)
  payable    withdrawable ${formatUsdc(withdrawable)}   withdrawn ${formatUsdc(withdrawn)}   nonce ${nonce}

  POLICY     maxTranche ${formatUsdc(maxTranche)}${maxTranche < budget ? '  ⚠ below budget — needs several certifications' : ''}
             dailyUnlockCap ${formatUsdc(dailyUnlockCap)}${dailyUnlockCap < budget ? '  ⚠ below budget' : ''}

  MILESTONE  ${milestone.length} chars, read from the contract
  ${milestone}
`);
