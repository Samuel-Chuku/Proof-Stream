'use client';

import { useEffect, useState } from 'react';

/// What the agents actually decided, cycling one at a time.
///
/// This is the landing page's only moving part, and everything in it is real:
/// the repository, the pull request, the outcome and the amount all come from
/// the agents' own logs. Nothing is simulated. A landing page for a system whose
/// entire claim is "an agent decided this, on chain" cannot fake its own
/// evidence — a judge who spots one invented number stops believing the rest.
///
/// It also does the job the counters above cannot: a total tells you something
/// happened, a decision tells you what the agent THOUGHT. That is the product.
///
/// Motion is `steps()` and the elapsed counter ticks in whole seconds, because
/// the system's rule is that money moves discretely and nothing eases.
export type Decision = {
  at: string;
  event: string;
  repo?: string;
  pr: number;
  /** Present only when money actually moved. */
  amountUsdc?: string;
  percent?: number;
  reasoning?: string;
};

const ROTATE_MS = 6_000;

function ago(iso: string, now: number): string {
  const s = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s AGO`;
  if (s < 3600) return `${Math.floor(s / 60)}m AGO`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h AGO`;
  return `${Math.floor(s / 86_400)}d AGO`;
}

/// The one place green is allowed here: money the agent released. A refusal is
/// ink, not red — the palette has no red, and a refusal is the system working.
const LABEL: Record<string, string> = {
  unlocked: 'CERTIFIED',
  declined: 'REFUSED',
  escalated: 'ESCALATED',
  vetoed: 'VETOED BY THE VERIFIER',
  skipped: 'SKIPPED',
  unlock_failed: 'BLOCKED BY THE ON-CHAIN POLICY',
};

export function LiveDecisions({ decisions }: { decisions: Decision[] }) {
  const [i, setI] = useState(0);
  // Starts null so the server and the first client frame agree; a live clock
  // rendered on the server mismatches and React warns on hydration.
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    if (decisions.length < 2) return;
    const rotate = setInterval(() => setI((n) => (n + 1) % decisions.length), ROTATE_MS);
    return () => clearInterval(rotate);
  }, [decisions.length]);

  if (decisions.length === 0) return null;

  const d = decisions[i];
  const paid = d.event === 'unlocked';

  return (
    <section className="ps-live" aria-live="polite">
      <div className="ps-live-head">
        <span className="ps-live-dot" aria-hidden />
        <span className="ps-label">WHAT THE AGENTS DECIDED</span>
        <span className="ps-caption ps-live-when" suppressHydrationWarning>
          {now === null ? '' : ago(d.at, now)}
        </span>
      </div>

      {/* Keyed so the reveal replays on every rotation rather than only once. */}
      <div className="ps-live-body" key={`${d.at}-${d.pr}`}>
        <p className="ps-live-line">
          <span className="ps-live-repo">{d.repo ?? 'a repository'}</span>
          <span className="ps-live-sep">·</span>
          <span>PR #{d.pr}</span>
          <span className="ps-live-sep">·</span>
          <span className={paid ? 'ps-live-verdict ps-live-paid' : 'ps-live-verdict'}>
            {LABEL[d.event] ?? d.event.toUpperCase()}
            {d.percent !== undefined && ` ${d.percent}%`}
          </span>
          {paid && d.amountUsdc && <span className="ps-live-amount">{d.amountUsdc} USDC</span>}
        </p>
        {d.reasoning && <p className="ps-live-reasoning">“{d.reasoning}”</p>}
      </div>

      <div className="ps-live-pips" aria-hidden>
        {decisions.map((x, n) => (
          <span key={x.at} className={n === i ? 'ps-live-pip ps-live-pip-on' : 'ps-live-pip'} />
        ))}
      </div>
    </section>
  );
}
