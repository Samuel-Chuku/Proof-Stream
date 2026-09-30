'use client';

import { EXPLORER_URL, parseRepoSpec } from '@proofstream/config';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { AddressChip } from './address-chip';
import { Amount } from './amount';
import { EarnerActions } from './earner-actions';
import { StreamHistory } from './stream-history';
import type { Bucket } from '../lib/stream-history';
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

  // ON OPEN, ONCE, AND NEVER FOR A FOLD NOBODY TOUCHED. The history costs a
  // contract read and a pass over the agent's ledger. Somebody with ten streams
  // behind them opens one, and paying for ten is paying for nine nobody saw.
  const [history, setHistory] = useState<{ budget: bigint; buckets: Bucket[] } | null>(null);
  const [asked, setAsked] = useState(false);

  const load = useCallback(async () => {
    if (asked) return;
    setAsked(true);
    try {
      const res = await fetch(`/api/stream/history?address=${p.address}`, { cache: 'no-store' });
      if (!res.ok) return;
      const body = (await res.json()) as {
        budget: string;
        buckets: { at: number; unlocked: string; arriving: string; uncertified: string }[];
      };
      setHistory({
        budget: BigInt(body.budget),
        buckets: body.buckets.map((b) => ({
          at: b.at,
          unlocked: BigInt(b.unlocked),
          arriving: BigInt(b.arriving),
          uncertified: BigInt(b.uncertified),
        })),
      });
    } catch {
      // A chart that cannot be drawn is not an error worth showing. Every
      // figure on this page is already here without it.
    }
  }, [asked, p.address]);

  // A FOLD THAT RENDERS OPEN NEVER TOGGLES. `onToggle` fires on a CHANGE, so a
  // stream that owes money, which is the one that opens itself and the one
  // somebody actually came here for, would never have asked for its history.
  useEffect(() => {
    if (owed > 0n) void load();
  }, [owed, load]);

  return (
    // OPEN WHERE THERE IS MONEY, CLOSED WHERE THERE IS NOT. Somebody with ten
    // streams behind them is here for the one that owes them, and a page that
    // opens every stream in full makes them scroll past their own history to
    // find it. A settled stream still reads at a glance from its summary line.
    <details
      className="ps-stream-fold"
      id={p.address}
      open={owed > 0n}
      onToggle={(e) => e.currentTarget.open && void load()}
    >
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
            // Green fill, ink on top. Lawful: this is USDC the agent released
            // and the clock delivered, now landed in a wallet. Withdrawn money
            // is a fact about unlocked money, not a different kind, and a
            // finished stream should be findable at a glance the way an owed
            // one is.
            <span className="ps-fold-done">PAID OUT</span>
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

      {/* AFTER THE TERMS, NEVER BEFORE THEM. The terms are the thing a fake page
          would have to fake chain state to reproduce, so they stay first and a
          picture never pushes them down. This reads as "and here is how that
          played out", which is what leads into the ledger below it. */}
      {history && <StreamHistory buckets={history.buckets} budget={history.budget} />}

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
