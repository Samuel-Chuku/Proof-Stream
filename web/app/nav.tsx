'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
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
const LINKS = [
  { href: '/', label: 'HOME' },
  { href: '/streams', label: 'STREAMS' },
  { href: '/new', label: 'NEW STREAM' },
  { href: '/docs', label: 'HOW IT WORKS' },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <nav className="ps-nav">
      <div className="ps-nav-inner">
        <Link href="/" className="ps-nav-mark">
          PROOFSTREAM
        </Link>

        <div className="ps-nav-links">
          {LINKS.map((link) => {
            const active =
              link.href === '/'
                ? pathname === '/'
                : link.href === '/streams'
                  ? pathname.startsWith('/stream')
                  : pathname === link.href;
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
    </nav>
  );
}
