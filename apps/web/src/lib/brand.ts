// Single source of truth for the Sonara mark — a sonar "ping": a center dot
// with concentric rings radiating outward (and fading), echoing the audio
// ripples the canvas paints. Shared by the static favicon (icon.svg, authored
// by hand to these numbers), the generated apple-icon.tsx, the in-app <Mark/>
// component, and — re-encoded — the brand asset kit (brand/scripts/build.ts,
// which produces the static opengraph-image.png and PWA icons).

export const INK = "#1a1612";
export const PAPER = "#ede7d9";

// All geometry is on a 0 0 32 32 grid, centred at (16,16). Rings fade outward
// so the mark reads as a ripple dissipating rather than a static target.
export interface Ring {
  r: number;
  w: number;
  o: number;
}

export const RINGS: Ring[] = [
  { o: 1, r: 6, w: 2 },
  { o: 0.55, r: 9.6, w: 1.5 },
  { o: 0.28, r: 13.2, w: 1 },
];

export const DOT_R = 2.4;
export const CENTER = 16;
export const VIEWBOX = 32;
