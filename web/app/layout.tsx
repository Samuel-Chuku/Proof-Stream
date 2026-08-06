import { headers } from 'next/headers';
import type { ReactNode } from 'react';
import { Silkscreen } from 'next/font/google';
import localFont from 'next/font/local';
import './globals.css';
import { Nav } from './nav';
import { Providers } from './providers';
import { RevealOnScroll } from './reveal-on-scroll';
import { themeScript } from './theme-toggle';

// Two faces, no third.
//
// Silkscreen carries the wordmark and section headings, always in caps and
// always sparingly.
const display = Silkscreen({
  subsets: ['latin'],
  weight: '700',
  variable: '--font-display',
  display: 'swap',
});

// Departure Mono is everything else. It has to be self-hosted — it is not on
// Google Fonts — and it earns its place by being a true pixel MONOSPACE with
// tabular figures. That matters more here than it looks: addresses, hashes,
// confidence scores and a USDC amount ticking upward must not jitter as digits
// change. SIL OFL 1.1; the licence ships beside the file in public/fonts/.
const mono = localFont({
  src: '../public/fonts/DepartureMono-Regular.woff2',
  variable: '--font-mono',
  display: 'swap',
  weight: '400',
});

/// Without this, mobile browsers assume a ~980px desktop layout and zoom the
/// whole page out to fit — which is why the site looked untouched on a phone
/// despite the breakpoints below 720px already existing. They were never
/// reached, because the viewport never reported a phone's real width.
///
/// `maximumScale` is deliberately NOT set: capping zoom stops people enlarging
/// text they cannot read, and an address hash at 11px is exactly the kind of
/// thing someone needs to zoom into.
export const viewport = {
  width: 'device-width',
  initialScale: 1,
};

export const metadata = {
  title: 'ProofStream',
  description: 'USDC payroll streams on Arc, unlocked by verified work.',
  // Pointed at the asset in public/ rather than copied to app/icon.svg, so the
  // tab icon and the file the deck uses can never drift apart.
  icons: { icon: '/proofstream-favicon.svg' },
};

/// The apex serves the landing page by REWRITE, so the browser URL stays `/`
/// and `usePathname()` in the nav sees `/` — it never learns it is on the
/// landing page. The host is the only thing that actually differs, and only the
/// server can see it, so the surface is decided here and passed down.
export default async function RootLayout({ children }: { children: ReactNode }) {
  const host = ((await headers()).get('host') ?? '').toLowerCase().split(':')[0];
  const isLanding = host.endsWith('proofstream.site') && !host.startsWith('app.');

  return (
    <html lang="en" className={`${display.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        {/* Runs before first paint so a stored theme never flashes the other palette. */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <Providers>
          <Nav landing={isLanding} />
          {children}
          <RevealOnScroll />
        </Providers>
      </body>
    </html>
  );
}
