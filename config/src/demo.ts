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
 *  counts against this before a character is written, so this is far above what
 *  the JSON itself needs. Lives here so the preflight can compare it against
 *  what the running seller reports and catch a stale process before a paid call
 *  discovers it.
 *
 *  Raised 8000 -> 24000 on 2026-08-04 and it did NOT fix what it was raised
 *  for. `cohere/north-mini-code:free` spent 9511 reasoning tokens against the
 *  8000 ceiling, then 27476 against the 24000 one — it expands its reasoning to
 *  consume whatever budget it is given, so no ceiling is high enough and each
 *  raise only makes the failure slower and dearer.
 *
 *  **A ceiling is not the lever for a model that reasons unboundedly; the model
 *  choice is.** VERIFIER_MODEL was moved to a non-reasoning model, verified on
 *  the same real diff with `pnpm review:test` before deploying. Leave this
 *  headroom in place — it costs nothing against a model that does not reason,
 *  and it is what keeps a future reasoning model from truncating at 8000 —
 *  but do not reach for it again as a fix.
 *
 *  Why this failure is worth spending tokens to avoid: x402 settles the fee
 *  BEFORE the handler runs, so every truncated review is paid for in full and
 *  returns nothing. */
export const VERIFIER_MAX_TOKENS = 24000;

/** Hard ceiling on the tokens a model may spend THINKING before it answers.
 *
 *  `max_tokens` cannot express this: it bounds the whole completion, and a
 *  reasoning model expands to fill whatever it is given — 9511 against 8000,
 *  27476 against 24000, and on a real 3 kB diff `poolside/laguna-s-2.1` spent
 *  all 24000 reasoning and wrote nothing at all. Raising the ceiling only makes
 *  the failure slower and dearer.
 *
 *  OpenRouter's `reasoning.max_tokens` bounds the thinking alone, which leaves
 *  the rest of the budget for the answer. Generous enough to judge a diff
 *  properly, small enough that it cannot consume the reply.
 *
 *  This is also the latency fix: burning 24000 reasoning tokens takes minutes,
 *  and the agent looked slow for exactly as long as it was producing nothing. */
export const REASONING_MAX_TOKENS = 4000;

/** Token ceiling for the attestor's reply. Was 1200, which was safe ONLY while
 *  the attestor ran a non-reasoning model: a reasoning model spends this budget
 *  thinking before it writes anything and the JSON arrives truncated, which
 *  presents as "not valid JSON" rather than as a token problem (it cost three
 *  paid calls to learn that on the verifier side).
 *
 *  Now that LLM_BASE_URL and AGENT_MODEL make swapping providers the expected
 *  workflow, that trap was one env-var edit away from firing. A ceiling is not
 *  a reservation, so the headroom is free. */
export const AGENT_MAX_TOKENS = 8000;
