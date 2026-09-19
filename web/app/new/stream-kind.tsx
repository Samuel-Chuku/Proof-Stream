'use client';

import { useEffect, useRef, useState } from 'react';
import type { StreamMode } from '../../lib/create-stream';

/// WHAT KIND OF STREAM, chosen before anything else is shown.
///
/// This is the decision every other field hangs off, so it is a gate: the
/// page renders nothing but this until one is chosen. Three kinds, named for
/// what the contract calls them, so the word on a stream's page matches the
/// word on the button that made it. Each panel carries its whole meaning,
/// because comparing three paragraphs side by side is the one moment that
/// wants them all visible at once.
///
/// Not green anywhere. Choosing a kind of stream moves no money.
export const KINDS: {
  mode: StreamMode | 'claimable';
  name: string;
  /** The one-line version, for the compact row at the top of the form. */
  short: string;
  what: string;
  soon?: string;
}[] = [
  {
    mode: 'named',
    name: 'NAMED STREAM',
    short: 'one person, paid to a wallet you name now',
    what:
      'You know who is doing this work. They are paid to a wallet you name now, and only ' +
      'that wallet can ever withdraw. If you set an allowlist, only those accounts’ merges count.',
  },
  {
    mode: 'public',
    name: 'PUBLIC STREAM',
    short: 'nobody is named, whoever ships earns a share',
    what:
      'Nobody is named. Anyone whose merge the agent accepts earns a share of the budget, ' +
      'credited to their GitHub identity, and chooses where to be paid, later, themselves. ' +
      'You set a ceiling on how much can leave per withdrawal and per day.',
  },
  {
    mode: 'claimable',
    name: 'CLAIMABLE STREAM',
    short: 'one person, who binds their own wallet by link',
    what:
      'You know who, but not their wallet. The stream is funded now and they bind their own ' +
      'address by opening a link.',
    // The contract supports this. No way of making the link has been accepted
    // yet, so it is shown and named rather than hidden, and not offered.
    soon: 'The contract supports this. The app cannot make the link yet.',
  },
];

/// The gate. Three panels, whole meaning on each, choose one to continue.
export function KindGate({ onChoose }: { onChoose: (m: StreamMode) => void }) {
  return (
    <section className="ps-gatekind" aria-labelledby="ps-gatekind-label">
      <div className="ps-section-rule">
        <span id="ps-gatekind-label" className="ps-label">
          WHAT KIND OF STREAM
        </span>
      </div>
      <p className="ps-body ps-gatekind-lede">
        Everything after this depends on the answer, so it comes first. You can change it before you
        create the stream, not after.
      </p>

      <div className="ps-gatekind-row">
        {KINDS.map((k) => {
          const disabled = Boolean(k.soon);
          return (
            <button
              key={k.mode}
              type="button"
              disabled={disabled}
              className="ps-gatekind-panel"
              onClick={() => !disabled && onChoose(k.mode as StreamMode)}
            >
              <span className="ps-gatekind-head">
                <KindMark kind={k.mode} />
                <span className="ps-label">{k.name}</span>
                {k.soon && <span className="ps-kind-soon">SOON</span>}
              </span>
              <span className="ps-gatekind-body">
                <span className="ps-body ps-gatekind-what">{k.what}</span>
                <span className="ps-caption ps-gatekind-cta">
                  {disabled ? k.soon : '[ CHOOSE THIS ]'}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/// The chosen kind, in one line at the top of the form, and a menu to change
/// it without leaving the form.
///
/// Returning to the gate was the only way back, which threw away the work
/// already in the form to answer a question the band was already showing. The
/// menu is the same three kinds in the same order with the same marks, so
/// nothing new has to be learned; the gate stays one click away for anyone who
/// wants the full paragraphs side by side.
export function KindLine({
  mode,
  onSelect,
  onCompare,
}: {
  mode: StreamMode;
  onSelect: (m: StreamMode) => void;
  /** Back to the gate, where all three carry their whole meaning. */
  onCompare: () => void;
}) {
  const k = KINDS.find((x) => x.mode === mode) ?? KINDS[0];
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);

  // Close on Escape and on a click anywhere else, like every menu a user has
  // ever met. `pointerdown` rather than `click` so the menu is gone before the
  // thing underneath reacts.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onDown = (e: PointerEvent) => {
      if (!menu.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [open]);

  return (
    <div className="ps-kindline">
      <KindMark kind={mode} size={16} />
      <span className="ps-label">{k.name}</span>
      <span className="ps-caption ps-kindline-short">{k.short}</span>

      <div className="ps-kindmenu" ref={menu}>
        <button
          type="button"
          className="ps-chip"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          [ CHANGE ] <span aria-hidden>{open ? '▴' : '▾'}</span>
        </button>

        {open && (
          <div className="ps-kindmenu-panel" role="menu" aria-label="Kind of stream">
            {KINDS.map((item) => {
              const current = item.mode === mode;
              const disabled = Boolean(item.soon);
              return (
                <button
                  key={item.mode}
                  type="button"
                  role="menuitemradio"
                  aria-checked={current}
                  disabled={disabled}
                  className={`ps-kindmenu-item${current ? ' ps-kindmenu-item-current' : ''}`}
                  onClick={() => {
                    if (!disabled && !current) onSelect(item.mode as StreamMode);
                    setOpen(false);
                  }}
                >
                  <span className="ps-kindmenu-mark" aria-hidden>
                    {current ? '\u25CF' : '\u25CB'}
                  </span>
                  <KindMark kind={item.mode} size={16} />
                  <span className="ps-label">{item.name}</span>
                  <span className="ps-caption ps-kindmenu-short">
                    {disabled ? item.soon : item.short}
                  </span>
                  {item.soon && <span className="ps-kind-soon">SOON</span>}
                </button>
              );
            })}

            <button
              type="button"
              className="ps-kindmenu-compare ps-caption"
              onClick={() => {
                setOpen(false);
                onCompare();
              }}
            >
              [ COMPARE ALL THREE ]
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/// ONE MARK PER KIND, drawn rather than imported.
///
/// No icon package: their rounded strokes read as a different app bolted on.
/// Each is a 6x6 grid of 4px cells in a 24px box, `crispEdges` so nothing
/// anti-aliases off the pixel grid, in `currentColor` so it inverts with the
/// panel it sits in. Three pictures a person reads before the label:
///
///   named      one figure, head and shoulders
///   public     three figures side by side
///   claimable  a key, because the stream is opened with something you hold
export function KindMark({ kind, size = 24 }: { kind: StreamMode | 'claimable'; size?: number }) {
  const cells: [number, number, number, number][] =
    kind === 'named'
      ? [
          [8, 0, 8, 8], // head
          [4, 12, 16, 12], // shoulders and body
        ]
      : kind === 'public'
        ? [
            [2, 4, 4, 4], // three heads, centred in the box
            [10, 4, 4, 4],
            [18, 4, 4, 4],
            [2, 12, 20, 12], // one body they share: a group, not a queue
          ]
        : [
            [4, 0, 12, 4], // ring, top
            [4, 4, 4, 4], // ring, left
            [12, 4, 4, 4], // ring, right
            [4, 8, 12, 4], // ring, bottom
            [8, 12, 4, 12], // shaft
            [12, 16, 4, 4], // tooth
          ];
  return (
    <svg
      className="ps-kind-mark"
      width={size}
      height={size}
      viewBox="0 0 24 24"
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
