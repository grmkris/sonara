# Sonara — brand assets

Logo and identity assets for **Sonara** (sonara.fm) — a real-time, browser-based
music visualiser. Tagline: *“music, made visible.”*

This folder is a self-contained kit you can hand to anyone designing creatives
(posters, flyers, social, merch, slides). Everything you need is here: vector
masters, ready-to-use PNGs, the fonts, the colours, and usage rules.

> **TL;DR for poster/print work:** use the files in `svg/` (infinitely scalable,
> transparent). For dark backgrounds use the **`-paper`** versions; for light
> backgrounds use **`-ink`**. If you can only take a bitmap, grab the largest
> PNG in `png/` (`@4096`). Colours and fonts are below.

---

## The mark

The logo is a **sonar “ping”** — a centre dot with concentric rings radiating
and fading outward. It’s the literal idea of the product: sound made visible, a
ripple dissipating through space. Pair it with the **“sonara” wordmark**
(Fraunces, italic) for the full lockup.

---

## What’s in the box

```
brand/
├─ svg/        Vector masters — transparent, scalable, no font needed (text is outlined)
├─ png/        Transparent PNGs @ 512 / 1024 / 2048 / 4096 px  (+ contact-sheet.png)
├─ favicon/    Web favicon + app icons (.ico, 32/180/192/512, maskable)
├─ social/     Ready-made social cards (1200×630 OG, 1080×1080 square)
├─ print/      Vector PDFs of the primary lockups (for print shops)
├─ fonts/      The Fraunces typeface (+ OFL licence)
└─ scripts/    build.ts — regenerates everything from the source numbers
```

### `svg/` — the masters (use these whenever you can)
| File | What it is |
|---|---|
| `lockup-horizontal-{ink,paper}.svg` | **Primary logo** — mark + “sonara”, side by side |
| `lockup-stacked-{ink,paper}.svg` | Mark above “sonara” — for square/tall spaces |
| `mark-{ink,paper,black,white}.svg` | The sonar symbol alone — icon, avatar, watermark |
| `mark-tile.svg` | Mark on the rounded ink tile (the app-icon look) |
| `wordmark-{ink,paper,black,white}.svg` | Just the word “sonara” |
| `wordmark-domain-{…}.svg` | Just “sonara.fm” |

The wordmark text is **converted to outlines (paths)** — these SVGs render
correctly even if Fraunces isn’t installed.

### Colour variants — which to use
- **`-ink`** → dark mark, for **light / paper** backgrounds.
- **`-paper`** → off-white knockout, for **dark** backgrounds (Sonara’s native look — most posters).
- **`-black`** / **`-white`** → pure single colour, for 1-ink print, embossing, or anywhere the brand hex can’t be used.

---

## Colours

| Name | Hex | RGB | Role |
|---|---|---|---|
| **Paper** | `#ede7d9` | 237, 231, 217 | Light element / knockout (warm off-white) |
| **Ink** | `#1a1612` | 26, 22, 18 | Dark background / dark mark (near-black brown) |
| **Stone** | `#8c8578` | 140, 133, 120 | Secondary text, muted detail |
| Hairline | `#c9c0ae` | 201, 192, 174 | Fine borders / dividers |
| Indigo | `#1c2d52` | 28, 45, 82 | Accent / highlight (use sparingly) |
| Signal | `#a4343a` | 164, 52, 58 | Alert / emphasis (use sparingly) |

The brand is warm and editorial — **paper on ink** is the default pairing.
Avoid neon or pure cold white; reach for Paper instead of `#ffffff`.

---

## Type

| Role | Typeface | Notes |
|---|---|---|
| Display / wordmark | **Fraunces** (italic, ~weight 600, high optical size) | Editorial serif. Provided in `fonts/`. |
| UI / labels | **Public Sans** | Uppercase + letter-spacing for labels, captions, CTAs |
| Numbers / technical | **IBM Plex Mono** | Timecodes, counters, fine print |

All three are free/open-source (Fraunces & IBM Plex under OFL, Public Sans
public-domain-ish USWDS). `fonts/` ships:
- `Fraunces-Italic-Variable.ttf` / `Fraunces-Roman-Variable.ttf` — the full variable family.
- `Fraunces-Italic-600-Display.ttf` — the exact static cut used in the wordmark.
- `OFL.txt` — the licence.

Get Public Sans and IBM Plex Mono from Google Fonts if you need them.

---

## Usage rules

**Clear space.** Keep empty space around the logo at least equal to the height
of the “o” in the wordmark (or, for the mark alone, the diameter of its centre
dot) on every side. Don’t crowd it.

**Minimum size.** Mark stays legible down to ~16 px. Don’t use the full
horizontal lockup below ~120 px wide — switch to the stacked lockup or the mark
alone at small sizes.

**Do**
- Use the SVGs whenever possible; scale freely.
- Put the `-paper` logo on dark/photographic backgrounds, `-ink` on light.
- Give it room to breathe.

**Don’t**
- Recolour the mark outside the palette, add gradients, shadows, or outlines.
- Stretch, rotate, or squash it.
- Rebuild the wordmark in a different font — use the provided outlined files.
- Place the dark logo on a busy/dark background where it disappears (use knockout).

---

## Regenerating

Everything here is generated from the canonical mark geometry + the Fraunces
font by `scripts/build.ts` (Bun). It uses `@resvg/resvg-js` (SVG→PNG),
`opentype.js` (outline the wordmark), `png-to-ico`, and `cairosvg` (SVG→PDF).
Install those in a working dir and run `bun build.ts`. You normally won’t need
to — the output files are the deliverables.
