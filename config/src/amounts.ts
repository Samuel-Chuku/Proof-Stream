// The single amount-formatting helper (trap T4). Every module that formats or
// parses an amount goes through here — no bare formatUnits/parseUnits calls
// elsewhere in the repo.
//
// Arc quirk: the native gas token IS USDC, but the RPC exposes it wei-style at
// 18 decimals, while the ERC-20 at 0x3600… uses 6. The same balance shows up
// in both scales.
import { formatUnits, parseUnits } from 'viem';

export const USDC_DECIMALS = 6;
export const NATIVE_DECIMALS = 18;

/** 6-dp ERC-20 USDC raw units → human string, e.g. 1234567n → "1.234567" */
export function formatUsdc(raw: bigint): string {
  return formatUnits(raw, USDC_DECIMALS);
}

/** Human string → 6-dp ERC-20 USDC raw units, e.g. "1.234567" → 1234567n */
export function parseUsdc(human: string): bigint {
  return parseUnits(human, USDC_DECIMALS);
}

/** 18-dp native gas raw units → human string */
export function formatNative(raw: bigint): string {
  return formatUnits(raw, NATIVE_DECIMALS);
}

/** Human string → 18-dp native gas raw units */
export function parseNative(human: string): bigint {
  return parseUnits(human, NATIVE_DECIMALS);
}
