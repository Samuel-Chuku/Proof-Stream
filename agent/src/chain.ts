import { randomUUID } from 'node:crypto';
import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets';
import { createPublicClient, encodeFunctionData, http, parseAbiItem } from 'viem';
import { arcTestnet } from 'viem/chains';
import { env } from './env';
import { pollUntilTerminal } from './poll';

const WORK_STREAM_ABI = [
  { type: 'function', name: 'agent', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'milestoneClosed', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'milestoneEndsAt', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'activatedAt', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint64' }] },
  { type: 'function', name: 'milestone', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'milestoneHash', stateMutability: 'view', inputs: [], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'repo', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'funded', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'budget', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'fullyFunded', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'isActive', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'certifiedBps', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'target', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'earned', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'milestoneIndex', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'nonce', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'accrued', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'paused', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] },
  {
    type: 'function',
    name: 'policy',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }, { type: 'uint256' }, { type: 'address' }],
  },
  {
    type: 'function',
    name: 'certify',
    stateMutability: 'nonpayable',
    inputs: [
      {
        type: 'tuple',
        name: 'a',
        components: [
          { name: 'nonce', type: 'uint256' },
          { name: 'certifiedBps', type: 'uint256' },
          { name: 'prNumber', type: 'uint256' },
          { name: 'commitSha', type: 'string' },
          { name: 'confidenceBps', type: 'uint256' },
          { name: 'issuedAt', type: 'uint256' },
          { name: 'milestoneHash', type: 'bytes32' },
        ],
      },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [],
  },
] as const;

/// Emitted by `certify`. `nonce` and `prNumber` are indexed, so a timed-out
/// transaction can be looked up by exactly the values it was signed over.
const CERTIFIED_EVENT = parseAbiItem(
  'event MilestoneCertified(uint256 indexed nonce, uint256 indexed prNumber, string commitSha, uint256 confidenceBps, uint256 certifiedBps, uint256 addedTarget)',
);

/// How far back to look for that event. A certify that was in flight when the
/// wait gave up is a couple of hundred blocks old at most (Arc runs ~0.51s
/// blocks, and the wait is 120s), so this is generous. It also stays far under
/// Arc's 100k-block `eth_getLogs` ceiling, which is the thing that would turn a
/// confirmation into a second failure.
const CONFIRM_LOOKBACK = 5_000n;

export type StreamState = {
  milestone: string;
  milestoneHash: `0x${string}`;
  /** The repo this stream is about, registered on-chain by the employer. The
   *  agent watches what the contract tells it to, not what its own env says. */
  repo: string;
  /** Deposited so far toward this milestone's budget. */
  funded: bigint;
  /** USDC committed to this milestone. */
  budget: bigint;
  /** True once the whole budget is in — the milestone has started. */
  fullyFunded: boolean;
  /** Accruing right now: funded, started, not closed. */
  isActive: boolean;
  /** The agent's standing verdict on this milestone, 0-10_000. Monotonic, so
   *  a new judgment may only raise it. */
  certifiedBps: bigint;
  /** What the agent has certified is owed, in USDC: budget × certifiedBps.
   *  The clock never moves this. */
  target: bigint;
  /** What the contributor can actually take: min(accrued, target). The agent
   *  decides `target`, the clock meters it into `earned`. */
  earned: bigint;
  milestoneIndex: bigint;
  nonce: bigint;
  accrued: bigint;
  paused: boolean;
  maxTranche: bigint;
  dailyUnlockCap: bigint;
};

export type Attestation = {
  nonce: bigint;
  /** How much of the milestone the work satisfies, in basis points. */
  certifiedBps: bigint;
  prNumber: bigint;
  commitSha: string;
  confidenceBps: bigint;
  issuedAt: bigint;
  milestoneHash: `0x${string}`;
};

const publicClient = createPublicClient({ chain: arcTestnet, transport: http(env.arcRpcUrl) });
const circle = initiateDeveloperControlledWalletsClient({
  apiKey: env.circleApiKey,
  entitySecret: env.entitySecret,
});

// Arc's public RPC rate-limits aggressively and answers with a JSON-RPC
// -32011 that viem does not treat as retryable, so retry it ourselves.
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

