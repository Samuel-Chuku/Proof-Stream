/** @type {import('next').NextConfig} */
const nextConfig = {
  // @proofstream/config ships TypeScript source; let Next compile it.
  transpilePackages: ['@proofstream/config'],

  // A verification build must not write into the directory a running dev
  // server is serving from: it swaps the chunks underneath the open page and
  // produces hydration mismatches and "Loading chunk failed" errors that look
  // like application bugs. `NEXT_DIST_DIR=.next-verify next build` keeps them
  // apart.
  //
  // CAVEAT: Next rewrites tsconfig.json and next-env.d.ts to point at whatever
  // distDir it just used, so a verify build dirties both. Restore them after:
  //   git restore web/tsconfig.json web/next-env.d.ts
  distDir: process.env.NEXT_DIST_DIR || '.next',

  webpack: (config) => {
    // `wagmi/connectors` has no subpath exports, so importing ANY connector
    // pulls the whole barrel — metaMask, walletConnect, coinbase, safe and the
    // rest — and each drags in optional peer dependencies for platforms this
    // app does not target. None of them are reachable at runtime in a browser
    // build; they exist so the same package can run under React Native or with
    // pretty-printed server logs.
    //
    // Stubbing them is the honest fix: installing a React Native storage shim
    // or a log formatter to satisfy an import we never execute would be worse
    // than saying "this branch does not exist here".
    config.resolve.alias = {
      ...config.resolve.alias,

      // @coinbase/cdp-sdk → Solana x402. Our @x402/core and @x402/evm are the
      // agent's Arc dependencies and are unrelated to this.
      '@x402/svm/exact/client': false,

      // MetaMask SDK's React Native storage adapter.
      '@react-native-async-storage/async-storage': false,

      // WalletConnect's logger optionally pretty-prints. It falls back cleanly.
      'pino-pretty': false,
    };

    // viem's chain index reaches `ox/tempo`, which builds a require path at
    // runtime for a chain we do not use. Webpack cannot statically analyse it
    // and warns. There is nothing to fix in our code and nothing to stub —
    // the module is real, only its inner import is dynamic.
    config.ignoreWarnings = [
      ...(config.ignoreWarnings ?? []),
      { module: /node_modules\/ox\/_esm\/tempo/ },
    ];

    return config;
  },
};

export default nextConfig;
