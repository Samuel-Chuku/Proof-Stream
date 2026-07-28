import type { ReactNode } from 'react';

export const metadata = {
  title: 'ProofStream',
  description: 'USDC payroll streams on Arc, unlocked by verified work.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
