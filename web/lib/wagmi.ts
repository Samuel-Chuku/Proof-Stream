import { createConfig, http } from 'wagmi';
import { injected, walletConnect } from 'wagmi/connectors';
import { PUBLIC_RPC_URL, arcTestnet } from './chain';

// No RainbowKit. The design system forbids component libraries — every default
// in them is rounded, blurred and animated, which is the exact opposite of this
// one — so the connect UI is built on these connectors directly.
//
// WalletConnect is only offered when a project id exists. Registering it
// without one throws at runtime, which would take the whole page down rather
// than simply offering one fewer wallet.
const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

// WalletConnect reaches for indexedDB the moment it is constructed, which
// throws during server prerender (`ReferenceError: indexedDB is not defined`).
// Next catches it and the build still passes, so this is easy to leave in —
// but it means the connector is being built somewhere it can never work.
// Construct it only in the browser.
const browser = typeof window !== 'undefined';

export const wagmiConfig = createConfig({
  chains: [arcTestnet],
  connectors: [
    injected(),
    ...(projectId && browser
      ? [
          walletConnect({
            projectId,
            showQrModal: true,
            metadata: {
              name: 'ProofStream',
              description: 'USDC payroll streams on Arc, unlocked by verified work.',
              url: 'https://proofstream.site',
              icons: [],
            },
          }),
        ]
      : []),
  ],
  transports: {
    // The PUBLIC endpoint, deliberately. ARC_RPC_URL carries a private node
    // token and is server-only; anything in this file reaches the browser.
    [arcTestnet.id]: http(PUBLIC_RPC_URL),
  },
  ssr: true,
});

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig;
  }
}
