'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

/// Keeps a server-rendered stream page current without a manual reload.
///
/// The page reads chain state and the agent's log on the server, so anything
/// the agent does while you are looking at it is invisible until you refresh.
/// During a demo that is the difference between "the agent certified it" and
/// a page that appears not to have noticed.
///
/// Three triggers, cheapest first:
///   - RETURNING TO THE TAB. The common case by far: you merge on GitHub, come
///     back, and the verdict should already be here. `visibilitychange` fires
///     before you have finished looking at the page.
///   - A POLL, while the tab is visible. A judgment takes ~30s end to end, so
///     15s means you never wait long. Hidden tabs do not poll at all — a page
///     left open overnight should not keep hitting the RPC.
///   - REGAINING FOCUS, for window managers that do not fire visibilitychange.
///
/// `router.refresh()` re-runs the server component and reconciles in place: no
/// flash, scroll position kept, and any panel you have open stays open.
export function LiveRefresh({ intervalMs = 15_000 }: { intervalMs?: number }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let last = Date.now();

    const refresh = () => {
      // Coalesce: focus and visibilitychange often fire together, and a poll
      // may land on top of them.
      if (Date.now() - last < 2_000) return;
      last = Date.now();
      setPending(true);
      router.refresh();
      // Not tied to the refresh completing — there is no callback for that.
      // This is a flicker of activity, not a progress bar.
      setTimeout(() => setPending(false), 900);
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };

    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', refresh);
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, intervalMs);

    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', refresh);
      clearInterval(id);
    };
  }, [router, intervalMs]);

  return (
    <span className={`ps-live-dot${pending ? ' is-checking' : ''}`} aria-hidden title="This page updates itself" />
  );
}
