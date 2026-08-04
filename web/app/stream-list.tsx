'use client';

// The ledger of streams, filtered and truncated.
//
// Client-side because MINE needs the connected wallet, and because filtering a
// list this size on the server would mean a round trip per chip. The data still
// comes from the server — every stream is rendered into the HTML, and the chips
// only decide which of them are shown.
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useAccount } from 'wagmi';
import { isOpen, type StreamSummary } from '../lib/registry';
import { Amount } from './amount';
import { Reveal } from './reveal';

/// OPEN is every state where the arrangement is still running — accruing,
/// paused, or waiting on its deposit. ENDED ran its course without being
/// closed; SETTLED was closed and its unspent budget returned.
type Filter = 'all' | 'open' | 'ended' | 'settled' | 'mine';

const CHIPS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'ALL' },
  { key: 'open', label: 'OPEN' },
  { key: 'ended', label: 'ENDED' },
  { key: 'settled', label: 'SETTLED' },
  { key: 'mine', label: 'MINE' },
];

export function StreamList({
  streams,
  serving,
}: {
  streams: StreamSummary[];
  /** Lowercased addresses the agent is actually watching. */
  serving: string[];
}) {
  const { address } = useAccount();
  const [filter, setFilter] = useState<Filter>('all');

  // wagmi has no address on the server, so reading it during the first client
  // render would produce a different tree than the one that was sent.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const wallet = mounted ? address?.toLowerCase() : undefined;

  const watched = useMemo(() => new Set(serving), [serving]);

  const counts = useMemo(
    () => ({
      all: streams.length,
      open: streams.filter(isOpen).length,
      ended: streams.filter((s) => s.state === 'ended').length,
      settled: streams.filter((s) => s.state === 'settled').length,
      mine: wallet ? streams.filter((s) => s.employer.toLowerCase() === wallet).length : 0,
    }),
    [streams, wallet],
  );

  const shown = useMemo(() => {
    switch (filter) {
      case 'open':
        return streams.filter(isOpen);
      case 'ended':
        return streams.filter((s) => s.state === 'ended');
      case 'settled':
        return streams.filter((s) => s.state === 'settled');
      case 'mine':
        return streams.filter((s) => s.employer.toLowerCase() === wallet);
      default:
        return streams;
    }
  }, [streams, filter, wallet]);

  // A chip that would filter to nothing is not offered — an empty list after a
  // click reads as a broken page rather than an honest answer. This also drops
  // MINE when no wallet is connected, without a special case: its count is 0.
  const chips = CHIPS.filter((c) => c.key === 'all' || counts[c.key] > 0);

  return (
    <>
      {chips.length > 1 && (
        <div className="ps-filters" role="group" aria-label="Filter streams">
          {chips.map((c) => (
            <button
              key={c.key}
              type="button"
              className={`ps-filter${filter === c.key ? ' ps-filter-on' : ''}`}
              aria-pressed={filter === c.key}
              onClick={() => setFilter(c.key)}
            >
              {c.label} {counts[c.key]}
            </button>
          ))}
        </div>
      )}

      <div className="ps-feed ps-stream-list">
        <div className="ps-stream-row ps-stream-head">
          <span className="ps-caption">REPOSITORY</span>
          <span className="ps-caption">MILESTONE</span>
          <span className="ps-caption">STATE</span>
          <span className="ps-caption ps-stream-figures">RELEASED OF BUDGET</span>
          <span />
        </div>

        <Reveal initial={10} noun="streams">
          {shown.map((s) => (
            <Link key={s.address} href={`/stream/${s.address}`} className="ps-stream-row">
              <span className="ps-tx-action ps-stream-repo">
                {/* Only the EXCEPTION is marked, and only for a stream that
                    SHOULD be watched. An ended milestone is meant to stop being
                    certified, so warning about it reports the design as a bug. */}
                {isOpen(s) && !watched.has(s.address.toLowerCase()) && (
                  <span className="ps-stream-warn" title="The agent is not watching this stream">
                    ⚠
                  </span>
                )}
                {s.repo || '(no repo set)'}
              </span>
              <span className="ps-caption">MILESTONE {s.milestoneIndex}</span>
              <span className={`ps-status ps-status-${s.state.replace(' ', '-')}`}>
                {s.state.toUpperCase()}
              </span>
              <span className="ps-stream-figures">
                <Amount raw={Number(s.earned)} size="m" suffix={false} /> of{' '}
                <Amount raw={Number(s.budget)} size="m" />
              </span>
              <span className="ps-stream-go" aria-hidden>
                →
              </span>
            </Link>
          ))}
        </Reveal>
      </div>
    </>
  );
}
