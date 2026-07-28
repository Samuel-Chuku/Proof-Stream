/** @type {import('next').NextConfig} */
const nextConfig = {
  // @proofstream/config ships TypeScript source; let Next compile it.
  transpilePackages: ['@proofstream/config'],
};

export default nextConfig;
