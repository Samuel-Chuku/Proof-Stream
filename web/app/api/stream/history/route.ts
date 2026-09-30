import { parseUsdc } from '@proofstream/config';
import { type NextRequest, NextResponse } from 'next/server';
import { HISTORY_LIMIT, readAgentLogs } from '../../../../lib/events';
import { readStream } from '../../../../lib/stream';
import { streamHistory } from '../../../../lib/stream-history';

export const runtime = 'nodejs';

/// WHERE A STREAM'S MONEY WAS, OVER TIME.
///
/// A route rather than part of the page, because the chart is only worth its
/// cost once somebody opens a fold. Rendering it for every position in a list
/// would read the chain and the ledger for streams nobody looked at.
///
/// THE CERTIFICATIONS COME FROM THE AGENT'S LEDGER, not from chain logs, and
/// that is deliberate: the ledger already records the cumulative claim and the
/// moment for every certification, it is the same source the AGENT DECISIONS
/// feed reads, so the chart and the feed can never disagree, and every row of
/// it carries the transaction hash that backs it. Deriving the series from
/// `Certified` logs instead would mean a log scan plus a block-timestamp
/// lookup per event, for the same answer.
export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get('address') ?? '';
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return NextResponse.json({ error: 'a stream address is required' }, { status: 400 });
  }

  const stream = await readStream(address);
  if (!stream) return NextResponse.json({ error: 'no such stream' }, { status: 404 });

  // THE WHOLE HISTORY, NOT THE FEED'S WINDOW. The decisions feed asks for the
  // most recent 120 because that is all it claims to show. A chart drawn from a
  // truncated window does not look truncated: the certifications that scrolled
  // off simply do not appear, and it draws a flat line where money moved.
  const { verdicts } = await readAgentLogs(HISTORY_LIMIT);

  // ONE STREAM AND ONE MILESTONE. The ledger is fleet-wide, and a milestone
  // index is reused by every stream, so filtering on either alone mixes another
  // employer's decisions into this chart.
  const certifications = verdicts
    .filter(
      (v) =>
        v.event === 'unlocked' &&
        v.workStream?.toLowerCase() === address.toLowerCase() &&
        (v.milestoneIndex === undefined || v.milestoneIndex === stream.milestoneIndex),
    )
    .flatMap((v) => {
      // `claimUsdc` is the CUMULATIVE claim after that certification, which is
      // what the contract's own `target()` holds and what the chart steps to.
      // A row without it predates the field and is skipped rather than guessed:
      // a missing step draws a flat line, an invented one draws a lie.
      if (!v.claimUsdc) return [];
      const at = Math.floor(Date.parse(v.at) / 1000);
      if (!Number.isFinite(at)) return [];
      try {
        return [{ at, target: parseUsdc(v.claimUsdc) }];
      } catch {
        return [];
      }
    });

  // AND IF EVEN THAT WINDOW MIGHT BE SHORT, DRAW NOTHING. The agent caps its
  // own feed, so a long-lived deployment can outrun it. When the oldest verdict
  // we can see is younger than this milestone, certifications may predate the
  // window and the chart would understate what the contributor is owed. A
  // missing chart is a gap; a chart that quietly reports less money than the
  // chain released is a lie about somebody's pay.
  const oldest = verdicts.reduce(
    (min, v) => Math.min(min, Math.floor(Date.parse(v.at) / 1000) || min),
    Number.POSITIVE_INFINITY,
  );
  if (verdicts.length >= HISTORY_LIMIT && stream.activatedAt > 0 && oldest > stream.activatedAt) {
    return NextResponse.json(
      { error: 'the agent log does not reach back to the start of this milestone' },
      { status: 409 },
    );
  }

  const buckets = streamHistory({
    budget: BigInt(stream.budget),
    startedAt: stream.activatedAt,
    duration: stream.duration,
    now: Math.floor(Date.now() / 1000),
    certifications,
  });

  return NextResponse.json({
    budget: stream.budget,
    // Serialised, because bigint does not survive JSON.
    buckets: buckets.map((b) => ({
      at: b.at,
      unlocked: b.unlocked.toString(),
      arriving: b.arriving.toString(),
      uncertified: b.uncertified.toString(),
    })),
  });
}
