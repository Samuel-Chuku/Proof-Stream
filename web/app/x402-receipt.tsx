'use client';

// The verifier's fee, and the receipt for it.
//
// The explanation used to sit open on the page and cost four lines on every
// decision — on a stream with many decisions that is most of a screen spent
// repeating itself. It is the answer to a question, not a status, so it hides
// behind the `?` exactly as the capped-cell explanation does.
//
// IT IS A POPOVER, NOT A BLOCK, and that is the whole point. An inline block
// pushed every paragraph below it down the page on open and back up on close,
// so reading one receipt moved the thing you were already reading. Absolute
// positioning means the page does not move at all — which is what "keep the
// page the same size" actually requires. It also closes on click-outside and on
// Escape, so getting rid of it never depends on finding the `?` again.
//
// WHY THERE IS NO TRANSACTION LINK. Nothing to link to, by design rather than
// omission. Gateway collects signed authorizations offchain and settles NET
// POSITIONS for thousands of payments in a single onchain transaction, which is
// the only reason a half-cent payment is economic at all. This payment has no
// transaction of its own: pointing at the batch would be pointing at thousands
// of unrelated payments and calling it this one. The receipt id is the honest
// artifact, so it is copyable instead.
import { useEffect, useRef, useState } from 'react';
import { AddressChip } from './address-chip';

export function X402Receipt({ fee, transfer }: { fee: string; transfer?: string }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    // `pointerdown`, not `click`: the panel should be gone before whatever was
    // clicked underneath begins to respond.
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  return (
    <span className="ps-x402" ref={box}>
      x402 · {fee} USDC
      <button
        type="button"
        className="ps-why-cap ps-x402-why"
        aria-expanded={open}
        aria-label="How was the verifier paid?"
        onClick={() => setOpen((v) => !v)}
      >
        ?
      </button>
      {open && (
        <span className="ps-x402-pop">
          PAID BEFORE THE ANSWER WAS READ. NANOPAYMENTS SETTLE IN BATCHES, SO THIS HAS NO ARC
          TRANSACTION OF ITS OWN.
          {transfer && (
            <span className="ps-x402-pop-receipt">
              RECEIPT <AddressChip address={transfer} />
            </span>
          )}
        </span>
      )}
    </span>
  );
}