/// Who a stream appointed and what repo it watches — the two facts the registry
/// needs to route an event, without paying for the full 15-read state.
///
/// Both come from the CHAIN, never from the registry's event payload. `setRepo`
/// can move a stream to a new repo without any re-registration, so the log
/// tells us which streams exist and the contract tells us what they currently
/// watch. Trusting the log's copy would route events to a stale repo.
export async function readIdentity(
  streamAddress: `0x${string}`,
): Promise<{ agent: `0x${string}`; repo: string; closed: boolean; endsAt: bigint; activatedAt: bigint }> {
  const read = <T>(functionName: string) =>
    withRetry(
      () =>
        publicClient.readContract({
          address: streamAddress,
          abi: WORK_STREAM_ABI,
          functionName: functionName as never,
        }) as Promise<T>,
    );

  const agent = await read<`0x${string}`>('agent');
  const repo = await read<string>('repo');
  // When this milestone's clock started. Reconciliation needs it: work merged
  // BEFORE a milestone existed was not done against it and must never be judged
  // by it. 0 means the budget is not fully deposited yet.
  const activatedAt = await read<bigint>('activatedAt');
  // A settled milestone can never be paid — the pipeline skips it on isActive.
  // Knowing that here lets a dead stream stop blocking a live one.
  const closed = await read<boolean>('milestoneClosed');
  // Nothing accrues past this instant — `accrued()` caps `elapsed` at
  // `duration`. The registry uses it to retire a stream whose milestone has
  // run its course. 0 means the milestone has not started.
  const endsAt = await read<bigint>('milestoneEndsAt');
  return { agent, repo, closed, endsAt, activatedAt };
}

export async function readStream(streamAddress: `0x${string}`): Promise<StreamState> {
  const read = <T>(functionName: string) =>
    withRetry(
      () =>
        publicClient.readContract({
          address: streamAddress,
          abi: WORK_STREAM_ABI,
          functionName: functionName as never,
        }) as Promise<T>,
    );

  const milestone = await read<string>('milestone');
  const milestoneHash = await read<`0x${string}`>('milestoneHash');
  const repo = await read<string>('repo');
  const funded = await read<bigint>('funded');
  const budget = await read<bigint>('budget');
  const fullyFunded = await read<boolean>('fullyFunded');
  const isActive = await read<boolean>('isActive');
  const certifiedBps = await read<bigint>('certifiedBps');
  const target = await read<bigint>('target');
  const earned = await read<bigint>('earned');
  const milestoneIndex = await read<bigint>('milestoneIndex');
  const nonce = await read<bigint>('nonce');
  const accrued = await read<bigint>('accrued');
  const paused = await read<boolean>('paused');
  const [maxTranche, dailyUnlockCap] = await read<[bigint, bigint, string]>('policy');

  return {
    milestone,
    milestoneHash,
    repo,
    funded,
    budget,
    fullyFunded,
    isActive,
    certifiedBps,
    target,
    earned,
    milestoneIndex,
    nonce,
    accrued,
    paused,
    maxTranche,
    dailyUnlockCap,
  };
}

/// EIP-712 payload. Domain and field order must match WorkStream.sol exactly —
/// any drift and the contract recovers a different signer and reverts.
///
/// `verifyingContract` is THE STREAM BEING UNLOCKED, not a global address. Each
/// WorkStream builds its DOMAIN_SEPARATOR from `address(this)` at construction,
/// so a signature made against stream A is rejected by stream B — which is the
/// point: it stops an attestation being replayed across a multi-tenant fleet.
/// Hardcoding one address here would silently break every stream but that one.
function typedData(streamAddress: `0x${string}`, a: Attestation) {
  return {
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
        { name: 'verifyingContract', type: 'address' },
      ],
      Attestation: [
        { name: 'nonce', type: 'uint256' },
        { name: 'certifiedBps', type: 'uint256' },
        { name: 'prNumber', type: 'uint256' },
        { name: 'commitSha', type: 'string' },
        { name: 'confidenceBps', type: 'uint256' },
        { name: 'issuedAt', type: 'uint256' },
        { name: 'milestoneHash', type: 'bytes32' },
      ],
    },
    primaryType: 'Attestation',
    domain: {
      name: 'ProofStream',
      version: '1',
      chainId: arcTestnet.id,
      verifyingContract: streamAddress,
    },
    message: {
      nonce: a.nonce.toString(),
      certifiedBps: a.certifiedBps.toString(),
      prNumber: a.prNumber.toString(),
      commitSha: a.commitSha,
      confidenceBps: a.confidenceBps.toString(),
      issuedAt: a.issuedAt.toString(),
      milestoneHash: a.milestoneHash,
    },
  };
}

/// The agent signs with its own Circle-custodied key — no private key here.
export async function signAttestation(
  streamAddress: `0x${string}`,
  a: Attestation,
): Promise<`0x${string}`> {
  const res = await circle.signTypedData({
    walletId: env.agentWalletId,
    data: JSON.stringify(typedData(streamAddress, a)),
  });
  const signature = res.data?.signature;
  if (!signature) throw new Error('Circle returned no signature');
  return signature as `0x${string}`;
}

