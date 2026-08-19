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

/** Human string → 6-dp raw units, or 0n if it is not a number at all.
 *
 *  FOR UNTRUSTED INPUT ONLY. `parseUsdc` throws `InvalidDecimalNumberError` on
 *  anything that is not a decimal, which is correct for a form field the user
 *  can fix. It is wrong for a value that arrived over HTTP from the agent's
 *  event feed: that throw escapes an async Server Component and takes the whole
 *  page down, where the worst a bad row should ever do is render as zero.
 *
 *  Deliberately silent. A malformed amount in a log is not something a reader of
 *  the stream page can act on, and half a page is worth more than none.
 */
export function parseUsdcLoose(human: string | undefined | null): bigint {
  if (typeof human !== 'string' || human.trim() === '') return 0n;
  try {
    return parseUnits(human.trim(), USDC_DECIMALS);
  } catch {
    return 0n;
  }
}

/** 18-dp native gas raw units → human string */
export function formatNative(raw: bigint): string {
  return formatUnits(raw, NATIVE_DECIMALS);
}

/** Human string → 18-dp native gas raw units */
export function parseNative(human: string): bigint {
  return parseUnits(human, NATIVE_DECIMALS);
}
