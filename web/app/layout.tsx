import type { ReactNode } from 'react';
import { IBM_Plex_Mono, Instrument_Serif, Inter } from 'next/font/google';
import './globals.css';

// 2 + 1: a serif that carries the wordmark and the one big statement, a plain
// sans for prose, and a mono that keeps every figure on the same vertical rail.
const display = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-serif-display',
  display: 'swap',
});

const body = Inter({
  subsets: ['latin'],
  variable: '--font-sans-body',
  display: 'swap',
});

const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono-figure',
  display: 'swap',
});

export const metadata = {
  title: 'ProofStream',
  description: 'USDC payroll streams on Arc, unlocked by verified work.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
