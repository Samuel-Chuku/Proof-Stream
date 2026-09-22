/// A paper plane on the pixel grid, in `currentColor`. Drawn rather than
/// imported, like every mark in this app: an icon set's rounded strokes would
/// read as another product bolted on. 16px box, 2px cells, crispEdges so
/// nothing anti-aliases off the grid.
export function TelegramMark({ size = 16 }: { size?: number }) {
  const cells: [number, number, number, number][] = [
    [2, 6, 12, 2], // the wide upper edge of the wing
    [4, 8, 8, 2], // narrowing toward the fold
    [6, 10, 6, 2], // the fold
    [8, 12, 2, 2], // the tail, pointing down-left
    [14, 4, 2, 4], // the nose, up-right
  ];
  return (
    <svg
      className="ps-telegram-mark"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      {cells.map(([x, y, w, h], i) => (
        <rect key={i} x={x} y={y} width={w} height={h} fill="currentColor" />
      ))}
    </svg>
  );
}
