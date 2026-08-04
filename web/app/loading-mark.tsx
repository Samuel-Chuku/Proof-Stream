import { BrandMark } from './brand-mark';

/// The route-level loading state.
///
/// Next renders this the instant a navigation starts, so a click in the nav
/// changes the screen immediately instead of leaving the reader on the old page
/// until the server finishes. That wait is real — these pages sweep the
/// registry log and read a dozen contract values — so the honest fix is to show
/// something, not to pretend it is fast.
///
/// The animation is the mark's own bars filling bottom to top: the same gesture
/// as the stream bar, money accruing upward. A spinner would be a foreign
/// object in a system with no curves and no easing.
export function Loading({ label }: { label?: string }) {
  return (
    <main>
      <div className="ps-loading" role="status" aria-live="polite">
        <BrandMark size={48} />
        <p className="ps-display-l ps-loading-name">ProofStream</p>
        {/* Only where we know what is being fetched. The root boundary also
            covers /docs and /new, and naming the registry there would be a
            lie about what the page is waiting on. */}
        {label && <p className="ps-label ps-loading-label">{label}</p>}
      </div>
    </main>
  );
}
