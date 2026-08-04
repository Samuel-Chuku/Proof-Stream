// Social links for the footer.
//
// TO ADD ONE: put the URL in `href` below. That is the whole change — an entry
// with no URL renders as a dimmed, non-interactive glyph rather than a link to
// nowhere, so the row can ship before the accounts exist without a single
// broken destination on a page judges will click through.
//
// Glyphs are drawn here in `currentColor` rather than loaded as brand assets,
// for the same reason the ProofStream mark is: this app has a theme toggle, and
// a hardcoded fill disappears against one of the two palettes.

type Social = { name: string; href: string | null; path: string };

const SOCIALS: Social[] = [
  {
    name: 'GitHub',
    href: 'https://github.com/Samuel-Chuku/Proof-Stream',
    path: 'M12 .5A11.5 11.5 0 0 0 .5 12a11.5 11.5 0 0 0 7.86 10.92c.58.1.79-.25.79-.56v-2.17c-3.2.7-3.88-1.37-3.88-1.37-.53-1.33-1.29-1.69-1.29-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.18-3.09-.12-.29-.51-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.79 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.24 2.76.12 3.05.74.8 1.18 1.83 1.18 3.09 0 4.42-2.7 5.4-5.26 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12 11.5 11.5 0 0 0 12 .5Z',
  },
  {
    name: 'X',
    href: null,
    path: 'M18.9 1.15h3.68l-8.04 9.19 9.46 12.51h-7.41l-5.8-7.59-6.64 7.59H.46l8.6-9.83L0 1.15h7.6l5.24 6.93ZM17.6 20.64h2.04L6.5 3.23H4.31Z',
  },
  {
    name: 'Farcaster',
    href: null,
    path: 'M4.24 1.5h15.52v21h-2.3v-9.62h-.02a5.46 5.46 0 0 0-10.88 0h-.02v9.62h-2.3ZM.94 4.48l.93 3.17h.79v11.7a.79.79 0 0 0-.79.79v.86h-.15a.79.79 0 0 0-.79.79v.86h8.82v-.86a.79.79 0 0 0-.79-.79h-.15v-.86a.79.79 0 0 0-.79-.79h-.86V4.48Zm15.29 14.87a.79.79 0 0 0-.79.79v.86h-.15a.79.79 0 0 0-.79.79v.86h8.82v-.86a.79.79 0 0 0-.79-.79h-.15v-.86a.79.79 0 0 0-.79-.79V7.65h.79l.93-3.17h-6.22v14.87Z',
  },
];

function Glyph({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden focusable="false">
      <path d={path} />
    </svg>
  );
}

export function Socials() {
  return (
    <div className="ps-socials">
      {SOCIALS.map((s) =>
        s.href ? (
          <a
            key={s.name}
            href={s.href}
            target="_blank"
            rel="noreferrer"
            className="ps-social"
            aria-label={s.name}
            title={s.name}
          >
            <Glyph path={s.path} />
          </a>
        ) : (
          <span
            key={s.name}
            className="ps-social ps-social-pending"
            aria-label={`${s.name} — not yet`}
            title={`${s.name} — not yet`}
          >
            <Glyph path={s.path} />
          </span>
        ),
      )}
    </div>
  );
}
