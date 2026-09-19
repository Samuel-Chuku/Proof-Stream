// THE REVERT THE DEFINITION OF DONE ASKS FOR: a real transaction, on the
// explorer, refused by the contract.
//
//   pnpm revert:prepare [stream address]
//
// Read-only. It proves, by simulation, which guard will fire against a LIVE
// stream, then prints the exact command to send it. Nothing here signs or
// broadcasts anything.
//
// WHY THE AGENT CANNOT BE THE SENDER. Circle estimates a contract execution
// before broadcasting it, and a call that reverts fails estimation with
// ESTIMATION_ERROR — the transaction never reaches the chain, so there is
// nothing to link to. That is Circle protecting its users from burning gas on
// a doomed call, and it cannot be turned off; the `gasLimit` override is
// documented as overriding the ESTIMATE, not as skipping it. So the sender has
// to be a key whose gas limit we set ourselves, which means `cast send
// --gas-limit` from the Foundry keystore.
//
// WHAT THAT DOES AND DOES NOT PROVE. It proves the guard is real code on a live
// contract rather than a conditional in the frontend, which is exactly the
// claim `probe:policy` can only make by simulation. It does not show the agent
// being stopped, because the agent's custodian refuses to send a doomed
// transaction at all — worth saying plainly rather than implying otherwise.
import { WORK_STREAM_ABI, EXPLORER_URL } from '@proofstream/config';
import {
  createPublicClient,
  decodeErrorResult,
  encodeFunctionData,
  http,
  parseAbiItem,
  type Address,
} from 'viem';
import { arcTestnet } from 'viem/chains';

const client = createPublicClient({ chain: arcTestnet, transport: http(process.env.ARC_RPC_URL) });

const REGISTRY = process.env.REGISTRY_ADDRESS as Address | undefined;
const DEPLOYER = process.env.DEPLOYER_ADDRESS as Address | undefined;
if (!REGISTRY) throw new Error('REGISTRY_ADDRESS is not set');
if (!DEPLOYER) throw new Error('DEPLOYER_ADDRESS is not set — it is the sender of the command printed below');

const STREAM_REGISTERED = parseAbiItem(
  'event StreamRegistered(address indexed stream, address indexed employer, address indexed agent, string repo)',
);

const MAX_LOG_WINDOW = 45_000n;

/// The newest registered stream, when none is named on the command line.
async function newestStream(): Promise<Address> {
  const latest = await client.getBlockNumber();
  let cursor = BigInt(process.env.REGISTRY_DEPLOY_BLOCK || '54593230');
  let newest: { address: Address; block: bigint } | null = null;
  while (cursor <= latest) {
    const to = cursor + MAX_LOG_WINDOW - 1n > latest ? latest : cursor + MAX_LOG_WINDOW - 1n;
    const logs = await client.getLogs({ address: REGISTRY, event: STREAM_REGISTERED, fromBlock: cursor, toBlock: to });
    for (const entry of logs) {
      const block = entry.blockNumber ?? 0n;
      if (!newest || block > newest.block) newest = { address: entry.args.stream as Address, block };
    }
    cursor = to + 1n;
  }
  if (!newest) throw new Error('the registry has no streams');
  return newest.address;
}

/// The error a call reverts with, or null if it did not revert.
///
/// viem wraps the reason differently depending on where it came from, so the
/// whole cause chain is walked for a hex payload rather than one shape being
/// assumed. Same approach as probe-policy.ts, and for the same reason: it was
/// established against a real revert, not from the types.
function errorName(err: unknown): string | null {
  for (let e: any = err; e; e = e.cause) {
    const data = typeof e.data === 'string' ? e.data : e.data?.data;
    if (typeof data === 'string' && data.startsWith('0x') && data.length >= 10) {
      try {
        return decodeErrorResult({ abi: WORK_STREAM_ABI, data: data as `0x${string}` }).errorName;
      } catch {
        return null;
      }
    }
  }
  const message = err instanceof Error ? err.message : String(err);
  return message.match(/Error:\s*([A-Za-z]+)\(\)/)?.[1] ?? null;
}

type Candidate = {
  name: string;
  data: `0x${string}`;
  /** The `cast send` arguments, so the command is copyable rather than derived. */
  cast: string;
};

