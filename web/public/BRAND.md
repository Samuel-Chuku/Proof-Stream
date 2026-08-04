# ProofStream identity

The mark is four bars climbing: the lower two filled, the upper two still
outlined. It is the stream bar compressed — money released underneath money not
yet earned. That is the product in one glyph, so do not redraw it as anything
else.

## Which file, where

| File | Size | Use |
| --- | --- | --- |
| `proofstream-mark.svg` | 64×64 | The mark alone, on paper. |
| `proofstream-mark-live.svg` | 64×64 | Released tranches in green, on paper. |
| `proofstream-mark-invert.svg` | 64×64 | The mark on the dark panel. |
| `proofstream-favicon.svg` | 64×64 | Browser tab. Solid fills only; carries its own dark-mode stylesheet. |
| `proofstream-lockup.svg` | 340×64 | Mark plus wordmark, horizontal, on paper. |
| `proofstream-lockup-live.svg` | 340×64 | Same, green bars. |
| `proofstream-lockup-invert.svg` | 340×64 | Same, on dark. Deck slides, video end card. |
| `proofstream-stacked.svg` | 260×108 | Mark over wordmark. Deck title slide. |
| `proofstream-wordmark.svg` | 260×28 | Text only, when the mark is already on screen. |

## In the app

The nav, the footer and the home hero draw the mark from
`web/app/brand-mark.tsx`, **not** from these files. The app has a theme toggle,
so a hardcoded `#333333` mark vanishes against the dark palette and no media
query can fix it — the user may have chosen dark on a light system. The
component inherits `currentColor` instead, so one drawing serves both themes.

These SVGs are for everything outside the app: the deck, the video, README
badges, the submission page.

## The green rule

Inside the product, green means released USDC and nothing else. That is why the
in-app mark is monochrome even though a green variant exists — a green mark on
every screen would spend the one colour that carries meaning on decoration, and
the green cells in the stream bar would stop being countable evidence.

Outside the product the mark is identity rather than information, so
`-live` and the favicon use green freely.
