'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { BrandMark } from './brand-mark';
import { Connect } from './connect';
import { ThemeToggle } from './theme-toggle';

/// Persistent navigation.
///
/// The design system says "no top nav bar", and that held while there was one
/// screen. There are now four, and hiding the stream list inside the home page
/// meant the only route to it was going home first. So this is a nav — but
/// built as a ruled masthead strip rather than a floating SaaS header: no
/// shadow, no sticky blur, no avatar menu, hairline underneath, and it scrolls
/// with the page like the top of a printed sheet.
// No HOME entry — the wordmark is the home link, which is the convention
// every user already knows.
const LINKS = [
  { href: '/streams', label: 'STREAMS' },
  { href: '/new', label: 'NEW STREAM' },
  { href: '/earnings', label: 'EARNINGS' },
  { href: '/docs', label: 'HOW IT WORKS' },
];

export function Nav({ landing = false }: { landing?: boolean }) {
  const pathname = usePathname();

  // THE PHONE GETS A MENU, THE DESKTOP GETS THE STRIP, from one set of links.
  //
  // Under 720px the strip wrapped onto four lines and took the top half of the
  // first screen before any content. The industry answer is a bar with the
  // wordmark and one MENU control, and a panel that drops below it holding
  // everything the strip held. The links and wallet controls are rendered ONCE
  // and only re-laid: on desktop the drawer is `display: contents`, so the DOM
  // and the CSS the desktop strip has always had are untouched.
  const [open, setOpen] = useState(false);

  // A menu that stays open across navigation is a menu covering the page the
  // person just asked for. Close on every route change, and on Escape.
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    // The page behind must not scroll while the panel is over it.
    document.body.classList.add('ps-menu-open');
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.classList.remove('ps-menu-open');
    };
  }, [open]);

  // The landing page is a different job from the app, so it gets a different
  // strip: the wordmark and one way in. No section links, because there are no
  // sections here to move between, and no CONNECT WALLET, because nothing on
  // this page needs a wallet — offering one asks a visitor to commit before
  // they have been told what they are committing to.
  if (landing) {
    return (
      <nav className="ps-nav">
        <div className="ps-nav-inner">
          <span className="ps-nav-mark">
            <BrandMark size={18} />
            PROOFSTREAM
          </span>

          <div className="ps-nav-actions">
            <a className="ps-button" href="/streams">
              [ GO TO APP ]
            </a>
            <ThemeToggle />
          </div>
        </div>
      </nav>
    );
  }

  return (
    <nav className={`ps-nav${open ? ' ps-nav-open' : ''}`}>
      <div className="ps-nav-inner">
        <Link href="/" className="ps-nav-mark">
          <BrandMark size={18} />
          PROOFSTREAM
        </Link>

        {/* Phone only. Text, not a hamburger glyph: the system draws no icons
            it does not need, and the word is clearer than three lines. */}
        <button
          type="button"
          className="ps-nav-menu"
          aria-expanded={open}
          aria-controls="ps-nav-drawer"
          onClick={() => setOpen((v) => !v)}
        >
          [ {open ? 'CLOSE' : 'MENU'} ]
        </button>

        <div id="ps-nav-drawer" className="ps-nav-drawer">
        <div className="ps-nav-links">
          {LINKS.map((link) => {
            const active =
              link.href === '/streams' ? pathname.startsWith('/stream') : pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`ps-nav-link ps-label${active ? ' ps-nav-link-active' : ''}`}
              >
                {link.label}
              </Link>
            );
          })}
        </div>

        {/* Connect sits in the nav so it is reachable from every page — a
            wallet button that only exists on one screen gets missed. */}
        <div className="ps-nav-actions">
          <Connect />
          <ThemeToggle />
        </div>
        </div>
      </div>

      {/* Tapping the page behind closes the menu, like every drawer a person
          has met. Phone only; it does not exist at desktop widths. */}
      {open && <div className="ps-nav-backdrop" onClick={() => setOpen(false)} aria-hidden />}
    </nav>
  );
}
