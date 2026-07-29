import { randomUUID } from 'node:crypto';
import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets';
import { createPublicClient, encodeFunctionData, http } from 'viem';
import { arcTestnet } from 'viem/chains';
import { env } from './env';

const WORK_STREAM_ABI = [
  { type: 'function', name: 'milestone', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'milestoneHash', stateMutability: 'view', inputs: [], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'nonce', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'accrued', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'unlocked', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
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
    name: 'unlock',
    stateMutability: 'nonpayable',
    inputs: [
      {
        type: 'tuple',
        name: 'a',
        components: [
          { name: 'nonce', type: 'uint256' },
          { name: 'tranche', type: 'uint256' },
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

export type StreamState = {
  milestone: string;
  milestoneHash: `0x${string}`;
  nonce: bigint;
  accrued: bigint;
  unlocked: bigint;
  paused: boolean;
  maxTranche: bigint;
  dailyUnlockCap: bigint;
};

export type Attestation = {
  nonce: bigint;
  tranche: bigint;
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

export async function readStream(): Promise<StreamState> {
  const read = <T>(functionName: string) =>
    withRetry(
      () =>
        publicClient.readContract({
          address: env.workStream,
          abi: WORK_STREAM_ABI,
          functionName: functionName as never,
        }) as Promise<T>,
    );

  const milestone = await read<string>('milestone');
  const milestoneHash = await read<`0x${string}`>('milestoneHash');
  const nonce = await read<bigint>('nonce');
  const accrued = await read<bigint>('accrued');
  const unlocked = await read<bigint>('unlocked');
  const paused = await read<boolean>('paused');
  const [maxTranche, dailyUnlockCap] = await read<[bigint, bigint, string]>('policy');

  return { milestone, milestoneHash, nonce, accrued, unlocked, paused, maxTranche, dailyUnlockCap };
}

/// EIP-712 payload. Domain and field order must match WorkStream.sol exactly —
/// any drift and the contract recovers a different signer and reverts.
function typedData(a: Attestation) {
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
        { name: 'tranche', type: 'uint256' },
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
      verifyingContract: env.workStream,
    },
    message: {
      nonce: a.nonce.toString(),
      tranche: a.tranche.toString(),
      prNumber: a.prNumber.toString(),
      commitSha: a.commitSha,
      confidenceBps: a.confidenceBps.toString(),
      issuedAt: a.issuedAt.toString(),
      milestoneHash: a.milestoneHash,
    },
  };
}

/// The agent signs with its own Circle-custodied key — no private key here.
export async function signAttestation(a: Attestation): Promise<`0x${string}`> {
  const res = await circle.signTypedData({
    walletId: env.agentWalletId,
    data: JSON.stringify(typedData(a)),
  });
  const signature = res.data?.signature;
  if (!signature) throw new Error('Circle returned no signature');
  return signature as `0x${string}`;
}

export type UnlockResult = {
  transactionId: string;
  state: string;
  txHash?: string;
  errorReason?: string;
};

/// Sends `unlock` from the agent's own wallet, paying its own gas in USDC.
/// callData is viem-encoded because Circle's abiParameters cannot express a
/// struct argument.
export async function sendUnlock(a: Attestation, signature: `0x${string}`): Promise<UnlockResult> {
  const callData = encodeFunctionData({
    abi: WORK_STREAM_ABI,
    functionName: 'unlock',
    args: [a, signature],
  });

  const res = await circle.createContractExecutionTransaction({
    walletId: env.agentWalletId,
    contractAddress: env.workStream,
    callData,
    fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
    idempotencyKey: randomUUID(),
  });

  const transactionId = res.data?.id;
  if (!transactionId) throw new Error('Circle returned no transaction id');
  return waitForTransaction(transactionId);
}

const TERMINAL = new Set(['COMPLETE', 'FAILED', 'DENIED', 'CANCELLED']);

/// A policy revert surfaces here as FAILED — that is a demo feature, not a
/// bug: it proves the agent physically cannot exceed its on-chain mandate.
async function waitForTransaction(transactionId: string, timeoutMs = 120_000): Promise<UnlockResult> {
  const deadline = Date.now() + timeoutMs;
  let last = 'INITIATED';

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3_000));
    const res = await circle.getTransaction({ id: transactionId });
    const tx = res.data?.transaction;
    last = tx?.state ?? last;
    if (TERMINAL.has(last)) {
      return { transactionId, state: last, txHash: tx?.txHash, errorReason: tx?.errorReason };
    }
  }
  return { transactionId, state: `TIMEOUT_AFTER_${last}` };
}
