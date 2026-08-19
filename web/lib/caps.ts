// Stops for the two cap sliders on a stream page. Pure arithmetic, no React and
// no imports, so `pnpm test:caps` runs it without a browser or an .env.
//
// WHY THE SLIDERS ARE INDEXED OVER A LIST INSTEAD OF USING min/max/step.
//
// A range input's selectable values are `min + n*step`. When the span is not a
// whole number of steps the MAXIMUM IS NOT SELECTABLE: from a 7.50 cap in 1 USDC
// steps the stops run 8.50 … 29.50, and a 30 USDC budget cannot be chosen at
// all — the single value the panel exists to offer.
//
// Snapping inside the change handler looked like a fix and was worse. It moves
// React state without moving the DOM, so the element rounds itself back to the
// last valid stop while the label reads the full budget, the thumb still cannot
// reach the end, and THE VALUE THAT COMMITS IS NOT THE ONE THE EMPLOYER
// SELECTED. `raisePolicy` only ever widens, so a cap set a little too high can
// never be walked back.
//
// Indexing over an explicit list makes every slider position a real value, so
// the DOM and React cannot disagree and both endpoints are always reachable.
// This is the screen where a mis-set cap already sent 67 of 97 USDC back to an
// employer instead of the contributor who earned it.

/** Cap sliders move in whole USDC. Finer offers a decision nobody can ground. */
export const CAP_STEP = 1_000_000;

/// Every value the slider may take, ascending, from the current cap to the
/// budget with BOTH ENDPOINTS EXACT and whole USDC in between.
///
/// `from` is included even when it is not a whole number of USDC, because it is
/// the cap in force and the slider has to be able to represent "unchanged".
export function capStops(from: number, to: number): number[] {
  if (!(to > from)) return [from];

  const stops = [from];
  // The first whole USDC strictly above `from`, so a `from` that is already
  // whole is not repeated.
  for (let v = Math.ceil((from + 1) / CAP_STEP) * CAP_STEP; v < to; v += CAP_STEP) {
    stops.push(v);
  }
  stops.push(to);
  return stops;
}

/// The slider position representing `value`: the first stop at or above it.
///
/// Needed because raising the per-certification cap drags the daily one up with
/// it, and the value it is dragged to belongs to the OTHER slider's list.
/// Rounding up rather than down keeps the pair valid, since the daily cap may
/// never sit below the per-certification one.
export function stopIndexFor(stops: number[], value: number): number {
  const i = stops.findIndex((s) => s >= value);
  return i === -1 ? stops.length - 1 : i;
}

/// The stop a slider should actually commit for `value`. Always a member of
/// `stops`, which is the property that keeps the DOM and React in agreement.
export function stopFor(stops: number[], value: number): number {
  return stops[stopIndexFor(stops, value)];
}
