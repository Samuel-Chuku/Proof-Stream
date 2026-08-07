/// A pixel glyph for "a person did this".
///
/// The counterpart to AgentMark, drawn the same way — inline SVG on the 4px
/// grid with `shape-rendering="crispEdges"` — because the design system bans
/// icon packages, whose rounded 1.5px strokes read as a different app bolted on.
///
/// Deliberately the same silhouette weight as the agent: a round head where the
/// agent has a square one, shoulders where the agent has an antenna. Side by
/// side in the transaction list the two headings should be distinguishable at a
/// glance without either looking more important than the other — the whole
/// point of that split is that both parties act on the same ledger.
export function HumanMark() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      aria-hidden
      focusable="false"
      className="ps-agent-mark"
    >
      {/* head — stepped corners read as round at 16px on a pixel grid, where a
          real circle would anti-alias into mud next to the pixel typeface */}
      <rect x="5" y="1" width="6" height="2" fill="currentColor" />
      <rect x="4" y="3" width="8" height="4" fill="currentColor" />
      <rect x="5" y="7" width="6" height="1" fill="currentColor" />

      {/* shoulders */}
      <rect x="6" y="9" width="4" height="2" fill="currentColor" />
      <rect x="3" y="11" width="10" height="4" fill="currentColor" />
      <rect x="2" y="13" width="12" height="2" fill="currentColor" />
    </svg>
  );
}
