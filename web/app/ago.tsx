'use client';

import { useEffect, useState } from 'react';

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/// The absolute stamp: date first, because rows are newest-first and span days,
/// so a bare clock time reads as out of order.
export function stamp(iso: string): string {
  return `${iso.slice(8, 10)} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(11, 19)}`;
}

/// How long ago, in whole units, for anything inside a day. Older than that and
/// the date is the more useful fact, so the stamp stands.
export function ago(iso: string, now: number): string | null {
  const seconds = Math.floor((now - Date.parse(iso)) / 1000);
  if (!Number.isFinite(seconds) || seconds < 0 || seconds >= 86_400) return null;
  if (seconds < 60) return 'JUST NOW';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} MIN AGO`;
  const hours = Math.floor(minutes / 60);
  return `${hours} HOUR${hours === 1 ? '' : 'S'} AGO`;
}

/// WHEN SOMETHING HAPPENED, read the way people actually track a live run.
///
/// Under a day it counts back from now, because during a demo the useful
/// question is "how long ago", not "at what o'clock". Over a day the clock
/// time says nothing and the date does, so it reverts to the stamp.
///
/// The absolute UTC time is always on the element's title, so nothing is lost:
/// a relative time that cannot be resolved to a real instant is not evidence.
///
/// Rendered on the server as well as the client, then re-rendered every 30
/// seconds. `suppressHydrationWarning` covers the one case where the server
/// said "2 MIN AGO" and the client, a second later, says "3 MIN AGO".
export function Ago({ iso, className }: { iso: string; className?: string }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const absolute = stamp(iso);
  return (
    <time className={className} dateTime={iso} title={`${absolute} UTC`} suppressHydrationWarning>
      {ago(iso, now) ?? absolute}
    </time>
  );
}
