'use client';

import { useEffect, useState } from 'react';
import type { Stream } from '../lib/stream';
import { Amount } from './amount';

const USDC = 1_000_000;
const MAX_CELLS = 60;

/** WorkStream.accrued() recomputed locally so the figure ticks every second
 *  without an RPC call per tick — Arc rate-limits hard. Mirrors the contract
 *  exactly: `budget × elapsed / duration`, paused time excluded, stopping at
 *  the milestone's end, and zero before the budget is fully deposited. */
function accruedAt(stream: Stream, nowSeconds: number): number {
  if (stream.activatedAt === 0 || stream.duration === 0) return 0;

  const endsAt = stream.activatedAt + stream.duration;
  const upTo = Math.min(stream.paused ? stream.pausedAt : nowSeconds, endsAt);
  if (upTo <= stream.activatedAt) return 0;

  let elapsed = upTo - stream.activatedAt;
  if (elapsed <= stream.pausedSeconds) return 0;
  elapsed -= stream.pausedSeconds;
  if (elapsed > stream.duration) elapsed = stream.duration;

  return Math.floor((Number(stream.budget) * elapsed) / stream.duration);
}

type CellState = 'unlocked' | 'locked' | 'valued' | 'unaccrued';

/// Coarse and readable rather than precise: "1h 04m left" tells you what to do,
/// a ticking seconds counter only tells you to watch it. Seconds appear in the
/// last minute, where they are the only thing that matters.
function remaining(seconds: number): string {
  if (seconds <= 0) return 'ENDED';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const sec = seconds % 60;
  if (d > 0) return `${d}d ${String(h).padStart(2, '0')}h LEFT`;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m LEFT`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, '0')}s LEFT`;
  return `${sec}s LEFT`;
}

/// THE SIGNATURE ELEMENT. One cell = one USDC, so a viewer counts green cells
/// and knows exactly how much the agent released — no axis, no legend, no
/// tooltip. Cells are always sorted, so the bar reads left to right as
/// released → earned-but-locked → not yet earned.
/// Three fills, and the middle one is new. `earned` is what the contributor can
/// take right now — certified by the agent AND delivered by the clock. `target`
/// is everything the agent certified. The gap between them is certified work
/// the stream has not paid out yet, which the previous model could not express
/// at all: certification and payment were the same event.
/// `valued` is what BOTH agents agreed the work is worth. It sits above
/// `target` whenever the per-certification cap metered a judgment down: the
/// agents said 97% of a 100 USDC budget and a 30 USDC ceiling let the agent
/// certify 30. Without a fill of its own that 67 was indistinguishable from
/// work nobody had judged, which is the opposite of what happened.
function cells(budget: number, earned: number, target: number, valued: number) {
  const whole = Math.max(Math.ceil(budget / USDC), 1);
  const count = Math.min(whole, MAX_CELLS);
  // Above 60 USDC one cell stands for several, and the caption says so rather
  // than letting the count quietly stop meaning anything.
  const perCell = whole / count;

  const earnedCells = Math.round(earned / USDC / perCell);
  const targetCells = Math.round(target / USDC / perCell);
  const valuedCells = Math.round(valued / USDC / perCell);

  return {
    perCell,
    count,
    states: Array.from({ length: count }, (_, i): CellState => {
      if (i < earnedCells) return 'unlocked';
      if (i < targetCells) return 'locked';
      if (i < valuedCells) return 'valued';
      return 'unaccrued';
    }),
  };
}

