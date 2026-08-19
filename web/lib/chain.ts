// Client-safe chain configuration.
//
// THE RULE THIS FILE EXISTS TO ENFORCE: ARC_RPC_URL carries a private node
// token and is server-only — it must never reach the browser, so it is not
// read here and must never be exposed as NEXT_PUBLIC_. Client-side reads go
// through Arc's public RPC, and every transaction is sent by the user's own
// wallet provider, which brings its own transport anyway.
//
// Server components keep using web/lib/stream.ts, which does read ARC_RPC_URL.
import { arcTestnet } from 'viem/chains';

export const PUBLIC_RPC_URL = 'https://rpc.testnet.arc.network';

export { arcTestnet };

/** ERC-20 USDC on Arc, 6 decimals. Native gas is the same asset at 18. */
export const USDC = '0x3600000000000000000000000000000000000000' as const;

/** Deployed once for the whole system; every employer announces their stream here. */
export const REGISTRY_ADDRESS = (process.env.NEXT_PUBLIC_REGISTRY_ADDRESS ||
  '0x528B36beF91B338166F08aA41676e9f1f1BF019f') as `0x${string}`;

/** The attestor a new stream appoints. A stream naming anyone else is ignored. */
export const AGENT_ADDRESS = (process.env.NEXT_PUBLIC_AGENT_ADDRESS ||
  '0x2cd7cc0407218f905731f88c08eeb86a94dd634a') as `0x${string}`;

export const EXPLORER = 'https://testnet.arcscan.app';

/** Minimal ERC-20 surface — approve before funding, balance for display. */
export const ERC20_ABI = [
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'value', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
] as const;
