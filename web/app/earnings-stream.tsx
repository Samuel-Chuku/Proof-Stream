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
  return (
    <section id={p.address}>
      <div className="ps-section-rule">
        <span className="ps-label">
          {spec.repo.toUpperCase()} · MILESTONE {p.milestoneIndex}
        </span>
      </div>

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
    </section>
  );
}
