// WHAT ONE PERSON IS OWED, across every stream that knows them.
//
// Server-only. A contract can know a contributor two ways, and the page shows
// both in one ledger:
//
//   by GitHub   a public stream credits an opaque id hashed from the account
//               that merged the work. Found through EarnerCredited, which
//               indexes that id.
//   by wallet   a named stream fixes `contributor` at deploy; a public stream
//               records the payee an earner bound. Found by reading
//               `contributor` on every stream, and through PayeeBound, which
//               indexes the payee.
//
// Whichever way a stream was found, it becomes the same Position, so the page
// renders one kind of block and the reader never has to learn two.
//
// Everything here is read from the chain, and it is what the page shows BEFORE
// any wallet is asked for anything. A page that asks for a signature first and
// explains afterwards is the shape every drainer copies; this one has to be
// able to show the stream's own terms, from its own contract, to earn the prompt.
import { WORK_STREAM_ABI } from '@proofstream/config';
import { createPublicClient, http, parseAbiItem } from 'viem';
import { arcTestnet } from 'viem/chains';
import { listStreams, type StreamSummary } from './registry';
import { readStream } from './stream';

export type Earning = {
  milestoneIndex: number;
  /** Share of that milestone credited to this person, in basis points. A
   *  named contributor is the whole stream: 10 000. */
  creditBps: number;
  /** What the clock has released to them, USDC units. */
  released: string;
  withdrawable: string;
  paid: string;
  /** A closed milestone's share is frozen; an open one still grows with the clock. */
  closed: boolean;
};

export type Position = {
  /** How the contract knows this person on this stream. Decides which
   *  function withdraws and whether a payee has to be chosen first. */
  kind: 'public' | 'named';
  address: string;
  employer: string;
  repo: string;
  /** The current milestone's text. Earlier milestones' text is gone from
   *  chain once they close; only the index survives. */
  milestone: string;
  milestoneIndex: number;
  budget: string;
  state: StreamSummary['state'];
  /** Where this person is paid. A named stream fixed it at deploy; a public
   *  one leaves it null until the earner binds. */
  payee: `0x${string}` | null;
  /** Named only: the one address allowed to call withdraw(). */
  contributor: `0x${string}` | null;
  /** Public only: the id withdrawFor() is keyed by. */
  earnerId: `0x${string}` | null;
  /** Public only: payout ceilings. "0" on a named stream, which has none. */
  claimCap: string;
  dailyClaimCap: string;
  claimedToday: string;
  claimDayBucket: string;
  earnings: Earning[];
};

const CREDITED = parseAbiItem(
  'event EarnerCredited(uint256 indexed milestone, bytes32 indexed earnerId, uint256 addedBps, uint256 totalBps)',
);
const BOUND = parseAbiItem('event PayeeBound(bytes32 indexed earnerId, address indexed payee)');

/// Arc's eth_getLogs ceiling, mirrored from onchain.ts. Do not raise it.
const MAX_LOG_WINDOW = 45_000n;
const CREATION_MARGIN = 45_000n;

const ZERO = /^0x0{40}$/i;

const client = () =>
  createPublicClient({
    chain: arcTestnet,
    transport: http(process.env.ARC_RPC_URL, { batch: { wait: 8 } }),
    batch: { multicall: true },
  });

type Client = ReturnType<typeof client>;

/// One stream's log, from the block it was announced in, paged under Arc's
/// window ceiling. `args` narrows by indexed topic so the cost is the same
/// however busy the stream is.
async function scan<E extends typeof CREDITED | typeof BOUND>(
  rpc: Client,
  summary: StreamSummary,
  event: E,
  args: Record<string, unknown>,
) {
  const stream = summary.address as `0x${string}`;
  const registered = BigInt(summary.registeredAtBlock);
  const latest = await rpc.getBlockNumber();
  let cursor = registered > CREATION_MARGIN ? registered - CREATION_MARGIN : 0n;
  const found: { args: Record<string, unknown> }[] = [];
  while (cursor <= latest) {
    const to = cursor + MAX_LOG_WINDOW - 1n > latest ? latest : cursor + MAX_LOG_WINDOW - 1n;
    const logs = await rpc.getLogs({ address: stream, event, args: args as never, fromBlock: cursor, toBlock: to });
    found.push(...(logs as unknown as { args: Record<string, unknown> }[]));
    cursor = to + 1n;
  }
  return found;
}

/// Every public v3 stream in the registry. Only a v3 stream can be public,
/// and only a public one keeps credit or bindings.
async function publicStreams(rpc: Client): Promise<StreamSummary[]> {
  const candidates = (await listStreams()).filter((s) => s.version >= 3);
  const flags = await Promise.all(
    candidates.map((s) =>
      rpc
        .readContract({ address: s.address as `0x${string}`, abi: WORK_STREAM_ABI, functionName: 'isPublic' })
        .catch(() => false),
    ),
  );
  return candidates.filter((_, i) => flags[i]);
}

