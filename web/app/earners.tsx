import { AddressChip } from './address-chip';
import { Amount } from './amount';
import type { Earner } from '../lib/earners';

/// WHO EARNED FROM AN OPEN STREAM, and where each of them stands.
///
/// This is the section that makes an open stream's page a different page. The
/// stream bar above still shows one budget in four fill states, because that is
/// the truth about the money as a whole and the bar is the one showpiece. What
/// differs is that the budget is no longer one person's: it is a ledger of
/// shares, and this is that ledger.
///
/// Set like the transaction feed rather than as cards. Several earners is a
/// column of rows the eye scans down, not a stack of panels.
///
/// NOT GREEN. "Can take" is money the agent has released, so it would be
/// legitimate — but the bar already says how much was released, and a second
/// green figure per row would compete with it. The figures here are ink.
export function Earners({
  earners,
  names,
  explorer,
}: {
  earners: Earner[];
  /** earner id -> GitHub login, from the agent's ledger. Missing ids show as
   *  a truncated hash: the chain knows them, we simply have not seen the
   *  judgment that named them. */
  names: Map<string, string>;
  explorer: string;
}) {
  if (earners.length === 0) {
    return (
      <section className="ps-gate">
        <p className="ps-body" style={{ margin: 0 }}>
          Nobody has earned from this stream yet. Anyone whose merge the agent accepts appears here
          with their share, and chooses where to be paid.
        </p>
      </section>
    );
  }

  return (
    <>
    <div className="ps-earners" role="table" aria-label="Earners">
      <div className="ps-earners-head ps-label" role="row">
        <span role="columnheader">WHO</span>
        <span role="columnheader">SHARE</span>
        <span role="columnheader">CAN TAKE</span>
        <span role="columnheader">PAID</span>
        <span role="columnheader">TO</span>
      </div>
      {earners.map((e) => (
        <div className="ps-earners-row" role="row" key={e.earnerId}>
          <span role="cell" className="ps-earners-who">
            {names.get(e.earnerId.toLowerCase()) ?? (
              <span className="ps-earners-hash" title={e.earnerId}>
                {e.earnerId.slice(0, 8)}…{e.earnerId.slice(-4)}
              </span>
            )}
          </span>
          <span role="cell" className="ps-earners-share" data-col="SHARE">
            {(e.creditBps / 100).toFixed(e.creditBps % 100 === 0 ? 0 : 1)}%
          </span>
          <span role="cell" data-col="CAN TAKE">
            <Amount raw={BigInt(e.withdrawable)} size="m" />
          </span>
          <span role="cell" data-col="PAID">
            <Amount raw={BigInt(e.paid)} size="m" />
          </span>
          <span role="cell" className="ps-earners-to" data-col="TO">
            {e.payee ? (
              <AddressChip address={e.payee} href={`${explorer}/address/${e.payee}`} />
            ) : (
              // Not an error and not a warning. Choosing where to be paid is
              // the earner's step, taken when they like; until then the money
              // waits for them.
              <span className="ps-caption">not yet chosen</span>
            )}
          </span>
        </div>
      ))}
    </div>
    {/* The one sanctioned route to the page that asks for a wallet: from a
        stream page on our own domain, never from a link someone sent. */}
    <p className="ps-caption" style={{ marginTop: 'var(--ps-2)' }}>
      EARNED HERE? <a href="/earnings">SIGN IN ON THE EARNINGS PAGE TO CHOOSE WHERE YOU ARE PAID →</a>
    </p>
    </>
  );
}

/// The masthead chip that says this stream names nobody. Sits beside the
/// version chip and looks like it: hairline, dim, a footnote about what kind
/// of thing this is rather than a status.
export function OpenChip() {
  return (
    <span className="ps-version" title="Nobody is named. Anyone whose merge the agent accepts earns a share.">
      PUBLIC
    </span>
  );
}
