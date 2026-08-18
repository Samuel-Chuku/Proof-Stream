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

/// The certified share as a PERCENTAGE OF THE MILESTONE.
///
/// It used to render as `0.50` directly beside a confidence of `0.90`, two
/// numbers on the same 0-1 scale meaning entirely different things — one is how
/// much of the job is done, the other is how sure the agent is about that. A
/// reader could only tell them apart by knowing the system already.
const share = (n: number | undefined) => (n === undefined ? '—' : `${Math.round(n * 100)}%`);

/// Gateway transfer ids are long and nobody reads the middle.
const receipt = (id: string) => (id.length > 18 ? `${id.slice(0, 10)}…${id.slice(-6)}` : id);
const time = (iso: string) => `${iso.slice(11, 19)} UTC`;

/// The same bar the agent applies. Below it the attestor escalates instead of
/// unlocking, so this is the one line on the scale that means anything.
const THRESHOLD = Number(process.env.AGENT_CONFIDENCE_THRESHOLD ?? 0.7);

/// Confidence as ten cells, not a traffic light.
///
/// A red/amber/green scale was the obvious answer and it is the wrong one here:
/// the palette has exactly one colour, green, and it means RELEASED USDC. Spend
/// it on a confidence score and the green cells in the stream bar stop meaning
/// money — which is the one thing a judge is supposed to be able to count.
/// Amber and red do not exist in the system at all.
///
/// So confidence is told the way everything else in this app is told: by fill.
/// Solid cells are a score the agent would act on; dithered cells are one it
/// would not, and the heavier rule marks exactly where that line falls. It also
/// survives being printed, screenshotted in greyscale, or read by someone who
/// cannot separate red from green.
function Confidence({ value }: { value: number | undefined }) {
  if (value === undefined) return <span className="ps-num">—</span>;

  const filled = Math.round(value * 10);
  const acts = value >= THRESHOLD;
  // The rule sits on the right edge of the last cell below the bar.
  const markAt = Math.round(THRESHOLD * 10) - 1;

  return (
    <span className="ps-conf">
      <span className="ps-num">{value.toFixed(2)}</span>
      <span className="ps-conf-cells" aria-hidden>
        {Array.from({ length: 10 }, (_, i) => (
          <span
            key={i}
            className={[
              'ps-conf-cell',
              i < filled ? (acts ? 'ps-conf-on' : 'ps-conf-low') : '',
              i === markAt ? 'ps-conf-mark' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          />
        ))}
      </span>
      <span className="ps-caption ps-conf-note">
        {acts ? `AT OR ABOVE THE ${THRESHOLD.toFixed(2)} BAR` : `BELOW THE ${THRESHOLD.toFixed(2)} BAR`}
      </span>
    </span>
  );
}

export function VerdictBody({ event, blocked = false }: { event: AgentEvent; blocked?: boolean }) {
  const v = event.verdict!;

  return (
    <>
      {/* The policy-block moment, in the system's error treatment — an inverted
          panel, because the palette has no red. Worth stating outright: the
          agents AGREED here. What stopped it was the mandate the employer set
          on the contract, which is the one claim in this product that cannot be
          taken on trust and this is the row that proves it. */}
      {blocked && (
        <div className="ps-invert ps-revert">
          <p className="ps-label">THE CONTRACT REFUSED THIS RELEASE</p>
          <p className="ps-body">
            Both agents approved it. The transaction never reached the chain because it would have
            exceeded the on-chain limits this stream was deployed with — the agent physically cannot
            spend beyond its mandate, and no amount of agreement between the two of them changes
            that.
          </p>
          {event.errorReason && <p className="ps-caption">NODE REPORTED: {event.errorReason}</p>}
        </div>
      )}
      <dl className="ps-verdict-fields">
        <dt>Satisfies milestone</dt>
        <dd>{v.satisfies_milestone ? 'YES' : 'NO'}</dd>
        <dt>Confidence</dt>
        <dd>
          <Confidence value={v.confidence} />
        </dd>
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
          <AgentMark role="attestor" /> ATTESTOR
        </p>
        <p className="ps-verdict-reasoning">{v.reasoning}</p>
      </div>

      {event.verifier ? (
        <div className="ps-verdict-voice">
          <p className="ps-label ps-verdict-voice-head">
            <AgentMark role="verifier" /> VERIFIER
            {event.verificationFeeUsdc && (
              <span className="ps-x402">x402 · {event.verificationFeeUsdc} USDC</span>
            )}
          </p>
          <p className="ps-verdict-reasoning">{event.verifier.reasoning}</p>
          {event.verificationFeeUsdc && (
            <p className="ps-caption ps-x402-note">
              Paid before the answer was read.{' '}
              {event.gatewayTransfer && <>Receipt {receipt(event.gatewayTransfer)}. </>}
              Nanopayments settle in batches, so this is not a separate Arc transaction.
            </p>
          )}
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
            ? `BOTH AGREED — ${share(event.agreedFraction)} OF THE MILESTONE CERTIFIED, THE LOWER OF THE TWO`
            : 'DECIDED BY THE ATTESTOR ALONE'}
        </span>
        <span className="ps-label">{time(event.at)}</span>
      </div>
    </>
  );
}
