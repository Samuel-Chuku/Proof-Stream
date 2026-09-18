// WHO HAS EARNED FROM AN OPEN STREAM, and what each of them may take.
//
// Server-only. The contract keeps credit in a mapping keyed by an opaque earner
// id, so nothing can be listed by reading state alone. Each certification on an
// open stream emits EarnerCredited, and this module folds those events into the
// set of earners, then reads each one's live position in a single multicall.
//
// The id is a hash. Mapping it back to a person is the dashboard's job, done
// from the agent's ledger, which records the author alongside the id it
// credited. That pairing exists nowhere else.
import { WORK_STREAM_ABI } from '@proofstream/config';
import { createPublicClient, http, parseAbiItem } from 'viem';
import { arcTestnet } from 'viem/chains';

export type Earner = {
  /** keccak256("github:<numeric id>"), as the contract stores it. */
  earnerId: `0x${string}`;
  /** Share of this milestone credited to them, in basis points. */
  creditBps: number;
  /** Their proportional slice of what is released so far, in USDC units. */
  share: string;
  /** What they may still take, in USDC units. */
  withdrawable: string;
  /** What they have already taken, in USDC units. */
  paid: string;
  /** Where they are paid, once they have chosen. Null until they bind one. */
  payee: `0x${string}` | null;
};

const EVENTS = [
  parseAbiItem('event EarnerCredited(uint256 indexed milestone, bytes32 indexed earnerId, uint256 addedBps, uint256 totalBps)'),
  parseAbiItem('event PayeeBound(bytes32 indexed earnerId, address indexed payee)'),
] as const;

/// Arc's eth_getLogs ceiling, mirrored from onchain.ts. Do not raise it.
const MAX_LOG_WINDOW = 45_000n;
const CREATION_MARGIN = 45_000n;

const cache = new Map<string, { at: number; rows: Earner[] }>();
const TTL_MS = 20_000;

/// Every earner credited on one milestone of one stream, with their live
/// position. Empty for a named stream, and empty for an open stream nobody has
/// earned from yet, which the page renders as an invitation rather than a gap.
export async function readEarners(
  address: string,
  milestoneIndex: number,
  registeredAtBlock: bigint,
  fresh = false,
): Promise<Earner[]> {
  const key = `${address.toLowerCase()}:${milestoneIndex}`;
  const hit = cache.get(key);
  if (!fresh && hit && Date.now() - hit.at < TTL_MS) return hit.rows;

  const client = createPublicClient({
    chain: arcTestnet,
    transport: http(process.env.ARC_RPC_URL, { batch: { wait: 8 } }),
    batch: { multicall: true },
  });
  const stream = address as `0x${string}`;
  const m = BigInt(milestoneIndex);

  try {
    const latest = await client.getBlockNumber();
    let cursor = registeredAtBlock > CREATION_MARGIN ? registeredAtBlock - CREATION_MARGIN : 0n;

    const ids = new Set<`0x${string}`>();
    const bound = new Map<string, `0x${string}`>();

    while (cursor <= latest) {
      const to = cursor + MAX_LOG_WINDOW - 1n > latest ? latest : cursor + MAX_LOG_WINDOW - 1n;
      const logs = await client.getLogs({ address: stream, events: EVENTS, fromBlock: cursor, toBlock: to });
      for (const entry of logs) {
        const name = (entry as { eventName?: string }).eventName;
        const args = (entry as { args: Record<string, unknown> }).args;
        if (name === 'EarnerCredited' && args.milestone === m) ids.add(args.earnerId as `0x${string}`);
        if (name === 'PayeeBound') bound.set((args.earnerId as string).toLowerCase(), args.payee as `0x${string}`);
      }
      cursor = to + 1n;
    }

    if (ids.size === 0) {
      cache.set(key, { at: Date.now(), rows: [] });
      return [];
    }

    // One multicall for every earner's four figures. The batcher folds these
    // into a single request; awaiting them one earner at a time is the shape
    // that made the stream page take seconds.
    const list = [...ids];
    const reads = await Promise.all(
      list.flatMap((id) => [
        client.readContract({ address: stream, abi: WORK_STREAM_ABI, functionName: 'creditBps', args: [m, id] }),
        client.readContract({ address: stream, abi: WORK_STREAM_ABI, functionName: 'earnerShare', args: [m, id] }),
        client.readContract({ address: stream, abi: WORK_STREAM_ABI, functionName: 'earnerWithdrawable', args: [m, id] }),
        client.readContract({ address: stream, abi: WORK_STREAM_ABI, functionName: 'paidTo', args: [m, id] }),
      ]),
    );

    const rows: Earner[] = list.map((id, i) => ({
      earnerId: id,
      creditBps: Number(reads[i * 4] as bigint),
      share: (reads[i * 4 + 1] as bigint).toString(),
      withdrawable: (reads[i * 4 + 2] as bigint).toString(),
      paid: (reads[i * 4 + 3] as bigint).toString(),
      payee: bound.get(id.toLowerCase()) ?? null,
    }));

    // Largest share first: the person who did most of the work reads first.
    rows.sort((a, b) => b.creditBps - a.creditBps);
    cache.set(key, { at: Date.now(), rows });
    return rows;
  } catch {
    // A page that 500s because one log window timed out is worse than one that
    // renders the chain state and an empty table.
    return hit?.rows ?? [];
  }
}
