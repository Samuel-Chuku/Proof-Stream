import type { ReactNode } from 'react';
import { Silkscreen } from 'next/font/google';
import localFont from 'next/font/local';
import './globals.css';
import { Nav } from './nav';
import { Providers } from './providers';
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

export const metadata = {
  title: 'ProofStream',
  description: 'USDC payroll streams on Arc, unlocked by verified work.',
  // Pointed at the asset in public/ rather than copied to app/icon.svg, so the
  // tab icon and the file the deck uses can never drift apart.
  icons: { icon: '/proofstream-favicon.svg' },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        {/* Runs before first paint so a stored theme never flashes the other palette. */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <Providers>
          <Nav />
          {children}
        </Providers>
      </body>
    </html>
  );
}
