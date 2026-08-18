'use client';

// The verifier's fee, and the receipt for it, folded away.
//
// The explanation used to sit open on the page and cost four lines on every
// decision — on a stream with many decisions that is most of a screen spent
// saying the same thing repeatedly. It is the answer to a question, not a
// status, so it goes behind the `?` exactly as the capped-cell explanation does.
//
// WHY THERE IS NO TRANSACTION LINK. There is nothing to link to, and that is by
// design rather than an omission. Gateway collects signed authorizations
// offchain and settles NET POSITIONS for thousands of payments in a single
// onchain transaction, which is the only reason a half-cent payment is
// economic at all. So this payment has no transaction of its own: pointing at
// the batch would be pointing at thousands of unrelated payments and calling it
// this one. The receipt id is the honest artifact, so it is copyable instead.
import { useState } from 'react';
import { AddressChip } from './address-chip';

export function X402Receipt({ fee, transfer }: { fee: string; transfer?: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <span className="ps-x402">
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
      </span>

      {open && (
        <p className="ps-caption ps-x402-note">
          PAID BEFORE THE ANSWER WAS READ. NANOPAYMENTS SETTLE IN BATCHES, SO THIS HAS NO ARC
          TRANSACTION OF ITS OWN.
          {transfer && (
            <>
              {' '}
              RECEIPT <AddressChip address={transfer} />
            </>
          )}
        </p>
      )}
    </>
  );
}
