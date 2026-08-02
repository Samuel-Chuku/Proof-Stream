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

type CellState = 'unlocked' | 'locked' | 'unaccrued';

/// THE SIGNATURE ELEMENT. One cell = one USDC, so a viewer counts green cells
/// and knows exactly how much the agent released — no axis, no legend, no
/// tooltip. Cells are always sorted, so the bar reads left to right as
/// released → earned-but-locked → not yet earned.
function cells(budget: number, unlocked: number, accrued: number) {
  const whole = Math.max(Math.ceil(budget / USDC), 1);
  const count = Math.min(whole, MAX_CELLS);
  // Above 60 USDC one cell stands for several, and the caption says so rather
  // than letting the count quietly stop meaning anything.
  const perCell = whole / count;

  const unlockedCells = Math.round(unlocked / USDC / perCell);
  const accruedCells = Math.round(accrued / USDC / perCell);

  return {
    perCell,
    count,
    states: Array.from({ length: count }, (_, i): CellState => {
      if (i < unlockedCells) return 'unlocked';
      if (i < accruedCells) return 'locked';
      return 'unaccrued';
    }),
  };
}

export function LockedFigure({ stream }: { stream: Stream }) {
  // Starts null and fills in after mount: a live clock rendered on the server
  // mismatches the first client frame and React warns on hydration.
  const [now, setNow] = useState<number | null>(null);

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

  const accrued = now === null ? 0 : accruedAt(stream, now);
  const unlocked = Number(stream.milestoneUnlocked);
  const withdrawn = Number(stream.withdrawn);
  const bar = cells(budget, unlocked, accrued);

  const rate = stream.duration > 0 ? (budget / USDC / stream.duration) * 3600 : 0;
  const withdrawnCells = Math.round(withdrawn / USDC / bar.perCell);

  return (
    <section className="ps-hero">
      <p className="ps-hero-amount" suppressHydrationWarning>
        <Amount raw={unlocked} size="xl" />
      </p>
      <p className="ps-label ps-hero-legend">UNLOCKED / ACCRUED / BUDGET</p>
      <p className="ps-caption" suppressHydrationWarning>
        {now === null ? '—' : (accrued / USDC).toFixed(6)} accrued · {(budget / USDC).toFixed(6)} budget
      </p>

      <div
        className="ps-bar"
        role="img"
        aria-label={`${(unlocked / USDC).toFixed(6)} of ${(budget / USDC).toFixed(6)} USDC unlocked`}
      >
        {bar.states.map((state, i) => (
          <span key={i} className={`ps-cell ps-fill-${state}`} suppressHydrationWarning />
        ))}
      </div>

      {/* Withdrawn is not a fifth cell state — it is a fact ABOUT unlocked
          money, so it is an underline beneath the frame, not a different fill. */}
      {withdrawnCells > 0 && (
        <div className="ps-withdrawn-rule" role="presentation">
          <span
            style={{
              width: `calc(${withdrawnCells} * (var(--ps-cell-w) + var(--ps-cell-gap)))`,
            }}
          />
        </div>
      )}
      {withdrawnCells > 0 && (
        <p className="ps-label ps-withdrawn-label">
          WITHDRAWN <Amount raw={withdrawn} size="s" />
        </p>
      )}

      <p className="ps-caption">
        {bar.perCell === 1
          ? '1 CELL = 1 USDC'
          : `1 CELL = ${bar.perCell.toFixed(2)} USDC`}
        {rate > 0 && ` · ACCRUING ${rate.toFixed(6)} USDC / HOUR`}
        {stream.paused && ' · PAUSED, NOTHING NEW ACCRUES'}
      </p>
    </section>
  );
}