export type CertifyResult = {
  transactionId: string;
  state: string;
  txHash?: string;
  errorReason?: string;
};

/// Sends `certify` from the agent's own wallet, paying its own gas in USDC.
/// callData is viem-encoded because Circle's abiParameters cannot express a
/// struct argument.
///
/// This raises the contributor's claim; it does not move money. The clock
/// meters payment out afterwards, which is why one call keeps paying.
export async function sendCertification(
  streamAddress: `0x${string}`,
  a: Attestation,
  signature: `0x${string}`,
): Promise<CertifyResult> {
  const callData = encodeFunctionData({
    abi: WORK_STREAM_ABI,
    functionName: 'certify',
    args: [a, signature],
  });

  const res = await circle.createContractExecutionTransaction({
    walletId: env.agentWalletId,
    contractAddress: streamAddress,
    callData,
    fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
    idempotencyKey: randomUUID(),
  });

  const transactionId = res.data?.id;
  if (!transactionId) throw new Error('Circle returned no transaction id');

  // A failed poll is not an answer about the transaction, so `pollUntilTerminal`
  // swallows one and keeps going rather than throwing out of this function. A
  // throw here would bypass the confirmation below entirely and land in the
  // pipeline's catch as `unlock_failed`, which is the outcome that loses a real
  // transaction from the ledger. See poll.ts.
  const polled = await pollUntilTerminal(
    async () => (await circle.getTransaction({ id: transactionId })).data?.transaction,
    { onError: (err) => console.warn(`[chain] poll of ${transactionId} failed, retrying:`, err) },
  );

  const result: CertifyResult = {
    transactionId,
    state: polled.state,
    txHash: polled.txHash,
    errorReason: polled.errorReason,
  };

  // A timeout is not an outcome, so do not let it be recorded as one.
  return polled.timedOut ? confirmOnChain(streamAddress, a, result) : result;
}

/// A log the contract emitted for THIS attestation, or undefined.
///
/// Filtering on the indexed nonce alone is not proof of authorship: the nonce is
/// the contract's, and any caller holding a valid signature may spend it. So the
/// unindexed fields are checked too — if something else consumed our nonce, ours
/// reverted and must be reported as the failure it was.
export function matchingCertification<
  T extends { args: { nonce?: bigint; prNumber?: bigint; certifiedBps?: bigint } },
>(logs: readonly T[], a: Attestation): T | undefined {
  return logs.find(
    (l) =>
      l.args.nonce === a.nonce &&
      l.args.prNumber === a.prNumber &&
      l.args.certifiedBps === a.certifiedBps,
  );
}

/// Circle stopped answering before the transaction reached a terminal state.
/// That is NOT the transaction failing, and recording it as one is expensive:
/// the pipeline logs `unlock_failed`, EVIDENCE.md loses a real on-chain
/// transaction, and `reconcile`'s `alreadyJudged` sees the row and never
/// revisits the PR — so a certification that actually landed stays invisible
/// forever, and the contributor's raised claim is nowhere in the ledger.
///
/// So ask the chain, which knew all along. Failing to confirm returns the
/// timeout unchanged rather than guessing in either direction: an unknown
/// reported as unknown can be chased, an unknown reported as success cannot.
async function confirmOnChain(
  streamAddress: `0x${string}`,
  a: Attestation,
  timedOut: CertifyResult,
): Promise<CertifyResult> {
  try {
    const latest = await withRetry(() => publicClient.getBlockNumber());
    const logs = await withRetry(() =>
      publicClient.getLogs({
        address: streamAddress,
        event: CERTIFIED_EVENT,
        args: { nonce: a.nonce, prNumber: a.prNumber },
        fromBlock: latest > CONFIRM_LOOKBACK ? latest - CONFIRM_LOOKBACK : 0n,
        toBlock: 'latest',
      }),
    );

    const hit = matchingCertification(logs, a);
    if (!hit) return timedOut;

    return {
      transactionId: timedOut.transactionId,
      state: 'COMPLETE',
      txHash: hit.transactionHash,
    };
  } catch (err) {
    return {
      ...timedOut,
      errorReason: `could not confirm on chain: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// The poll loop itself now lives in poll.ts, where it can be tested without an
// .env. A policy revert still surfaces as FAILED, which is a demo feature and
// not a bug: it proves the agent physically cannot exceed its on-chain mandate.
