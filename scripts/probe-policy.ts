// Do the contract's protections ACTUALLY FIRE? (§5.10). Read-only.
//
// CT-1, CT-2, CT-3 and the claim path have been live on Arc testnet since the
// bytecode was regenerated, and every one of them has carried real streams. Not
// one of their guards has ever fired: the happy path never touches them. A
// protection nobody has seen refuse anything is a protection on paper.
//
// Every check here comes in a PAIR — the forbidden action, and an allowed one
// beside it. Without the pair a revert proves nothing: a wrong ABI, a bad
// argument, a stale address and a working guard all look identical from the
// outside. The control is what separates "the invariant held" from "the call
// never reached it".
//
// Nothing is sent. Constructor guards are exercised by simulating a deployment,
// which needs no key and no gas; state guards are simulated against the live
// streams. The one command that must actually land on chain — a recorded
// reverting transaction, per the definition of done — is printed at the end for
// the human to run.
import { WORK_STREAM_ABI, EXPLORER_URL, USDC_ADDRESS } from '@proofstream/config';
import {
  createPublicClient,
  decodeErrorResult,
  encodeDeployData,
  http,
  parseUnits,
  type Address,
} from 'viem';
import { arcTestnet } from 'viem/chains';
import { WORK_STREAM_BYTECODE } from '../web/lib/bytecode';

type Check = { name: string; ok: boolean; detail: string };
const checks: Check[] = [];
const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

const client = createPublicClient({ chain: arcTestnet, transport: http(process.env.ARC_RPC_URL) });

const AGENT = (process.env.AGENT_ADDRESS ?? '0x2CD7cc0407218f905731F88C08EEB86a94dd634A') as Address;
const SOMEONE = '0x901788dC477C9B6fbA00e9344bd2d1bf71923f10' as Address;
const NOBODY = '0x0000000000000000000000000000000000000000' as Address;

const BUDGET = parseUnits('30', 6);
const DAY = 86_400n;

/// A deployment that is expected to be rejected before it ever exists.
///
/// `eth_call` against no `to` address runs the constructor and throws on a
/// revert, so a guard can be proven without a key, gas, or a contract left
/// behind. viem wraps the reason, so the error name is matched anywhere in the
/// message rather than parsed out of a shape that varies by node.
async function simulateDeploy(args: {
  contributor: Address;
  claimAuthority: Address;
  budget: bigint;
  duration: bigint;
  maxTranche: bigint;
  dailyUnlockCap: bigint;
  payee: Address;
  claimCap?: bigint;
  dailyClaimCap?: bigint;
}): Promise<string | null> {
  const data = encodeDeployData({
    abi: WORK_STREAM_ABI,
    bytecode: WORK_STREAM_BYTECODE,
    args: [
      USDC_ADDRESS,
      args.contributor,
      args.claimAuthority,
      AGENT,
      'probe milestone',
      args.budget,
      args.duration,
      'owner/repo',
      [],
      {
        maxTranche: args.maxTranche,
        dailyUnlockCap: args.dailyUnlockCap,
        payee: args.payee,
        claimCap: args.claimCap ?? 0n,
        dailyClaimCap: args.dailyClaimCap ?? 0n,
      },
    ],
  });
  try {
    await client.call({ data });
    return null; // deployed cleanly
  } catch (err) {
    return errorName(err) ?? 'unknown';
  }
}

/// A well-formed deployment, used as the control every forbidden one is read
/// against.
const sound = {
  contributor: SOMEONE,
  claimAuthority: NOBODY,
  budget: BUDGET,
  duration: DAY,
  maxTranche: BUDGET,
  dailyUnlockCap: BUDGET,
  payee: SOMEONE,
};

