'use client';

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
                <span className="ps-label">{k.name}</span>
                {k.soon && <span className="ps-kind-soon">SOON</span>}
              </span>
              <span className="ps-body ps-gatekind-what">{k.what}</span>
              <span className="ps-caption ps-gatekind-cta">
                {disabled ? k.soon : '[ CHOOSE THIS ]'}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/// The chosen kind, in one line at the top of the form, with a way back.
export function KindLine({ mode, onChange }: { mode: StreamMode; onChange: () => void }) {
  const k = KINDS.find((x) => x.mode === mode) ?? KINDS[0];
  return (
    <div className="ps-kindline">
      <span className="ps-label">{k.name}</span>
      <span className="ps-caption ps-kindline-short">{k.short}</span>
      <button type="button" className="ps-chip" onClick={onChange}>
        [ CHANGE ]
      </button>
    </div>
  );
}