/// WHAT EACH REFUSAL PROVES, and how much it is worth showing.
///
/// Written per error rather than per candidate because which guard fires
/// depends on the stream and on who is sending: the same `setRepo` is
/// RepoLocked from the employer and NotEmployer from anybody else, and both are
/// worth having on the explorer. Rank decides which one to recommend when
/// several are available.
const MEANING: Record<string, { rank: number; proves: string }> = {
  WrongSigner: {
    rank: 5,
    proves:
      'nobody but the agent can certify. This is an outsider signing an attestation for the whole milestone and the contract refusing it — the money cannot be moved by holding the right shape of signature.',
  },
  OverMaxTranche: {
    rank: 4,
    proves: 'the agent cannot release more in one certification than the employer allowed it to.',
  },
  RepoLocked: {
    rank: 3,
    proves:
      'the employer cannot move the goalposts once work has been judged: the repository is locked to what the contributor was paid against.',
  },
  NotEmployer: {
    rank: 2,
    proves:
      'only the employer can change a stream. This is somebody else trying to repoint it at a repository they control, and being refused.',
  },
  NotContributor: {
    rank: 2,
    proves: 'only the address the stream names can withdraw from it.',
  },
  NotAnIncrease: {
    rank: 1,
    proves: 'certification only ever moves forward: a verdict cannot lower what has already been certified.',
  },
};

