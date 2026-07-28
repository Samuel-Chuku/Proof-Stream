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
