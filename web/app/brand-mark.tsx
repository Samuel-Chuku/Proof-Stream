// The ProofStream mark: four bars climbing, the lower two filled and the upper
// two still outlined. It is the stream bar compressed to 64px — money released
// underneath money not yet earned.
//
// WHY THIS IS INLINE AND NOT AN <img src="/proofstream-mark.svg">: the files in
// public/ hardcode #333333, and this app has a theme TOGGLE, not just a
// prefers-color-scheme default. A hardcoded ink mark disappears against the
// dark palette, and no media query can fix it because the user may have chosen
// dark on a light system. Drawing it here lets `currentColor` inherit from
// whatever is around it, in both themes, with no second file to keep in sync.
//
// DELIBERATELY MONOCHROME IN THE UI. The identity has a green variant and it is
// the right mark for a favicon or a deck slide — but inside the app, green
// means released USDC and nothing else. A green mark in the nav would be the
// one colour that carries meaning, used as decoration, on every screen.
export function BrandMark({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      shapeRendering="crispEdges"
      className={className}
      aria-hidden
      focusable="false"
    >
      <rect x="24" y="48" width="34" height="10" fill="currentColor" />
      <rect x="18" y="34" width="34" height="10" fill="currentColor" />
      <rect x="13" y="21" width="32" height="8" fill="none" stroke="currentColor" strokeWidth="2" />
      <rect x="7" y="7" width="32" height="8" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}
