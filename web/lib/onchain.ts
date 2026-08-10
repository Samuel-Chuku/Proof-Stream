// Server-only. The stream's own event log — what PEOPLE did to it.
//
// The agent's transactions come from verdicts.jsonl, because each one carries a
// verdict the log file holds and the chain does not. Human actions have no such
// record, so they are read from the chain directly: funding, closing, pausing,
// withdrawing. That is also the stronger source — it is what the explorer will
// show a reader who checks.
//
// Deliberately NOT included: ERC-20 `approve`. It is a permission, not a
// movement of money, and listing one row per approval would bury the four
// transactions that actually changed something.
import { createPublicClient, http, parseAbiItem } from 'viem';
import { arcTestnet } from 'viem/chains';

const EVENTS = [
  parseAbiItem('event Funded(address indexed from, uint256 amount, uint256 milestoneFunded)'),
  parseAbiItem('event MilestoneActivated(uint256 indexed index, uint64 at, uint256 budget)'),
  parseAbiItem(
    'event MilestoneOpened(uint256 indexed index, bytes32 indexed hash, string text, uint256 budget, uint256 duration)',
  ),
  parseAbiItem('event MilestoneClosed(uint256 indexed index, uint256 unlockedFromMilestone, uint256 returned)'),
  parseAbiItem('event Withdrawn(address indexed payee, uint256 amount)'),
  parseAbiItem('event StreamPaused(uint64 at)'),
  parseAbiItem('event StreamResumed(uint64 at)'),
  parseAbiItem('event RepoSet(string repo)'),
  // Moves no money, but it is the employer widening what the agent may ever
  // spend. That belongs in the public record next to the payments it governs —
  // a mandate change is exactly the kind of thing a contributor should be able
  // to see without being told.
  parseAbiItem('event PolicyRaised(uint256 maxTranche, uint256 dailyUnlockCap)'),
] as const;

const MAX_LOG_WINDOW = 45_000n;

/// How far before registration to start looking. `/new` deploys and announces
/// back to back, but the deploy transaction emits `MilestoneOpened` from the
/// constructor and lands FIRST — so a scan anchored exactly at registration
/// would miss the stream being created. One window covers roughly seven hours
/// of Arc at current block times, which is generous for a two-transaction gap.
const CREATION_MARGIN = 45_000n;

export type OnChainTx = {
  txHash: string;
  blockNumber: number;
  /** Unix seconds, from the block. */
  at: number;
  action: string;
  /** 6dp USDC, when the action moved money. */
  amountRaw?: string;
  /** Short clause shown beside the action. */
  detail?: string;
  /** Who was allowed to send it. Not read from the transaction — the contract's
   *  own permissions decide it: `withdraw` is the contributor's, and every other
   *  action here is employer-only. Without this the two parties' transactions
   *  were an undifferentiated list under one "BY A HUMAN" heading. */
  by: 'EMPLOYER' | 'CONTRIBUTOR';
};

/// One row per TRANSACTION, not per event. `fund` can emit Funded and
/// MilestoneActivated together, and `closeMilestone` emits MilestoneClosed and
/// Reclaimed — rendering each separately would double-count a single action.
/// Higher wins.
const PRIORITY: Record<string, number> = {
  MilestoneClosed: 6,
  Funded: 5,
  MilestoneOpened: 4,
  Withdrawn: 3,
  StreamPaused: 2,
  StreamResumed: 2,
  RepoSet: 1,
  PolicyRaised: 1,
  MilestoneActivated: 0,
};

const usdc = (v: bigint) => v.toString();