async function main() {
  const stream = (process.argv[2] ?? '0x0684D1CC230719F40fEE35D87Dfb5C913F4b5E7f') as Address;

  const id = await client.getChainId();
  add('chain is Arc testnet', id === 5042002, `chain id ${id}`);

  // --- the control, first. If a SOUND deployment does not simulate, every
  // revert below is meaningless and the run should be read as broken. ---
  const control = await simulateDeploy(sound);
  add('CONTROL — a sound stream deploys', control === null, control ?? 'constructor accepted it');

  // --- CT-1: a cap may throttle the rate, never strand the budget ---
  const lowTranche = await simulateDeploy({ ...sound, maxTranche: BUDGET / 3n });
  add(
    'CT-1 maxTranche below the budget is refused',
    lowTranche === 'CapCannotStrandTheBudget',
    lowTranche ? reason(lowTranche) : 'DEPLOYED — the trap that took real money is open',
  );

  // Two days of duration against a one-day cap: the total is unreachable even
  // though no single attestation exceeds anything.
  const lowDaily = await simulateDeploy({
    ...sound,
    duration: DAY * 4n,
    dailyUnlockCap: BUDGET / 8n,
  });
  add(
    'CT-1 a daily cap that cannot reach the budget in time is refused',
    lowDaily === 'CapCannotStrandTheBudget',
    lowDaily ? reason(lowDaily) : 'DEPLOYED — the slower form of the same trap is open',
  );

  // --- CT-6: exactly one of named or claimable ---
  const both = await simulateDeploy({ ...sound, claimAuthority: AGENT });
  add(
    'CT-6 a stream cannot be both named and claimable',
    both === 'ZeroAddress',
    both ? reason(both) : 'DEPLOYED — two answers to "who gets paid"',
  );

  // Naming nobody is PUBLIC MODE, and it has to be chosen: without payout caps
  // it is indistinguishable from having forgotten, so the constructor refuses.
  const forgot = await simulateDeploy({ ...sound, contributor: NOBODY, payee: NOBODY });
  add(
    'v3 naming nobody WITHOUT caps is refused',
    forgot === 'BadCapPair',
    forgot ? reason(forgot) : 'DEPLOYED — an open stream by omission',
  );

  const open = await simulateDeploy({
    ...sound,
    contributor: NOBODY,
    payee: NOBODY,
    claimCap: BUDGET / 3n,
    dailyClaimCap: BUDGET,
  });
  add('CONTROL — a public stream with caps deploys', open === null, open ? reason(open) : 'accepted');

  const capsOnNamed = await simulateDeploy({ ...sound, claimCap: 1n, dailyClaimCap: 1n });
  add(
    'v3 a named stream may not carry payout caps',
    capsOnNamed === 'BadCapPair',
    capsOnNamed ? reason(capsOnNamed) : 'DEPLOYED — inert caps that mislead the reader',
  );

  const claimable = await simulateDeploy({
    ...sound,
    contributor: NOBODY,
    payee: NOBODY,
    claimAuthority: AGENT,
  });
  add('CONTROL — a claimable stream deploys', claimable === null, claimable ? reason(claimable) : 'accepted');

  // --- CT-3 / CT-2, against the live stream ---
  const employer = (await client.readContract({
    address: stream,
    abi: WORK_STREAM_ABI,
    functionName: 'employer',
  })) as Address;
  const certified = (await client.readContract({
    address: stream,
    abi: WORK_STREAM_ABI,
    functionName: 'certifiedBps',
  })) as bigint;
  add(`${stream.slice(0, 10)} has certified work`, certified > 0n, `certifiedBps ${certified}`);

  // The control for both locks: an employer-only setter with NO certification
  // guard. If this simulates, the address, the ABI and the caller are right, so
  // a revert below is the lock and not the plumbing.
  const raise = await simulate(stream, employer, 'raisePolicy', [BUDGET * 2n, BUDGET * 2n]);
  add('CONTROL — the employer can still raise caps', raise === null, raise ? reason(raise) : 'accepted');

  const repo = await simulate(stream, employer, 'setRepo', ['someone/else']);
  add(
    'CT-3 the repo is locked once work is certified',
    repo === 'RepoLocked',
    repo ? reason(repo) : 'ACCEPTED — certified work can be repointed at another repo',
  );

  const authors = await simulate(stream, employer, 'setAuthors', [['someone-else']]);
  add(
    'CT-2 the author allowlist is locked once work is certified',
    authors === 'RepoLocked',
    authors ? reason(authors) : 'ACCEPTED — the allowlist can be rewritten after the fact',
  );

  // --- the claim path on a NAMED stream ---
  const claim = await simulate(stream, SOMEONE, 'claim', ['0x00']);
  add(
    'CT-6 a named stream cannot be claimed',
    claim === 'AlreadyClaimed' || claim === 'NotClaimable',
    claim ? reason(claim) : 'ACCEPTED — anyone could take over a named stream',
  );

  report(stream, employer);
}

