'use client';

// The decision behind one on-chain transaction, in a dialog.
//
// WHY A DIALOG AND NOT AN INLINE EXPANSION: the transactions list exists to be
// scanned and is deliberately short. Expanding a full two-agent breakdown
// inside it would push the rest of the page down by several screens — the exact
// problem the short list was added to fix. A dialog leaves the list where it is.
//
// Native <dialog> with showModal(), so focus trapping, Esc to close, inert
// background and the ::backdrop come from the browser rather than from a
// library and a scroll lock.
import { useEffect, useRef, type ReactNode } from 'react';

export function TxDecision({ pr, children }: { pr?: number; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);

  // Clicking the backdrop closes it. The dialog element itself fills only part
  // of the viewport, so a click whose target IS the dialog landed outside the
  // content box.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onClick = (e: MouseEvent) => {
      if (e.target === el) el.close();
    };
    el.addEventListener('click', onClick);
    return () => el.removeEventListener('click', onClick);
  }, []);

  return (
    <>
      <button
        type="button"
        className="ps-tx-why"
        onClick={() => ref.current?.showModal()}
        title="Why the agent released this"
      >
        WHY ▸
      </button>

      <dialog ref={ref} className="ps-dialog">
        <div className="ps-dialog-head">
          <span className="ps-label">THE DECISION BEHIND THIS TRANSACTION{pr ? ` · PR #${pr}` : ''}</span>
          <button type="button" className="ps-dialog-close" onClick={() => ref.current?.close()}>
            CLOSE ✕
          </button>
        </div>
        <div className="ps-dialog-body">{children}</div>
      </dialog>
    </>
  );
}
