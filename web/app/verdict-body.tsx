// The full breakdown of one decision: both agents' verbatim reasoning, what
// they agreed on, and the transaction it produced.
//
// Extracted so it can appear in two places without being written twice — inside
// the expandable card under AGENT DECISIONS, and inside the dialog opened from
// an on-chain transaction row. A second copy would drift, and the drift would
// show as two different accounts of the same decision.
import { EXPLORER_URL } from '@proofstream/config';
import type { AgentEvent } from '../lib/events';
import { AddressChip } from './address-chip';
import { AgentMark } from './agent-mark';

const pct = (n: number | undefined) => (n === undefined ? '—' : n.toFixed(2));
const time = (iso: string) => `${iso.slice(11, 19)} UTC`;

export function VerdictBody({ event }: { event: AgentEvent }) {
  const v = event.verdict!;

  return (
    <>
      <dl className="ps-verdict-fields">
        <dt>Satisfies milestone</dt>
        <dd>{v.satisfies_milestone ? 'YES' : 'NO'}</dd>
        <dt>Confidence</dt>
        <dd className="ps-num">{pct(v.confidence)}</dd>
        <dt>Judged by</dt>
        <dd>{event.model}</dd>
        {event.txHash && (
          <>
            <dt>Transaction</dt>
            <dd>
              <AddressChip address={event.txHash} href={`${EXPLORER_URL}/tx/${event.txHash}`} />
            </dd>
          </>
        )}
      </dl>

      <div className="ps-verdict-voice">
        <p className="ps-label ps-verdict-voice-head">
          <AgentMark role="attestor" /> ATTESTOR · {event.model}
        </p>
        <p className="ps-verdict-reasoning">{v.reasoning}</p>
      </div>

      {event.verifier ? (
        <div className="ps-verdict-voice">
          <p className="ps-label ps-verdict-voice-head">
            <AgentMark role="verifier" /> VERIFIER · {event.verifier.model} · PAID{' '}
            {event.verificationFeeUsdc} USDC
          </p>
          <p className="ps-verdict-reasoning">{event.verifier.reasoning}</p>
        </div>
      ) : (
        <div className="ps-verdict-voice">
          <p className="ps-label ps-verdict-voice-head">
            <AgentMark role="verifier" /> VERIFIER · NOT CONSULTED
          </p>
          <p className="ps-verdict-reasoning">
            The attestor refused on its own judgment, so no second opinion was bought and no fee was
            spent. Refusal is free.
          </p>
        </div>
      )}

      <div className="ps-verdict-foot">
        <span className="ps-label">
          {event.verifier
            ? `BOTH AGREED — PAID AT ${pct(event.agreedFraction)}, THE LOWER OF THE TWO`
            : 'DECIDED BY THE ATTESTOR ALONE'}
        </span>
        <span className="ps-label">{time(event.at)}</span>
      </div>
    </>
  );
}