/// One earner's position on one public stream, or null if never credited.
async function publicPosition(rpc: Client, s: StreamSummary, earnerId: `0x${string}`): Promise<Position | null> {
  const stream = s.address as `0x${string}`;
  const milestones = new Set<bigint>();
  for (const entry of await scan(rpc, s, CREDITED, { earnerId })) milestones.add(entry.args.milestone as bigint);
  if (milestones.size === 0) return null;

  const read = <T>(functionName: string, args: readonly unknown[] = []) =>
    rpc.readContract({ address: stream, abi: WORK_STREAM_ABI, functionName: functionName as never, args: args as never }) as Promise<T>;

  const list = [...milestones].sort((a, b) => Number(b - a));
  const [payee, policy, claimedToday, claimDayBucket, ...perMilestone] = await Promise.all([
    read<`0x${string}`>('payeeOf', [earnerId]),
    read<readonly [bigint, bigint, `0x${string}`, bigint, bigint]>('policy'),
    read<bigint>('claimedToday'),
    read<bigint>('claimDayBucket'),
    ...list.flatMap((m) => [
      read<bigint>('creditBps', [m, earnerId]),
      read<bigint>('earnerShare', [m, earnerId]),
      read<bigint>('earnerWithdrawable', [m, earnerId]),
      read<bigint>('paidTo', [m, earnerId]),
    ]),
  ]);

  return {
    kind: 'public',
    address: s.address,
    employer: s.employer,
    repo: s.repo,
    milestone: s.milestone,
    milestoneIndex: s.milestoneIndex,
    budget: s.budget,
    state: s.state,
    payee: ZERO.test(payee) ? null : payee,
    contributor: null,
    earnerId,
    claimCap: policy[3].toString(),
    dailyClaimCap: policy[4].toString(),
    claimedToday: claimedToday.toString(),
    claimDayBucket: claimDayBucket.toString(),
    earnings: list.map((m, i) => ({
      milestoneIndex: Number(m),
      creditBps: Number(perMilestone[i * 4] as bigint),
      released: (perMilestone[i * 4 + 1] as bigint).toString(),
      withdrawable: (perMilestone[i * 4 + 2] as bigint).toString(),
      paid: (perMilestone[i * 4 + 3] as bigint).toString(),
      // The current milestone is open unless the summary says it settled;
      // anything earlier was closed to make way for it.
      closed: Number(m) !== s.milestoneIndex || s.state === 'settled',
    })),
  };
}

/// A named contributor's position: the whole stream, one row. `withdrawable()`
/// already folds in credit from closed milestones, so the row is the stream's
/// running total rather than one milestone's slice.
async function namedPosition(s: StreamSummary): Promise<Position | null> {
  const stream = await readStream(s.address);
  if (!stream) return null;
  const withdrawable = BigInt(stream.withdrawable);
  const withdrawn = BigInt(stream.withdrawn);
  return {
    kind: 'named',
    address: s.address,
    employer: s.employer,
    repo: s.repo,
    milestone: s.milestone,
    milestoneIndex: s.milestoneIndex,
    budget: s.budget,
    state: s.state,
    payee: stream.payee as `0x${string}`,
    contributor: stream.contributor as `0x${string}`,
    earnerId: null,
    claimCap: '0',
    dailyClaimCap: '0',
    claimedToday: '0',
    claimDayBucket: '0',
    earnings: [
      {
        milestoneIndex: s.milestoneIndex,
        creditBps: 10_000,
        released: (withdrawable + withdrawn).toString(),
        withdrawable: stream.withdrawable,
        paid: stream.withdrawn,
        closed: s.state === 'settled',
      },
    ],
  };
}

/// Most still owed first: the row someone came here for reads first.
const owed = (p: Position) => p.earnings.reduce((sum, e) => sum + BigInt(e.withdrawable), 0n);
const byOwed = (rows: (Position | null)[]) =>
  rows.filter((r): r is Position => r !== null).sort((a, b) => Number(owed(b) - owed(a)));

const cache = new Map<string, { at: number; rows: Position[] }>();
const TTL_MS = 20_000;

/// Every public stream this GitHub account has been credited on. Empty when
/// nothing has been credited anywhere, which the page renders as an
/// explanation of how to earn, not as a gap.
export async function readEarnings(earnerId: `0x${string}`, fresh = false): Promise<Position[]> {
  const key = `gh:${earnerId.toLowerCase()}`;
  const hit = cache.get(key);
  if (!fresh && hit && Date.now() - hit.at < TTL_MS) return hit.rows;
  try {
    const rpc = client();
    const streams = await publicStreams(rpc);
    const rows = byOwed(await Promise.all(streams.map((s) => publicPosition(rpc, s, earnerId))));
    cache.set(key, { at: Date.now(), rows });
    return rows;
  } catch {
    // A page that 500s because one log window timed out is worse than one
    // that says nothing is credited yet and invites a reload.
    return hit?.rows ?? [];
  }
}

/// Every stream that knows this wallet: named streams where it is the
/// contributor, and public streams where an earner bound it as their payee.
export async function readWalletEarnings(wallet: `0x${string}`, fresh = false): Promise<Position[]> {
  const key = `w:${wallet.toLowerCase()}`;
  const hit = cache.get(key);
  if (!fresh && hit && Date.now() - hit.at < TTL_MS) return hit.rows;
  try {
    const rpc = client();
    const all = await listStreams();

    // `contributor` on every stream, one multicall. A v1 stream answers this
    // too; the field predates everything else here.
    const contributors = await Promise.all(
      all.map((s) =>
        rpc
          .readContract({ address: s.address as `0x${string}`, abi: WORK_STREAM_ABI, functionName: 'contributor' })
          .catch(() => null),
      ),
    );
    const named = all.filter((_, i) => (contributors[i] as string | null)?.toLowerCase() === wallet.toLowerCase());

    // Public streams that bound this wallet, and for which earner. One wallet
    // could in principle be bound by several earners on one stream; each is
    // its own position.
    const bound: [StreamSummary, `0x${string}`][] = [];
    for (const s of await publicStreams(rpc)) {
      for (const entry of await scan(rpc, s, BOUND, { payee: wallet })) bound.push([s, entry.args.earnerId as `0x${string}`]);
    }

    const rows = byOwed(
      await Promise.all([
        ...named.map((s) => namedPosition(s)),
        ...bound.map(([s, id]) => publicPosition(rpc, s, id)),
      ]),
    );
    cache.set(key, { at: Date.now(), rows });
    return rows;
  } catch {
    return hit?.rows ?? [];
  }
}