export function LockedFigure({
  stream,
  agreedFraction,
}: {
  stream: Stream;
  /** The highest share BOTH agents have agreed is complete, 0–1. Above the
   *  certified share whenever a cap metered a judgment down. */
  agreedFraction?: number;
}) {
  // Starts null and fills in after mount: a live clock rendered on the server
  // mismatches the first client frame and React warns on hydration.
  const [now, setNow] = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setNow(Math.floor(Date.now() / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const budget = Number(stream.budget);
  const funded = Number(stream.funded);

  // The anti-rug gate, made visible. The employer has not deposited the whole
  // budget, so nothing has started — the one state a contributor must be able
  // to check before doing any work.
  if (!stream.fullyFunded) {
    const outstanding = budget - funded;
    return (
      <section className="ps-gate">
        <h2 className="ps-gate-head">
          MILESTONE {stream.milestoneIndex} — AWAITING FULL DEPOSIT
        </h2>

        {/* Deposited money is dithered, never green. It is not unlocked money
            and must not read as though it were — this is the green law doing
            actual work rather than being decorative. */}
        <div className="ps-gate-meter" role="presentation">
          <span
            className="ps-gate-meter-fill"
            style={{ width: `${Math.min((funded / Math.max(budget, 1)) * 100, 100)}%` }}
          />
        </div>

        <p className="ps-gate-figure">
          <Amount raw={funded} size="m" suffix={false} /> of <Amount raw={budget} size="m" /> deposited
        </p>

        <p className="ps-gate-body">
          The stream does not accrue until the budget is funded in full. Nothing is owed against an
          unfunded milestone, so no work should start against it yet.
        </p>

        <p className="ps-caption">
          OUTSTANDING <Amount raw={outstanding} size="s" />
        </p>
      </section>
    );
  }

  const target = Number(stream.target);
  const withdrawn = Number(stream.withdrawn);

  // Still ticking every second — that is the whole point of a stream — but now
  // clamped to what the agent certified, because accrual alone earns nothing.
  // At 100% the schedule is over, so the contract stops metering and the figure
  // sits at the full certified amount.
  const fullyCertified = stream.certifiedBps >= 10_000;
  const earned =
    now === null
      ? Number(stream.earned)
      : fullyCertified
        ? target
        : Math.min(accruedAt(stream, now), target);

  // Never below what is already certified: the agents cannot have agreed less
  // than the contract has recorded.
  const valued = Math.max(target, Math.round((agreedFraction ?? 0) * budget));
  const bar = cells(budget, earned, target, valued);

  const rate = stream.duration > 0 ? (budget / USDC / stream.duration) * 3600 : 0;

  // The clock the employer and contributor are both actually watching. Paused
  // freezes it: nothing accrues, so counting down would be a lie.
  const endsAt = stream.activatedAt + stream.duration;
  const secondsLeft = now === null ? null : Math.max(endsAt - now, 0);
  const ended = secondsLeft === 0;

  // `withdrawn` is the stream's LIFETIME total across every milestone, while
  // this bar is one milestone. Drawing it unclamped ran the underline far past
  // the bar — 40 USDC withdrawn against a 15 USDC milestone. Cap it at the
  // cells that exist, and label the figure as lifetime so the number is not
  // read as belonging to this milestone.
  const unlockedCells = bar.states.filter((c) => c === 'unlocked').length;
  const withdrawnCells = Math.min(Math.round(withdrawn / USDC / bar.perCell), unlockedCells);

  const describe = (state: CellState) =>
    state === 'unlocked'
      ? 'EARNED AND RELEASED'
      : state === 'locked'
        ? 'CERTIFIED BY THE AGENT, STILL ARRIVING'
        : state === 'valued'
          ? 'BOTH AGENTS AGREED THIS IS DONE — HELD BY THE PER-CERTIFICATION CAP'
          : 'NOT CERTIFIED';

  return (
    <section className="ps-hero">
      <p className="ps-hero-amount">
        <span suppressHydrationWarning>
          <Amount raw={earned} size="xl" />
        </span>
      </p>
      <p className="ps-label ps-hero-legend">EARNED ON THIS MILESTONE</p>

      <div className="ps-figures">
        <div>
          <span className="ps-caption">
            {stream.paused ? 'PAUSED' : ended ? 'MILESTONE OVER' : 'TIME LEFT'}
          </span>
          <span className="ps-num ps-countdown" suppressHydrationWarning>
            {stream.paused
              ? 'CLOCK STOPPED'
              : secondsLeft === null
                ? '—'
                : remaining(secondsLeft)}
          </span>
        </div>
        <div>
          <span className="ps-caption">CERTIFIED BY THE AGENT</span>
          <Amount raw={target} size="m" />
        </div>
        {valued > target && (
          <div>
            <span className="ps-caption">AGREED BY BOTH AGENTS</span>
            <Amount raw={valued} size="m" />
          </div>
        )}
        <div>
          <span className="ps-caption">MILESTONE BUDGET</span>
          <Amount raw={budget} size="m" />
        </div>
        <div>
          <span className="ps-caption">WITHDRAWN, ALL MILESTONES</span>
          <Amount raw={withdrawn} size="m" />
        </div>
      </div>

      <div
        className="ps-bar"
        role="img"
        aria-label={`${(earned / USDC).toFixed(6)} of ${(budget / USDC).toFixed(6)} USDC earned`}
        onMouseLeave={() => setHovered(null)}
      >
        {bar.states.map((state, i) => (
          <span
            key={i}
            className={`ps-cell ps-fill-${state}`}
            onMouseEnter={() => setHovered(i)}
            // Native tooltip as well as the readout below: it survives touch,
            // screen readers and anyone who does not look down.
            title={`${(bar.perCell * (i + 1)).toFixed(2)} USDC — ${describe(state)}`}
            suppressHydrationWarning
          />
        ))}
      </div>

      {/* A gap between agreed and certified is ALWAYS a cap, never a judgment —
          the agents already said yes. Saying so is the difference between "the
          agent declined" and "the employer's ceiling metered it", which look
          identical on the bar and mean opposite things. */}
      {valued > target && (
        <p className="ps-caption" style={{ marginTop: 'var(--ps-2)' }}>
          BOTH AGENTS AGREED <Amount raw={valued} size="s" suffix={false} /> IS DONE — THE{' '}
          <Amount raw={Number(stream.maxTranche)} size="s" suffix={false} /> PER-CERTIFICATION CAP
          METERED IT TO <Amount raw={target} size="s" />. THE REST LANDS ON THE NEXT MERGE, OR RAISE
          THE CAP AND MERGE AGAIN.
        </p>
      )}

      {withdrawnCells > 0 && (
        <>
          <div className="ps-withdrawn-rule" role="presentation">
            <span
              style={{ width: `calc(${withdrawnCells} * (var(--ps-cell-w) + var(--ps-cell-gap)))` }}
            />
          </div>
          <p className="ps-label ps-withdrawn-label">PAID OUT TO THE CONTRIBUTOR</p>
        </>
      )}

      {/* Hovering a cell explains that cell; otherwise the legend explains the
          three fills. Same line, so the layout never jumps. */}
      <p className="ps-bar-readout ps-caption" suppressHydrationWarning>
        {hovered !== null ? (
          <>
            CELL {hovered + 1} OF {bar.count} · {describe(bar.states[hovered])}
          </>
        ) : (
          <>
            <span className="ps-key ps-fill-unlocked" /> EARNED
            <span className="ps-key ps-fill-locked" /> CERTIFIED, ARRIVING
            <span className="ps-key ps-fill-unaccrued" /> NOT CERTIFIED
          </>
        )}
      </p>

      <p className="ps-caption">
        {bar.perCell === 1 ? '1 CELL = 1 USDC' : `1 CELL = ${bar.perCell.toFixed(2)} USDC`}
        {rate > 0 && !ended && ` · ACCRUING ${rate.toFixed(6)} USDC / HOUR`}
        {stream.paused && ' · PAUSED, NOTHING NEW ACCRUES'}
      </p>

      {/* Ended is not settled: the agent can still certify work already earned,
          and the contributor can still withdraw. Only closing ends it. */}
      {ended && !stream.paused && (
        <p className="ps-caption" suppressHydrationWarning>
          NOTHING FURTHER ACCRUES. ALREADY-EARNED WORK CAN STILL BE VERIFIED AND WITHDRAWN UNTIL THE
          EMPLOYER CLOSES THE MILESTONE.
        </p>
      )}
    </section>
  );
}