async function main() {
  const stream = (process.argv[2] as Address | undefined) ?? (await newestStream());

  const [version, repo, employer, agent, nonce, milestoneHash] = await Promise.all([
    client.readContract({ address: stream, abi: WORK_STREAM_ABI, functionName: 'version' }).catch(() => 1n),
    client.readContract({ address: stream, abi: WORK_STREAM_ABI, functionName: 'repo' }),
    client.readContract({ address: stream, abi: WORK_STREAM_ABI, functionName: 'employer' }),
    client.readContract({ address: stream, abi: WORK_STREAM_ABI, functionName: 'agent' }),
    client.readContract({ address: stream, abi: WORK_STREAM_ABI, functionName: 'nonce' }),
    client.readContract({ address: stream, abi: WORK_STREAM_ABI, functionName: 'milestoneHash' }),
  ]);

  console.log(`\n  stream    ${stream}`);
  console.log(`  repo      ${repo}`);
  console.log(`  version   ${version}`);
  console.log(`  employer  ${employer}`);
  console.log(`  agent     ${agent}`);
  console.log(`  sender    ${DEPLOYER}${DEPLOYER!.toLowerCase() === (employer as string).toLowerCase() ? ' (is the employer)' : ' (is NOT the employer)'}\n`);

  const certifiedBps = await client.readContract({
    address: stream,
    abi: WORK_STREAM_ABI,
    functionName: 'certifiedBps',
  });

  // ABOVE WHAT IS ALREADY CERTIFIED, or the signature is never reached: the
  // contract checks the ratchet before it checks the key, so a forged
  // attestation at or below the standing figure reverts NotAnIncrease and
  // proves nothing about the signature. A fully certified milestone has no room
  // at all, which is worth saying rather than sending a weaker transaction.
  const desiredBps = certifiedBps >= 10_000n ? 10_000n : certifiedBps + 100n > 10_000n ? 10_000n : certifiedBps + 100n;
  if (certifiedBps >= 10_000n) {
    console.log('  NOTE: this milestone is certified in full, so a forged certification reverts');
    console.log('        NotAnIncrease before the signature is ever checked. Pass a stream that');
    console.log('        still has room to show the signature guard instead.\n');
  }

  // A signature of the right shape and the wrong key. 65 bytes, v = 27, so the
  // contract's ecrecover returns SOME address — just never the agent's.
  const forged = `0x${'11'.repeat(32)}${'22'.repeat(32)}1b` as `0x${string}`;
  const attestation = {
    nonce,
    certifiedBps: desiredBps,
    prNumber: 999n,
    commitSha: 'deadbeef',
    confidenceBps: 10_000n,
    // FROM THE CHAIN'S CLOCK, not ours. The contract refuses an attestation
    // issued in its future, and a local clock a second or two ahead of the
    // latest block is enough to hit FutureAttestation instead of the guard we
    // are trying to demonstrate. A minute back is comfortably inside the
    // staleness window at the other end.
    issuedAt: (await client.getBlock()).timestamp - 60n,
    milestoneHash,
    ...(Number(version) >= 3 ? { earnerId: `0x${'0'.repeat(64)}` as `0x${string}` } : {}),
  };

  const issuedAt = attestation.issuedAt;

  const certifyData = encodeFunctionData({
    abi: WORK_STREAM_ABI,
    functionName: 'certify',
    args: [attestation as never, forged],
  });

  const candidates: Candidate[] = [
    {
      name: 'certify with a forged signature',
      data: certifyData,
      cast: `cast send ${stream} 'certify((uint256,uint256,uint256,string,uint256,uint256,bytes32,bytes32),bytes)' '(${attestation.nonce},${desiredBps},999,deadbeef,10000,${issuedAt},${milestoneHash},0x${'0'.repeat(64)})' '${forged}'`,
    },
    {
      name: 'repoint the stream at another repository',
      data: encodeFunctionData({ abi: WORK_STREAM_ABI, functionName: 'setRepo', args: ['someone/else'] }),
      cast: `cast send ${stream} 'setRepo(string)' 'someone/else'`,
    },
    {
      name: 'withdraw somebody else\'s money',
      data: encodeFunctionData({ abi: WORK_STREAM_ABI, functionName: 'withdraw', args: [DEPLOYER!, 1n] }),
      cast: `cast send ${stream} 'withdraw(address,uint256)' ${DEPLOYER} 1`,
    },
  ];

  let best: { candidate: Candidate; error: string; rank: number } | null = null;

  for (const c of candidates) {
    let outcome: string;
    let error: string | null = null;
    try {
      await client.call({ account: DEPLOYER, to: stream, data: c.data });
      outcome = 'DID NOT REVERT — this call would succeed, so it must not be sent';
    } catch (err) {
      error = errorName(err);
      outcome = error ? `reverts ${error}()` : 'reverts, but not with one of our errors';
    }
    const meaning = error ? MEANING[error] : undefined;
    console.log(`  ${meaning ? 'ok  ' : '––  '}  ${c.name.padEnd(42)}  ${outcome}`);
    if (error && meaning && (!best || meaning.rank > best.rank)) {
      best = { candidate: c, error, rank: meaning.rank };
    }
  }

  if (!best) {
    console.log('\n  NOTHING TO SEND. Nothing reverted with an error this contract defines.');
    console.log('  Check the address is a WorkStream, and that ARC_RPC_URL reaches chain 5042002.\n');
    process.exit(1);
  }

  const sendable = best.candidate;
  console.log(`\n  BEST AVAILABLE: ${best.error}()\n\n  ${MEANING[best.error].proves}\n`);
  console.log('  SEND IT (this is the only command here that touches the chain):\n');
  // THE PUBLIC ENDPOINT, deliberately. ARC_RPC_URL carries a private node token
  // and must never be printed; and a command that reads it from the shell fails
  // confusingly when the shell has not sourced .env — cast falls back to
  // localhost:8545 and reports "Connection refused", which reads like a chain
  // problem rather than an unset variable.
  console.log(`    ${sendable.cast} \\`);
  console.log('      --rpc-url https://rpc.testnet.arc.network \\');
  console.log('      --account proofstream-deployer --gas-limit 200000\n');
  if (best.error === 'WrongSigner') {
    // ATTESTATION_TTL is 15 minutes and the attestation above is already a
    // minute old. Sent later than that it reverts StaleAttestation, which is a
    // real guard but not the one this run just proved.
    console.log('  RUN IT WITHIN ~13 MINUTES. The attestation carries a timestamp and the');
    console.log('  contract refuses one older than 15 minutes, so a stale command would revert');
    console.log('  StaleAttestation instead. Re-run this script for a fresh one.\n');
  }
  console.log('  --gas-limit is REQUIRED. Estimation fails on a call that reverts, so without');
  console.log('  it the wallet refuses to send and nothing is ever recorded. The transaction');
  console.log(`  costs gas and moves nothing; it will appear as a failed transaction at\n  ${EXPLORER_URL}/address/${stream}\n`);
  console.log('  Then add the hash to EVIDENCE.md under the definition of done.\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
