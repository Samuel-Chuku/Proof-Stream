// THE SAME MONEY THE STREAM BAR SHOWS, ACROSS TIME.
//
// The bar is a snapshot and cannot say WHEN anything moved. This says when, in
// the same three states and the same three fills, so the two read as one idea.
// It is deliberately quiet: the bar is the showpiece and this sits inside a
// fold, under it, at a third of its weight.
//
// BUILT FROM DIVS, NOT SVG, and for one reason: the dither and the hatch are
// CSS backgrounds on a 4px grid defined once in tokens.css. Rebuilding them as
// SVG patterns would be a second definition of the app's most meaningful fill,
// free to drift from the first. `.ps-fill-*` is used verbatim here, so a change
// to the bar's language changes this in the same commit.
import type { Bucket } from '../lib/stream-history';

/// A column is one slice of time. Its three segments are shares of the BUDGET,
/// never of the column, so a stream that certified nothing and one that
/// certified everything are drawn on the same scale and can be compared.
function pct(part: bigint, whole: bigint): number {
  if (whole <= 0n) return 0;
  return Number((part * 10_000n) / whole) / 100;
}

/// A DATE IS NOT ALWAYS ENOUGH. A milestone can run for two hours, and an axis
/// reading "10 AUG" at both ends says nothing about a span it was meant to
/// describe. Under two days the clock is what moved, so show the clock.
function axisLabel(at: number, spanSeconds: number): string {
  const d = new Date(at * 1000);
  if (spanSeconds < 2 * 86_400) {
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
  }
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

const onDay = (at: number) =>
  new Date(at * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

export function StreamHistory({
  buckets,
  budget,
  /// The strip in a closed summary line. Same data, no axis, no legend: at 24px
  /// it is a shape, and a shape with labels is neither.
  compact = false,
}: {
  buckets: Bucket[];
  budget: bigint;
  compact?: boolean;
}) {
  if (buckets.length === 0 || budget <= 0n) return null;

  const first = buckets[0];
  const last = buckets[buckets.length - 1];
  const earned = pct(last.unlocked, budget);
  const span = Math.max(1, last.at - first.at);

  return (
    <figure className={`ps-history${compact ? ' ps-history-compact' : ''}`}>
      <div
        className="ps-history-plot"
        role="img"
        aria-label={`Earned over time. ${earned.toFixed(0)} percent of the budget is earned by ${onDay(last.at)}.`}
      >
        {buckets.map((b) => (
          // Top to bottom: never certified, certified and arriving, earned. The
          // green sits on the baseline so the chart reads as a rising floor,
          // which is what the money actually does.
          <div
            key={b.at}
            className="ps-history-col"
            title={`${onDay(b.at)} ${axisLabel(b.at, 0)} UTC · ${(Number(b.unlocked) / 1e6).toFixed(2)} earned · ${(Number(b.arriving) / 1e6).toFixed(2)} arriving`}
          >
            <span className="ps-history-seg ps-fill-unaccrued" style={{ height: `${pct(b.uncertified, budget)}%` }} />
            <span className="ps-history-seg ps-fill-locked" style={{ height: `${pct(b.arriving, budget)}%` }} />
            <span className="ps-history-seg ps-fill-unlocked" style={{ height: `${pct(b.unlocked, budget)}%` }} />
          </div>
        ))}
      </div>

      {!compact && (
        <figcaption className="ps-history-foot">
          <span className="ps-caption">{axisLabel(first.at, span)}</span>
          {/* The same three words the bar's legend uses. Two vocabularies for
              one set of fills would undo the point of sharing them. */}
          <span className="ps-caption ps-history-key">
            <span className="ps-key ps-fill-unlocked" /> EARNED
            <span className="ps-key ps-fill-locked" /> CERTIFIED, ARRIVING
            <span className="ps-key ps-fill-unaccrued" /> NOT CERTIFIED
          </span>
          <span className="ps-caption">{axisLabel(last.at, span)}</span>
        </figcaption>
      )}
    </figure>
  );
}
