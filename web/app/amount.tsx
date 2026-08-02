const USDC = 1_000_000;

/// Money is never a plain string. It is three parts, and the split is what lets
/// a live-ticking figure read as a stable magnitude with noise underneath
/// rather than a wall of shifting digits.
///
///   40 . 000000  USDC
///   ^^   ^^^^^^  ^^^^
///   full size    label, dim
///        0.7x, dim
///
/// Every amount in the UI goes through this — including the tx feed. Never
/// render raw formatUnits output anywhere.
export function Amount({
  /** Raw 6-decimal USDC, as the contract stores it. */
  raw,
  size = 'm',
  suffix = true,
}: {
  raw: number | bigint;
  size?: 'xl' | 'm' | 's';
  suffix?: boolean;
}) {
  const value = Number(raw);
  const whole = Math.trunc(value / USDC);
  // Padded, not rounded: 6 dp always, so the column never changes width.
  const fraction = String(Math.abs(value % USDC)).padStart(6, '0');

  return (
    <span className={`ps-amount ps-amount-${size} ps-num`}>
      <span className="ps-amount-whole">{whole.toLocaleString('en-US')}</span>
      <span className="ps-amount-fraction">.{fraction}</span>
      {suffix && <span className="ps-amount-suffix">USDC</span>}
    </span>
  );
}
