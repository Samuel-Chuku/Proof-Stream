// Server-only. ARC_RPC_URL embeds a private Canteen token, so nothing in here
// may ever be imported by a client component — the browser gets numbers, never
// the transport.
import { USDC_ADDRESS } from '@proofstream/config';
import { createPublicClient, erc20Abi, http } from 'viem';
import { arcTestnet } from 'viem/chains';

const WORK_STREAM_ABI = [
  { type: 'function', name: 'milestone', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'repo', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'funded', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'budget', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'duration', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'activatedAt', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint64' }] },
  { type: 'function', name: 'fullyFunded', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'milestoneIndex', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'milestoneUnlocked', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'pausedSeconds', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'pausedAt', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint64' }] },
  { type: 'function', name: 'paused', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'unlocked', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'contributorCredited', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'withdrawn', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'nonce', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'agent', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'employer', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'contributor', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'withdrawable', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'milestoneClosed', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'vestingVault', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  {
    type: 'function',
    name: 'policy',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }, { type: 'uint256' }, { type: 'address' }],
  },
] as const;

/** Everything the page needs, as strings — bigints do not cross to the client. */
export type Stream = {
  address: string;
  milestone: string;
  /** The repo the employer registered on-chain for this job. */
  repo: string;
  /** The employer's deposited job budget. Accrual is capped at this, so every
   *  tranche the agent certifies is backed by USDC already in the contract. */
  funded: string;
  /** USDC committed to this milestone. */
  budget: string;
  /** Seconds the budget accrues over, once started. */
  duration: number;
  /** When the milestone started; 0 means the budget is not fully in yet. */
  activatedAt: number;
  fullyFunded: boolean;
  milestoneIndex: number;
  milestoneUnlocked: string;
  pausedSeconds: number;
  pausedAt: number;
  paused: boolean;
  unlocked: string;
  contributorCredited: string;
  /** Who may call the employer-only functions. Immutable. */
  employer: string;
  /** Who may call withdraw(). Immutable. */
  contributor: string;
  /** The only address withdraw() may pay. */
  payee: string;
  /** Credited but not yet paid out. */
  withdrawable: string;
  /** Settled. A closed milestone cannot be closed, paused or funded again. */
  milestoneClosed: boolean;
  withdrawn: string;
  nonce: number;
  agent: string;
  vault: string;
  maxTranche: string;
  dailyUnlockCap: string;
  /** USDC physically in the contract right now. */
  held: string;
};

// Arc rate-limits bursts, so reads are sequential with a retry rather than a
// Promise.all that trips -32011.
async function withRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (!String((err as Error).message).includes('request limit reached') || i >= attempts - 1) throw err;
      await new Promise((r) => setTimeout(r, 400 * 2 ** i));
    }
  }
}

/// One stream's full state. The address is a parameter now that the app serves
/// many streams; WORKSTREAM_ADDRESS remains the fallback so a single-stream
/// deployment keeps working with no configuration change.
export async function readStream(streamAddress?: string): Promise<Stream | null> {
  const address = (streamAddress ?? process.env.WORKSTREAM_ADDRESS) as `0x${string}` | undefined;
  if (!address) return null;

  const client = createPublicClient({ chain: arcTestnet, transport: http(process.env.ARC_RPC_URL) });
  const read = <T>(functionName: string) =>
    withRetry(() => client.readContract({ address, abi: WORK_STREAM_ABI, functionName: functionName as never }) as Promise<T>);

  try {
    const [maxTranche, dailyUnlockCap, payee] = await read<[bigint, bigint, `0x${string}`]>('policy');
    const held = await withRetry(() =>
      client.readContract({ address: USDC_ADDRESS, abi: erc20Abi, functionName: 'balanceOf', args: [address] }),
    );

    return {
      address,
      milestone: await read<string>('milestone'),
      repo: await read<string>('repo'),
      funded: (await read<bigint>('funded')).toString(),
      budget: (await read<bigint>('budget')).toString(),
      duration: Number(await read<bigint>('duration')),
      activatedAt: Number(await read<bigint>('activatedAt')),
      fullyFunded: await read<boolean>('fullyFunded'),
      milestoneIndex: Number(await read<bigint>('milestoneIndex')),
      milestoneUnlocked: (await read<bigint>('milestoneUnlocked')).toString(),
      pausedSeconds: Number(await read<bigint>('pausedSeconds')),
      pausedAt: Number(await read<bigint>('pausedAt')),
      paused: await read<boolean>('paused'),
      unlocked: (await read<bigint>('unlocked')).toString(),
      contributorCredited: (await read<bigint>('contributorCredited')).toString(),
      employer: await read<`0x${string}`>('employer'),
      contributor: await read<`0x${string}`>('contributor'),
      payee,
      withdrawable: (await read<bigint>('withdrawable')).toString(),
      milestoneClosed: await read<boolean>('milestoneClosed'),
      withdrawn: (await read<bigint>('withdrawn')).toString(),
      nonce: Number(await read<bigint>('nonce')),
      agent: await read<`0x${string}`>('agent'),
      vault: await read<`0x${string}`>('vestingVault'),
      maxTranche: maxTranche.toString(),
      dailyUnlockCap: dailyUnlockCap.toString(),
      held: held.toString(),
    };
  } catch {
    return null;
  }
}
