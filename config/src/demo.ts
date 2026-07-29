// Shared demo constants — the one place for config (constitution §5.6).
// Chain definition comes from viem/chains `arcTestnet`; do not hand-roll one.

/** ERC-20 USDC on Arc Testnet, 6 decimals. */
export const USDC_ADDRESS = '0x3600000000000000000000000000000000000000' as const;

/** ERC-20 EURC on Arc Testnet. */
export const EURC_ADDRESS = '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a' as const;

/** Arc Testnet block explorer. */
export const EXPLORER_URL = 'https://testnet.arcscan.app';

/** CCTP domain for Arc Testnet. */
export const CCTP_DOMAIN = 26;

// --- Gateway nanopayments (Phase 3) ---------------------------------------

/** CAIP-2 id for Arc Testnet — the network id x402 payment requirements use. */
export const ARC_CAIP2 = 'eip155:5042002' as const;

/** Circle GatewayWallet on Arc Testnet. Buyers deposit here; sellers are
 *  credited here. Source: developers.circle.com/gateway/references/contract-addresses */
export const GATEWAY_WALLET_ADDRESS = '0x0077777d7EBA4688BDeF3E311b846F25870A19B9' as const;

/** Gateway facilitator. The SDK defaults to MAINNET — always pass this. */
export const GATEWAY_FACILITATOR_URL = 'https://gateway-api-testnet.circle.com' as const;

/** What the attestor pays the verifier for one second opinion. */
export const VERIFICATION_FEE = '$0.005' as const;

/** Token ceiling for the verifier's reply. Its model reasons, and reasoning
 *  counts against this before a character is written (~1100 on a 1kB diff), so
 *  this is far above what the JSON itself needs. Lives here so the preflight
 *  can compare it against what the running seller reports and catch a stale
 *  process before a paid call discovers it. */
export const VERIFIER_MAX_TOKENS = 8000;
