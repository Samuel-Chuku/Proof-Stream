/// THE TWO CHANNEL MARKS, as real icons rather than pixel glyphs.
///
/// Everything else in this app is drawn on the 4px grid, because a rounded
/// icon set reads as another product bolted on. These two are the exception on
/// purpose: they are not ProofStream's marks, they are other people's, and a
/// person scanning a strip recognises the plane and the envelope faster than
/// they read any word we could put there. Both in `currentColor` and both
/// monochrome, so they sit in the strip rather than shouting from it.

/// The Telegram plane.
export function TelegramIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M21.94 4.3a1.2 1.2 0 0 0-1.26-.2L2.9 11.2c-.95.4-.9 1.77.08 2.1l4.4 1.47 1.7 5.1c.3.9 1.47 1.1 2.06.36l2.3-2.85 4.4 3.24c.7.52 1.7.14 1.88-.72l2.6-13.4c.08-.4-.06-.8-.38-1.2Zm-12.5 10.3-.1 3.4-1.16-3.5 9.4-6.2-8.14 6.3Z" />
    </svg>
  );
}

/// An envelope, not a mail provider's logo: the alert goes to whatever address
/// somebody gives us, and a branded glyph would say otherwise.
export function EmailIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" focusable="false">
      <rect x="2.5" y="5" width="19" height="14" rx="1" />
      <path d="m3 6 9 6.5L21 6" />
    </svg>
  );
}