function describe(name: string, args: Record<string, unknown>): Omit<OnChainTx, 'txHash' | 'blockNumber' | 'at'> {
  switch (name) {
    case 'Funded':
      return { action: 'FUND', amountRaw: usdc(args.amount as bigint), by: 'EMPLOYER' };
    case 'MilestoneOpened':
      return { action: 'OPEN MILESTONE', amountRaw: usdc(args.budget as bigint), detail: 'BUDGET', by: 'EMPLOYER' };
    case 'MilestoneClosed':
      return {
        action: 'CLOSE MILESTONE',
        amountRaw: usdc(args.returned as bigint),
        detail: 'RETURNED TO EMPLOYER',
        by: 'EMPLOYER',
      };
    case 'Withdrawn':
      // The one action on this list the employer cannot take.
      return { action: 'WITHDRAW', amountRaw: usdc(args.amount as bigint), by: 'CONTRIBUTOR' };
    case 'StreamPaused':
      return { action: 'PAUSE', detail: 'THE CLOCK STOPS', by: 'EMPLOYER' };
    case 'StreamResumed':
      return { action: 'RESUME', detail: 'THE CLOCK RESTARTS', by: 'EMPLOYER' };
    case 'RepoSet':
      return { action: 'REPOINT', detail: String(args.repo ?? ''), by: 'EMPLOYER' };
    case 'PolicyRaised': {
      // No amountRaw: nothing moved. The caps are the story, so they go in the
      // detail where an amount would otherwise sit.
      const per = usdc(args.maxTranche as bigint);
      const day = usdc(args.dailyUnlockCap as bigint);
      const human = (v: string) => (Number(v) / 1e6).toFixed(0);
      return {
        action: 'RAISE LIMITS',
        detail: `NOW ${human(per)} PER CERTIFICATION · ${human(day)} PER DAY`,
        by: 'EMPLOYER',
      };
    }
    case 'MilestoneActivated':
      return { action: 'MILESTONE STARTS', detail: 'BUDGET FULLY DEPOSITED', by: 'EMPLOYER' };
    default:
      return { action: name.toUpperCase(), by: 'EMPLOYER' };
  }
}

const cache = new Map<string, { at: number; rows: OnChainTx[] }>();
const TTL_MS = 20_000;

/// Every human action against this stream, newest first.
///
/// `registeredAtBlock` bounds the scan to the stream's own lifetime. Without it
/// this would sweep from the registry's deploy block on every page load — 14
/// windows today, one more every seven hours, forever.
/// `fresh` bypasses the cache. The page reloads itself the moment a transaction
/// confirms, and this cache lives in the SERVER process — so a withdrawal that
/// had already been mined was answered from a snapshot taken seconds earlier and
/// simply did not appear. The contributor saw their balance change and the
/// transaction list not. Only the post-transaction reload asks for `fresh`;
/// ordinary navigation still gets the cache.
export async function readStreamTransactions(
  address: string,
  registeredAtBlock: bigint,
  fresh = false,
): Promise<OnChainTx[]> {
  const key = address.toLowerCase();
  const hit = cache.get(key);
  if (!fresh && hit && Date.now() - hit.at < TTL_MS) return hit.rows;

  const client = createPublicClient({
    chain: arcTestnet,
    transport: http(process.env.ARC_RPC_URL, { batch: { wait: 8 } }),
    batch: { multicall: true },
  });

  try {
    const latest = await client.getBlockNumber();
    let cursor = registeredAtBlock > CREATION_MARGIN ? registeredAtBlock - CREATION_MARGIN : 0n;

    // txHash -> the winning event for that transaction.
    const byTx = new Map<string, { name: string; args: Record<string, unknown>; block: bigint }>();

    while (cursor <= latest) {
      const to = cursor + MAX_LOG_WINDOW - 1n > latest ? latest : cursor + MAX_LOG_WINDOW - 1n;
      // All eight event types in ONE request per window, rather than one
      // request per event type per window.
      const logs = await client.getLogs({
        address: address as `0x${string}`,
        events: EVENTS,
        fromBlock: cursor,
        toBlock: to,
      });

      for (const entry of logs) {
        const name = (entry as { eventName?: string }).eventName;
        const hash = entry.transactionHash;
        if (!name || !hash) continue;
        const held = byTx.get(hash);
        if (held && (PRIORITY[held.name] ?? 0) >= (PRIORITY[name] ?? 0)) continue;
        byTx.set(hash, {
          name,
          args: (entry as { args?: Record<string, unknown> }).args ?? {},
          block: entry.blockNumber ?? 0n,
        });
      }

      cursor = to + 1n;
    }

    // Block timestamps are not in a log. Human actions are few — a handful per
    // stream — so fetching them is cheap, and the transport batches the calls
    // into one request.
    const blocks = [...new Set([...byTx.values()].map((e) => e.block))];
    const times = new Map<bigint, number>();
    await Promise.all(
      blocks.map(async (n) => {
        const block = await client.getBlock({ blockNumber: n });
        times.set(n, Number(block.timestamp));
      }),
    );

    const rows: OnChainTx[] = [...byTx.entries()]
      .map(([txHash, e]) => ({
        txHash,
        blockNumber: Number(e.block),
        at: times.get(e.block) ?? 0,
        ...describe(e.name, e.args),
      }))
      .sort((a, b) => b.blockNumber - a.blockNumber);

    cache.set(key, { at: Date.now(), rows });
    return rows;
  } catch {
    // A stream whose history cannot be read is not worth breaking the page
    // over — the rest of the page is live contract state and still correct.
    return [];
  }
}
