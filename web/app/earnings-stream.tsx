'use client';

import { EXPLORER_URL, parseRepoSpec } from '@proofstream/config';
import Link from 'next/link';
import { AddressChip } from './address-chip';
import { Amount } from './amount';
import { EarnerActions } from './earner-actions';
import type { Position } from '../lib/earnings';

/// Never rounded to a whole unit: an on-chain policy value a judge can read
/// off the contract. Same helper as the stream page.
function formatCeiling(raw: string): string {
  const usdc = Number(raw) / 1e6;
  return Number.isInteger(usdc) ? usdc.toFixed(0) : String(usdc);
}

/// One stream's terms, from its contract, above the ledger of what it owes
/// this person and the actions that turn that into money. The same block
/// whether the stream knows them by GitHub or by wallet; the only difference
/// is the PAID TO row and which function withdraws, and both come from the
/// Position rather than from the page.
///
/// Terms first, always: a fake page would have to fake chain state to look
/// like this.
export function EarningsStream({ position: p, login }: { position: Position; login: string | null }) {
  const spec = parseRepoSpec(p.repo);
  const owed = p.earnings.reduce((sum, e) => sum + BigInt(e.withdrawable), 0n);
  const paid = p.earnings.reduce((sum, e) => sum + BigInt(e.paid), 0n);

  return (
    // OPEN WHERE THERE IS MONEY, CLOSED WHERE THERE IS NOT. Somebody with ten
    // streams behind them is here for the one that owes them, and a page that
    // opens every stream in full makes them scroll past their own history to
    // find it. A settled stream still reads at a glance from its summary line.
    <details className="ps-stream-fold" id={p.address} open={owed > 0n}>
      <summary>
        <span className="ps-stream-fold-who">
          <span className="ps-label">{spec.repo}</span>
          <span className="ps-caption">
            MILESTONE {p.milestoneIndex} · {p.kind === 'named' ? 'NAMED' : 'PUBLIC'} ·{' '}
            {p.state.toUpperCase()}
          </span>
        </span>
        <span className="ps-stream-fold-figure">
          {owed > 0n ? (
            <>
              {/* GREEN, AND LAWFULLY SO. This is USDC the agent certified and
                  the clock released: the same money the stream bar fills a
                  cell for. One cell is the app's own word for it, and a row of
                  text saying "TO TAKE" was not enough to find money on a page
                  of settled streams. */}
              <span className="ps-fold-cell" aria-hidden />
              <Amount raw={owed} size="m" />
              <span className="ps-caption">TO TAKE</span>
            </>
          ) : paid > 0n ? (
            <span className="ps-caption">PAID OUT</span>
          ) : (
            <span className="ps-caption">NOTHING OWED</span>
          )}
        </span>
        <span className="ps-stream-fold-caret" aria-hidden>
          ▾
        </span>
      </summary>

      <p className="ps-milestone">{p.milestone}</p>

      <div className="ps-rails">
        <dl>
          <dt>Stream</dt>
          <dd>
            <AddressChip address={p.address} href={`${EXPLORER_URL}/address/${p.address}`} />{' '}
            <Link href={`/stream/${p.address}`} className="ps-caption">
              OPEN →
            </Link>
          </dd>
          <dt>Employer</dt>
          <dd>
            <AddressChip address={p.employer} href={`${EXPLORER_URL}/address/${p.employer}`} />
          </dd>
          <dt>Merge into</dt>
          <dd>
            <b>{spec.branch}</b> on {spec.repo}
          </dd>
          <dt>Budget</dt>
          <dd>
            {(Number(p.budget) / 1e6).toFixed(2)} USDC · {p.state.toUpperCase()}
          </dd>
          <dt>Knows you as</dt>
          <dd>
            {p.kind === 'named' ? (
              <>
                <b>the contributor</b>, fixed when the stream was created:{' '}
                <AddressChip address={p.contributor as string} />
              </>
            ) : (
              <>
                <b>{login ? `@${login}` : 'a GitHub account'}</b>, credited by the agent per accepted
                merge
              </>
            )}
          </dd>
          {p.kind === 'public' && (
            <>
              <dt>Payout ceiling</dt>
              <dd>
                {formatCeiling(p.claimCap)} USDC per withdrawal ·{' '}
                {(Number(p.dailyClaimCap) / 1e6).toFixed(0)} USDC per day, across all earners
              </dd>
            </>
          )}
        </dl>
      </div>

      <div className="ps-earners" role="table" aria-label="Your credit on this stream">
        <div className="ps-earners-head ps-label" role="row">
          <span role="columnheader">MILESTONE</span>
          <span role="columnheader">SHARE</span>
          <span role="columnheader">CAN TAKE</span>
          <span role="columnheader">PAID</span>
          <span role="columnheader">RELEASED</span>
        </div>
        {p.earnings.map((e) => (
          <div className="ps-earners-row" role="row" key={e.milestoneIndex}>
            <span role="cell" className="ps-earners-who">
              {p.kind === 'named' ? 'ALL' : e.milestoneIndex}
              {e.closed && <span className="ps-caption ps-earnings-note">· CLOSED</span>}
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
            <span role="cell" data-col="RELEASED">
              <Amount raw={BigInt(e.released)} size="m" />
            </span>
          </div>
        ))}
      </div>

      <EarnerActions position={p} login={login} />
    </details>
  );
}
