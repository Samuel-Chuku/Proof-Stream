# ProofStream creative production

This reference lets an AI agent brief and quality-check ProofStream flyers, banners, social graphics, presentation covers, and short motion pieces. It is tool-neutral: the package does not include an image or video generator, hosted design editor, or stock-asset library. Use an available design or media tool only after the brief passes `proofstream-skill creative-check`.

## Agent workflow

1. Inspect the pinned source in `generated/compatibility.json` and the brand rules in [brand.md](brand.md). Never invent a capability, address, metric, or guarantee for a visual.
2. Write a brief from [creative-brief.example.json](../templates/media/creative-brief.example.json). Choose one objective, audience, format, CTA, and factual claim set.
3. Separate copy from visual generation. Ask an image model for composition and texture without long exact text, then typeset final copy in a design tool so spelling, contrast, and legal text remain controllable.
4. Use only the official mark when redistribution rights are confirmed. Otherwise use a text-only wordmark or no mark. Do not recreate a logo from memory.
5. Run `proofstream-skill creative-check <brief.json> --json`, review warnings, then export the requested files.
6. Add alt text, captions/transcript for motion, source links or repository paths for each factual claim, and a checksum when an output is final.

## Current visual language

- The mark is four climbing bars. The lower two are filled, the upper two outlined, and the stream bar is compressed. Use repository assets only when licensing is confirmed.
- The palette is warm paper `#EFEDE3`, surface `#F0F0F0`, sunk surface `#E3E1D7`, ink `#333333`, dark `#1A1917`, and rule black/ink. `#00FF00` means released USDC only. It is not a generic success, button, glow, or decoration.
- Use crisp borders, a 4px rhythm, square geometry, and hard down-right shadows. Keep generous alignment and a clear evidence-to-certification reading order.
- Use Departure Mono for addresses, hashes, transaction IDs, and state labels when the font is licensed. Use a readable proportional face for explanations. If the font is unavailable, choose a neutral readable fallback and note it in the brief.
- Avoid crypto-blue gradients, glassmorphism, floating particles, decorative motion, emoji UI copy, fake badges, and vague “AI magic” imagery.

## Copy and claims

Good factual language includes “Verified evidence”, “On-chain certification”, “Awaiting confirmation”, and “Independent review” when the referenced implementation actually supports that state. Say “agent judgment” or “model-assisted review”, not “trustless AI”. Say “eligible to withdraw” only after reading on-chain state; a transaction hash alone is not a payout.

Do not render “guaranteed payout”, “fraud-proof”, “risk-free”, “zero-risk”, “no-loss”, “fully autonomous”, or “trustless AI”. Claims in `copy.sourceClaims` must have a status and a source. Label experimental, roadmap, and not-currently-provided capabilities honestly. Never use a fake wallet address, transaction hash, live metric, partner logo, or testimonial as decoration.

## Format defaults

These are production defaults, not protocol requirements. A requester may override them in the brief.

| Medium | Default canvas | Production notes |
| --- | --- | --- |
| Flyer | A4/A5, 300 DPI, 3 mm bleed | Keep headline, CTA, and QR-safe area inside trim; export print PDF and proof PNG. |
| Banner | 1600x900 or 1200x628 px | Test at thumbnail size; keep the mark and CTA in a platform-safe zone. |
| Social | 1080x1080, 1080x1350, or 1080x1920 px | Make the first two seconds or first scan self-explanatory; provide alt text. |
| Presentation | 1920x1080 px | One idea per slide; use a dark title slide and warm neutral content surfaces. |
| Video/motion | 16:9, 1:1, or 9:16 | Specify FPS and duration; captions and transcript are required; motion should communicate lifecycle or evidence, not decorate. |

## Tool-neutral prompt templates

For image generation:

```text
Create a ProofStream [medium] for [audience] with the objective [objective].
Canvas: [width]x[height] [unit], [orientation]. Visual idea: [scene or composition].
Use warm paper #EFEDE3, surface #F0F0F0, ink #333333, dark #1A1917, and use #00FF00 only for a clearly labelled released-USDC state.
Use square geometry, crisp black rules, hard down-right shadows, and restrained technical editorial composition.
Mark use: [official/text-only/none]. Do not invent or redraw the mark.
Leave clean areas for typeset headline “[headline]” and CTA “[cta]”; do not attempt long exact copy in the generated image.
Avoid crypto-blue gradients, glassmorphism, particles, neon decoration, fake dashboards, fake addresses, fake metrics, badges, and illegible microtext.
```

For video or motion:

```text
Create a [duration] second ProofStream [aspect ratio] motion piece for [audience].
Storyboard: [scene 1] -> [scene 2] -> [scene 3]. Tie each transition to a real state such as evidence collected, awaiting verifier review, certified, or contributor withdrawal.
Use restrained cuts, crisp rules, square geometry, warm neutral surfaces, and green only for released USDC.
Reserve title-safe and caption-safe areas. Do not imply that an AI opinion is a guarantee or that a pending transaction is settled.
Deliver clean plates; final typography, captions, disclaimer, and logo are added in the editing tool.
```

## Accessibility, provenance, and export

Check contrast for every text/background pair in both light and dark contexts. Write useful alt text that describes the information, not merely “ProofStream graphic”. For video, include captions and a plain-text transcript. Preserve the source commit in `provenance.sourceCommit`, record asset rights, and keep source files alongside exports. Use names such as `proofstream-flyer-arc-testnet-v1.pdf` and never include secrets in filenames or metadata.

## Final QA checklist

- [ ] The medium, dimensions, objective, audience, headline, CTA, and output names are explicit.
- [ ] Every factual claim has a source and status tied to the pinned repository.
- [ ] Green is used only for released USDC, and official mark rights are confirmed before use.
- [ ] No prohibited guarantee, trustless-AI, or fake-proof language appears in rendered copy.
- [ ] Borders, shadows, type hierarchy, safe areas, and small-size legibility match the brand.
- [ ] Alt text, contrast, captions, transcript, and disclaimers are complete.
- [ ] `creative-check` passes and the final files have reproducible names and optional SHA-256 checksums.
