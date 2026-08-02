/// A pixel glyph for "an agent did this".
///
/// Drawn as inline SVG on the 4px grid with `shape-rendering="crispEdges"`,
/// because the design system bans icon packages — their rounded 1.5px strokes
/// read as a different app bolted on. Two eyes and an antenna is enough to say
/// "machine" at 16px; anything more detail turns to mud at this size.
export function AgentMark({ role }: { role: 'attestor' | 'verifier' }) {
  // The verifier is hollow, the attestor solid. The attestor is the one that
  // signs and moves money; the verifier only ever offers an opinion.
  const solid = role === 'attestor';

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
      {/* antenna */}
      <rect x="7" y="0" width="2" height="3" fill="currentColor" />
      {/* head */}
      <rect
        x="2"
        y="3"
        width="12"
        height="10"
        fill={solid ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="2"
      />
      {/* eyes — knocked out of the solid head, drawn onto the hollow one */}
      <rect x="5" y="6" width="2" height="2" fill={solid ? 'var(--ps-surface)' : 'currentColor'} />
      <rect x="9" y="6" width="2" height="2" fill={solid ? 'var(--ps-surface)' : 'currentColor'} />
    </svg>
  );
}
