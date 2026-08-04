'use client';

// Shows the first N of a list and hides the rest behind a button.
//
// A stream with 120 decisions put the on-chain transactions and the spend
// figures several screens below the fold, so the two things a reader came to
// verify were the hardest to reach.
//
// The hidden rows are RENDERED, not omitted — they are already in the HTML, so
// revealing them costs no request and browser find-in-page still misses them
// only while collapsed, which is the same trade a <details> makes.
import { useState, type ReactNode } from 'react';

export function Reveal({
  initial,
  children,
  noun,
}: {
  /** How many to show before the button. */
  initial: number;
  children: ReactNode[];
  /** Plural noun for the button, e.g. "decisions". */
  noun: string;
}) {
  const [open, setOpen] = useState(false);
  const total = children.length;
  if (total <= initial) return <>{children}</>;

  return (
    <>
      {open ? children : children.slice(0, initial)}
      <button type="button" className="ps-reveal" onClick={() => setOpen(!open)}>
        {open ? '[ SHOW FEWER ] ▴' : `[ SHOW ALL ${total} ${noun.toUpperCase()} ] ▾`}
      </button>
    </>
  );
}
