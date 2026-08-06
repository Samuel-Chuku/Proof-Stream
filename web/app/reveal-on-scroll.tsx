'use client';

import { useEffect } from 'react';

/// Sections fade up as they enter the viewport, once.
///
/// Deliberately minimal. The design system bans easing and springs, so this is
/// a short `steps()` transition — the same motion language as the stream bar,
/// where money moves discretely rather than gliding.
///
/// Implemented with IntersectionObserver and a class, not a library and not a
/// scroll listener: a scroll handler runs on every frame for an effect that
/// fires once per element, and `framer-motion` is explicitly out.
///
/// Everything starts VISIBLE and is hidden only after this mounts. If the
/// script never runs — an old browser, a blocked bundle, JavaScript off — the
/// page reads normally instead of being permanently blank, which is the failure
/// mode of every scroll-reveal that starts at `opacity: 0` in CSS.
export function RevealOnScroll() {
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;

    const targets = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'));
    if (targets.length === 0) return;

    // Anything already on screen at load stays put: animating what the visitor
    // is looking at is motion for its own sake, and delays the first read.
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add('ps-revealed');
          observer.unobserve(entry.target);
        }
      },
      // A little before the edge, so a section is settled by the time it is
      // properly in view rather than finishing mid-read.
      { rootMargin: '0px 0px -10% 0px', threshold: 0.05 },
    );

    for (const el of targets) {
      const box = el.getBoundingClientRect();
      if (box.top < window.innerHeight) {
        el.classList.add('ps-revealed');
        continue;
      }
      el.classList.add('ps-reveal-armed');
      observer.observe(el);
    }

    return () => observer.disconnect();
  }, []);

  return null;
}
