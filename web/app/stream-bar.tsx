'use client';

import { useEffect, useState } from 'react';
import type { Stream } from '../lib/stream';

const USDC = 1_000_000;

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

function usd(raw: number): string {
  return (raw / USDC).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

  const accrued = now === null ? 0 : accruedAt(stream, now);
  const credited = Number(stream.contributorCredited);
  const withdrawn = Number(stream.withdrawn);
  const locked = Math.max(accrued - Number(stream.milestoneUnlocked), 0);
  const awaiting = Math.max(credited - withdrawn, 0);
  const vault = Math.max(Number(stream.unlocked) - credited, 0);

  const scale = Math.max(Number(stream.budget), 1);
  const w = (v: number) => `${Math.min((v / scale) * 100, 100)}%`;

  // The employer has not put the whole budget in, so nothing has started. This
  // is the one state a contributor must be able to see before doing any work.
  if (!stream.fullyFunded) {
    const short = Number(stream.budget) - Number(stream.funded);
    return (
      <section className="hero">
        <h2 className="hero-lead">
          Not started. <em>Waiting</em> on the employer&rsquo;s deposit.
        </h2>
        <p className="figure-label">Deposited so far</p>
        <p className="figure">
          {usd(Number(stream.funded))}
          <span className="figure-unit">of {usd(Number(stream.budget))} USDC</span>
        </p>
        <p className="hero-note">
          This milestone does not begin — and nothing accrues — until the full budget is in the
          contract. <b>{usd(short)} USDC</b> outstanding. Nobody should start work against it yet,
          and that is the point: an employer cannot take work they have not funded.
        </p>
      </section>
    );
  }

  return (
    <section className="hero">
      <h2 className="hero-lead">
        Earned every second. <em>Locked</em> until an agent signs for it.
      </h2>

      <p className="figure-label">Earned but locked, right now</p>
      <p className="figure" suppressHydrationWarning>
        {now === null ? '—' : usd(locked)}
        <span className="figure-unit">USDC</span>
      </p>

      <div className="bar" role="presentation">
        <span className="s-paid" style={{ width: w(withdrawn) }} />
        <span className="s-credited" style={{ width: w(awaiting) }} />
        <span className="s-vault" style={{ width: w(vault) }} />
        <span className="s-locked" style={{ width: w(locked) }} />
      </div>

      <div className="splits">
        <div>
          <i className="k-paid" />
          Paid out <b>{usd(withdrawn)}</b>
        </div>
        <div>
          <i className="k-credited" />
          Awaiting withdrawal <b>{usd(awaiting)}</b>
        </div>
        <div>
          <i className="k-vault" />
          Vested <b>{usd(vault)}</b>
        </div>
        <div>
          <i className="k-locked" />
          Locked <b suppressHydrationWarning>{now === null ? '—' : usd(locked)}</b>
        </div>
      </div>

      <p className="hero-note">
        The employer deposited the whole <b>{usd(Number(stream.budget))} USDC</b> budget for
        milestone {stream.milestoneIndex} before it began, so every figure here is backed by money
        already in the contract and a payout can never bounce.{' '}
        {stream.paused && <>The stream is <b>paused</b>, so nothing new is accruing. </>}
        Work releases it a tranche at a time; whatever is never released goes back to the employer
        when the milestone closes.
      </p>
    </section>
  );
}