async function simulate(address: Address, account: Address, functionName: string, args: unknown[]) {
  try {
    await client.simulateContract({ address, abi: WORK_STREAM_ABI, functionName: functionName as never, args: args as never, account });
    return null;
  } catch (err) {
    return errorName(err) ?? 'unknown';
  }
}

/// The name of the custom error a revert carried, or null.
///
/// A CONSTRUCTOR REVERT CANNOT BE DECODED FOR US. `simulateContract` knows which
/// ABI it called and names the error; a raw `eth_call` carrying deploy bytecode
/// does not, so viem can only say "reverted for an unknown reason" while the
/// four-byte selector sits right there in the response. Every constructor guard
/// in this file would read as unproven — the failure looking exactly like the
/// guard being absent, which is the one confusion this script exists to remove.
///
/// So the raw revert data is pulled out of the error chain and decoded against
/// the ABI by hand.
function errorName(err: unknown): string | null {
  // WALK THE WHOLE CAUSE CHAIN FOR A HEX PAYLOAD. Established by inspecting a
  // real revert rather than by reasoning about viem's types: for a raw deploy
  // call the selector arrives on an `RpcRequestError` several levels down, as a
  // plain string. Looking only for `RawContractError`, which is where a
  // contract call puts it, finds nothing at all here.
  for (let e: any = err; e; e = e.cause) {
    const data = typeof e.data === 'string' ? e.data : e.data?.data;
    if (typeof data === 'string' && data.startsWith('0x') && data.length >= 10) {
      try {
        return decodeErrorResult({ abi: WORK_STREAM_ABI, data: data as `0x${string}` }).errorName;
      } catch {
        return null; // a selector, but not one of ours
      }
    }
  }
  const message = err instanceof Error ? err.message : String(err);
  return message.match(/Error:\s*([A-Za-z]+)\(\)/)?.[1] ?? null;
}

/// What to print for a revert we expected.
const reason = (name: string | null) => (name ? `reverted ${name}()` : 'reverted, but not with one of our errors');

function report(stream: Address, employer: Address) {
  const width = Math.max(...checks.map((c) => c.name.length));
  console.log('\n  PROTECTIONS THAT HAVE NEVER FIRED IN PRODUCTION\n');
  for (const c of checks) {
    console.log(`  ${c.ok ? 'ok  ' : 'FAIL'}  ${c.name.padEnd(width)}  ${c.detail}`);
  }
  const allOk = checks.every((c) => c.ok);
  console.log(`\n  ${allOk ? 'every guard fired' : 'SOMETHING IS NOT GUARDED — read the FAIL lines above'}\n`);

  if (allOk) {
    console.log('  Simulation proves the invariant. It does not leave EVIDENCE: the');
    console.log('  definition of done wants a reverting transaction on the explorer.');
    console.log('  This one reverts RepoLocked and costs only gas:\n');
    console.log(`    cast send ${stream} 'setRepo(string)' 'someone/else' \\`);
    console.log(`      --rpc-url "$ARC_RPC_URL" --account proofstream-deployer --gas-limit 100000\n`);
    console.log(`  Sent from the employer, ${employer}.`);
    console.log('  --gas-limit is required: estimation fails on a call that reverts, so');
    console.log('  without it the wallet refuses to send and nothing is ever recorded.');
    console.log(`  It will appear as a failed transaction at ${EXPLORER_URL}/address/${stream}\n`);
  }
  process.exit(allOk ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
