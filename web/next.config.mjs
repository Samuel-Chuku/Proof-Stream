/** @type {import('next').NextConfig} */
const nextConfig = {
  // @proofstream/config ships TypeScript source; let Next compile it.
  transpilePackages: ['@proofstream/config'],

  webpack: (config) => {
    // `wagmi/connectors` has no subpath exports, so importing ANY connector
    // pulls the whole barrel — including `baseAccount`, which reaches
    // @coinbase/cdp-sdk and from there imports `@x402/svm/exact/client`, a
    // Solana package this project does not and should not have. (Our
    // @x402/core and @x402/evm are the agent's Arc dependencies, unrelated to
    // this.)
    //
    // We only ever construct `injected` and `walletConnect`, so that branch is
    // dead code at runtime. Stub the import rather than installing a Solana SDK
    // to satisfy a module we never execute.
    config.resolve.alias = {
      ...config.resolve.alias,
      '@x402/svm/exact/client': false,
    };
    return config;
  },
};

export default nextConfig;
