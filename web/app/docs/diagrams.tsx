import { KindMark } from '../new/stream-kind';

/// DIAGRAMS FOR THE DOCS, built from the system's own parts.
///
/// No diagram library and no images: a picture that does not share the page's
/// grid, fonts and fill states would read as pasted in. Each of these is HTML
/// on the 4px grid, using the classes the live interface uses, so a reader who
/// learns the four fill states here recognises them on a stream page.
///
/// NOTHING HERE IS GREEN EXCEPT THE UNLOCKED CELL, because green is money the
/// agent released and a diagram is not exempt.

/// A chain of boxed steps with arrows between. Wraps on narrow screens rather
/// than shrinking the text.
export function Flow({ steps }: { steps: { n?: string; label: string; note?: string }[] }) {
  return (
    <ol className="ps-flow" aria-label="Sequence">
      {steps.map((s, i) => (
        <li key={s.label} className="ps-flow-step">
          {i > 0 && (
            <span className="ps-flow-arrow" aria-hidden>
              →
            </span>
          )}
          <span className="ps-flow-box">
            {s.n && <span className="ps-flow-n">{s.n}</span>}
            <span className="ps-flow-label">{s.label}</span>
            {s.note && <span className="ps-flow-note">{s.note}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

/// The stream bar's four fill states, one cell each, labelled. The exact
/// classes the real bar uses, so this IS the legend for every stream page.
export function FillStates() {
  const states = [
    { cls: 'ps-fill-unaccrued', name: 'NOT YET', what: 'time has not passed' },
    { cls: 'ps-fill-locked', name: 'CERTIFIED, ARRIVING', what: 'the agent says it is owed; the clock has not released it' },
    { cls: 'ps-fill-unlocked', name: 'EARNED', what: 'released and withdrawable' },
    { cls: 'ps-fill-blocked', name: 'BLOCKED', what: 'a policy cap stopped an unlock' },
  ];
  return (
    <div className="ps-fills">
      {states.map((s) => (
        <div key={s.cls} className="ps-fills-row">
          <span className={`ps-cell ps-fills-cell ${s.cls}`} aria-hidden />
          <span className="ps-fills-name">{s.name}</span>
          <span className="ps-fills-what">{s.what}</span>
        </div>
      ))}
    </div>
  );
}

/// The two rulers that decide what a contributor can take, and the rule that
/// joins them. A worked example in cells, because the sentence is easy to nod
/// at and the picture is hard to misread.
export function TwoClocks() {
  // A 10-cell budget. The agent has certified 7; the clock has released 4.
  const cells = Array.from({ length: 10 }, (_, i) => i);
  return (
    <div className="ps-clocks">
      <div className="ps-clocks-row">
        <span className="ps-clocks-who">THE AGENT DECIDES</span>
        <span className="ps-bar ps-clocks-bar" aria-label="7 of 10 certified">
          {cells.map((i) => (
            <span key={i} className={`ps-cell ps-clocks-cell ${i < 7 ? 'ps-fill-locked' : 'ps-fill-unaccrued'}`} />
          ))}
        </span>
        <span className="ps-clocks-fig">7 of 10 certified</span>
      </div>
      <div className="ps-clocks-row">
        <span className="ps-clocks-who">THE CLOCK RELEASES</span>
        <span className="ps-bar ps-clocks-bar" aria-label="4 of 10 accrued">
          {cells.map((i) => (
            <span key={i} className={`ps-cell ps-clocks-cell ${i < 4 ? 'ps-fill-locked' : 'ps-fill-unaccrued'}`} />
          ))}
        </span>
        <span className="ps-clocks-fig">4 of 10 accrued</span>
      </div>
      <div className="ps-clocks-row ps-clocks-result">
        <span className="ps-clocks-who">SO THE CONTRIBUTOR MAY TAKE</span>
        <span className="ps-bar ps-clocks-bar" aria-label="4 of 10 earned">
          {cells.map((i) => (
            <span
              key={i}
              className={`ps-cell ps-clocks-cell ${i < 4 ? 'ps-fill-unlocked' : i < 7 ? 'ps-fill-locked' : 'ps-fill-unaccrued'}`}
            />
          ))}
        </span>
        <span className="ps-clocks-fig">
          <b>4</b>, the smaller of the two
        </span>
      </div>
    </div>
  );
}

/// The three kinds, with their marks, in a row.
export function Kinds() {
  const kinds = [
    { mode: 'named' as const, name: 'NAMED', who: 'One person, wallet named at creation.' },
    { mode: 'public' as const, name: 'PUBLIC', who: 'Nobody named. Whoever ships earns a share.' },
    { mode: 'claimable' as const, name: 'CLAIMABLE', who: 'One person, binds their own wallet by link. On chain; no product flow yet.' },
  ];
  return (
    <div className="ps-kinds">
      {kinds.map((k) => (
        <div key={k.mode} className={`ps-kinds-item${k.mode === 'claimable' ? ' ps-kinds-dim' : ''}`}>
          <KindMark kind={k.mode} size={32} />
          <span className="ps-kinds-name">{k.name}</span>
          <span className="ps-kinds-who">{k.who}</span>
        </div>
      ))}
    </div>
  );
}
