'use client';

import type { StreamMode } from '../../lib/create-stream';

/// WHAT KIND OF STREAM, chosen before anything else.
///
/// This is the decision every other field hangs off, so it comes before the
/// numbered steps rather than inside one of them. Three kinds, named for what
/// the contract calls them, because a stream page shows the same word in its
/// masthead and a person should be able to connect the two.
///
/// A button chooses a kind AND explains it. The explanation appears beneath
/// the row for whichever kind is pressed, so the page never shows three
/// paragraphs at once and the reader is never asked to compare prose. Press,
/// read, decide.
///
/// Not green anywhere. Choosing a kind of stream moves no money.
export const KINDS: { mode: StreamMode | 'claimable'; name: string; what: string; soon?: string }[] = [
  {
    mode: 'named',
    name: 'NAMED STREAM',
    what:
      'You know who is doing this work. They are paid to a wallet you name now, and only ' +
      'that wallet can ever withdraw. If you set an allowlist, only those accounts’ merges count.',
  },
  {
    mode: 'public',
    name: 'PUBLIC STREAM',
    what:
      'Nobody is named. Anyone whose merge the agent accepts earns a share of the budget, ' +
      'credited to their GitHub identity, and chooses where to be paid, later, themselves. ' +
      'You set a ceiling on how much can leave per withdrawal and per day.',
  },
  {
    mode: 'claimable',
    name: 'CLAIMABLE STREAM',
    what:
      'You know who, but not their wallet. The stream is funded now and they bind their own ' +
      'address by opening a link.',
    // The contract supports this today. Nothing in the app can mint the link
    // yet, so it is shown and named rather than hidden, and not offered.
    soon: 'The contract supports this; the app cannot mint the link yet.',
  },
];

export function StreamKind({ mode, onChange }: { mode: StreamMode; onChange: (m: StreamMode) => void }) {
  const chosen = KINDS.find((k) => k.mode === mode) ?? KINDS[0];

  return (
    <section className="ps-kind" aria-labelledby="ps-kind-label">
      <span id="ps-kind-label" className="ps-label">
        WHAT KIND OF STREAM
      </span>

      <div className="ps-kind-row" role="radiogroup" aria-labelledby="ps-kind-label">
        {KINDS.map((k) => {
          const on = k.mode === mode;
          const disabled = Boolean(k.soon);
          return (
            <button
              key={k.mode}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={disabled}
              title={k.soon}
              className={`ps-button ps-kind-option${on ? ' ps-kind-on' : ''}`}
              onClick={() => !disabled && onChange(k.mode as StreamMode)}
            >
              <span className="ps-kind-mark" aria-hidden>
                {on ? '●' : '○'}
              </span>
              <span>{k.name}</span>
              {k.soon && <span className="ps-kind-soon">SOON</span>}
            </button>
          );
        })}
      </div>

      {/* The meaning of the pressed kind. One paragraph, swapped on press, so
          choosing is also reading. */}
      <p className="ps-kind-what ps-body" aria-live="polite">
        {chosen.what}
      </p>
    </section>
  );
}
