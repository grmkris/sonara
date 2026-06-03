/**
 * Sonara brand asset generator.
 *
 * Reproduces the existing Sonara identity — the "sonar ping" mark (geometry from
 * apps/web/src/lib/brand.ts) and the "sonara" wordmark (Fraunces italic 600,
 * outlined to paths so the SVGs carry no font dependency) — as a portable,
 * production-grade package: transparent vector masters, high-res transparent
 * PNGs, light/dark variants, favicon/app icons, and social cards.
 *
 * Run from a dir that has node_modules with @resvg/resvg-js, opentype.js,
 * png-to-ico installed:
 *   bun /home/kristjan/code/sonara/brand/scripts/build.ts
 */
import { Resvg } from "@resvg/resvg-js";
import opentype from "opentype.js";
import pngToIco from "png-to-ico";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

// ---- paths ----------------------------------------------------------------
const ROOT = "/home/kristjan/code/sonara/brand";
const FONT_DISPLAY = `${ROOT}/fonts/Fraunces-Italic-600-Display.ttf`;
const VENV_PY = "/tmp/sonara-brand-build/venv/bin/python";
const dir = (p: string) => {
  const full = `${ROOT}/${p}`;
  mkdirSync(full, { recursive: true });
  return full;
};

// ---- palette (mirrors apps/web/src/lib/brand.ts + globals.css) -------------
const INK = "#1a1612";
const PAPER = "#ede7d9";
const STONE = "#8c8578";

// color variants for the monochrome mark / wordmark
const VARIANTS: Record<string, string> = {
  ink: INK, // dark mark — for light / paper backgrounds
  paper: PAPER, // off-white knockout — for dark backgrounds (Sonara's native look)
  black: "#000000", // pure 1-color print
  white: "#ffffff", // pure knockout
};

// ---- the sonar mark (geometry: 32-grid, centred at 16) ---------------------
const RINGS = [
  { r: 6, w: 2, o: 1 },
  { r: 9.6, w: 1.5, o: 0.55 },
  { r: 13.2, w: 1, o: 0.28 },
];
const DOT_R = 2.4;
const C = 16;

/** Mark on a transparent ground, single `color`, opacity carries the fade. */
function markSVG(color: string): string {
  const rings = RINGS.map(
    (g) =>
      `<circle cx="${C}" cy="${C}" r="${g.r}" stroke-width="${g.w}" opacity="${g.o}"/>`,
  ).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
  <g fill="none" stroke="${color}">${rings}</g>
  <circle cx="${C}" cy="${C}" r="${DOT_R}" fill="${color}"/>
</svg>`;
}

/** Inner mark geometry as a <g>, so it can be placed inside lockups/tiles. */
function markGroup(color: string, transform = ""): string {
  const rings = RINGS.map(
    (g) =>
      `<circle cx="${C}" cy="${C}" r="${g.r}" stroke-width="${g.w}" opacity="${g.o}"/>`,
  ).join("");
  return `<g ${transform ? `transform="${transform}" ` : ""}fill="none" stroke="${color}"><g>${rings}</g><circle cx="${C}" cy="${C}" r="${DOT_R}" fill="${color}" stroke="none"/></g>`;
}

/** Rounded ink tile with a paper mark — the app-icon / favicon look. */
function tileSVG(bg = INK, fg = PAPER, rx = 7): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
  <rect width="32" height="32" rx="${rx}" fill="${bg}"/>
  ${markGroup(fg)}
</svg>`;
}

// ---- wordmark (Fraunces italic 600, outlined to paths) --------------------
const _fb = readFileSync(FONT_DISPLAY);
const font = opentype.parse(
  _fb.buffer.slice(_fb.byteOffset, _fb.byteOffset + _fb.byteLength),
);

// opentype's toPathData() omits Z close commands, which makes Resvg fill all
// contours as one open path → a single blob. Emit each contour closed instead.
const f2 = (n: number) => Math.round(n * 100) / 100;
function pathD(p: opentype.Path): string {
  let d = "";
  for (const c of p.commands) {
    if (c.type === "M") d += `${d ? "Z" : ""}M${f2(c.x)} ${f2(c.y)}`;
    else if (c.type === "L") d += `L${f2(c.x)} ${f2(c.y)}`;
    else if (c.type === "Q") d += `Q${f2(c.x1)} ${f2(c.y1)} ${f2(c.x)} ${f2(c.y)}`;
    else if (c.type === "C")
      d += `C${f2(c.x1)} ${f2(c.y1)} ${f2(c.x2)} ${f2(c.y2)} ${f2(c.x)} ${f2(c.y)}`;
    else if (c.type === "Z") d += "Z";
  }
  return d ? `${d}Z` : d;
}
const FS = 200; // unit em for path extraction

type WM = { d: string; w: number; h: number; pad: number; bh: number };
function wordmarkPath(text: string): WM {
  const path = font.getPath(text, 0, 0, FS);
  const bb = path.getBoundingBox();
  const pad = FS * 0.09;
  const w = bb.x2 - bb.x1 + 2 * pad;
  const h = bb.y2 - bb.y1 + 2 * pad;
  // re-emit translated so the glyph bbox sits at (pad,pad)
  const moved = font.getPath(text, pad - bb.x1, pad - bb.y1, FS);
  return { d: pathD(moved), w, h, pad, bh: bb.y2 - bb.y1 };
}

function wordmarkSVG(text: string, color: string): string {
  const { d, w, h } = wordmarkPath(text);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${r2(w)} ${r2(h)}" width="${r2(w)}" height="${r2(h)}"><path d="${d}" fill="${color}"/></svg>`;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

// ---- lockups (mark + wordmark) --------------------------------------------
// Scale the mark so its diameter reads as a strong sibling to the wordmark
// x-height, with brand-proportional spacing.
function lockupHorizontal(color: string): string {
  const wm = wordmarkPath("sonara");
  const D = wm.bh * 2.0; // mark diameter
  const gap = wm.bh * 0.62;
  const s = D / 32; // scale 32-grid mark to D
  const H = D;
  const W = D + gap + wm.w;
  const markY = 0;
  // vertically centre the wordmark glyph box (which is wm.h tall) within H
  const wmY = (H - wm.h) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${r2(W)} ${r2(H)}" width="${r2(W)}" height="${r2(H)}">
  ${markGroup(color, `translate(0 ${r2(markY)}) scale(${r2(s)})`)}
  <path transform="translate(${r2(D + gap)} ${r2(wmY)})" d="${wm.d}" fill="${color}"/>
</svg>`;
}

function lockupStacked(color: string): string {
  const wm = wordmarkPath("sonara");
  const D = wm.bh * 2.6;
  const gap = wm.bh * 0.55;
  const s = D / 32;
  const W = Math.max(D, wm.w);
  const H = D + gap + wm.h;
  const markX = (W - D) / 2;
  const wmX = (W - wm.w) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${r2(W)} ${r2(H)}" width="${r2(W)}" height="${r2(H)}">
  ${markGroup(color, `translate(${r2(markX)} 0) scale(${r2(s)})`)}
  <path transform="translate(${r2(wmX)} ${r2(D + gap)})" d="${wm.d}" fill="${color}"/>
</svg>`;
}

// ---- raster helpers --------------------------------------------------------
function rasterize(svg: string, widthPx: number): Buffer {
  const r = new Resvg(svg, { fitTo: { mode: "width", value: widthPx } });
  return Buffer.from(r.render().asPng());
}
function rasterizeH(svg: string, heightPx: number): Buffer {
  const r = new Resvg(svg, { fitTo: { mode: "height", value: heightPx } });
  return Buffer.from(r.render().asPng());
}

// ===========================================================================
// 1. SVG masters
// ===========================================================================
const svgDir = dir("svg");
for (const [name, color] of Object.entries(VARIANTS)) {
  writeFileSync(`${svgDir}/mark-${name}.svg`, markSVG(color));
  writeFileSync(`${svgDir}/wordmark-${name}.svg`, wordmarkSVG("sonara", color));
  writeFileSync(
    `${svgDir}/wordmark-domain-${name}.svg`,
    wordmarkSVG("sonara.fm", color),
  );
}
writeFileSync(`${svgDir}/mark-tile.svg`, tileSVG());
for (const name of ["ink", "paper"]) {
  writeFileSync(`${svgDir}/lockup-horizontal-${name}.svg`, lockupHorizontal(VARIANTS[name]));
  writeFileSync(`${svgDir}/lockup-stacked-${name}.svg`, lockupStacked(VARIANTS[name]));
}
console.log("✓ SVG masters written");

// ===========================================================================
// 2. PNG exports (transparent) @ 512 / 1024 / 2048 / 4096
// ===========================================================================
const PNG_SIZES = [512, 1024, 2048, 4096];
const pngTargets: Array<{ sub: string; file: string; svg: string }> = [];
for (const name of Object.keys(VARIANTS)) {
  pngTargets.push({ sub: "mark", file: `mark-${name}`, svg: markSVG(VARIANTS[name]) });
}
for (const name of Object.keys(VARIANTS)) {
  pngTargets.push({ sub: "wordmark", file: `wordmark-${name}`, svg: wordmarkSVG("sonara", VARIANTS[name]) });
}
for (const name of ["ink", "paper"]) {
  pngTargets.push({ sub: "lockup", file: `lockup-horizontal-${name}`, svg: lockupHorizontal(VARIANTS[name]) });
  pngTargets.push({ sub: "lockup", file: `lockup-stacked-${name}`, svg: lockupStacked(VARIANTS[name]) });
}
for (const t of pngTargets) {
  const d = dir(`png/${t.sub}`);
  for (const sz of PNG_SIZES) {
    writeFileSync(`${d}/${t.file}@${sz}.png`, rasterize(t.svg, sz));
  }
}
console.log("✓ PNG exports written");

// ===========================================================================
// 3. Favicon + app icons
// ===========================================================================
const favDir = dir("favicon");
const tile = tileSVG();
// app icons (ink tile + paper mark)
writeFileSync(`${favDir}/icon-32.png`, rasterize(tile, 32));
writeFileSync(`${favDir}/icon-180.png`, rasterize(tile, 180)); // apple-touch
writeFileSync(`${favDir}/icon-192.png`, rasterize(tile, 192));
writeFileSync(`${favDir}/icon-512.png`, rasterize(tile, 512));
// maskable: full-bleed ink square, mark at ~62% safe zone (no rounding)
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
  <rect width="100" height="100" fill="${INK}"/>
  ${markGroup(PAPER, "translate(19 19) scale(1.9375)")}
</svg>`;
writeFileSync(`${favDir}/maskable-512.png`, rasterize(maskable, 512));
// favicon.ico — multi-res 16/32/48 from the ink tile
const icoBufs = [16, 32, 48].map((s) => rasterize(tile, s));
writeFileSync(`${favDir}/favicon.ico`, await pngToIco(icoBufs));
console.log("✓ favicon + app icons written");

// ===========================================================================
// 4. Social cards
// ===========================================================================
const socialDir = dir("social");

// reusable: ripple motif as a <g> of stroked rings (paper, alpha fade)
function rippleMotif(scale: number, cx: number, cy: number, alpha = 1): string {
  // mirror the OG card: outer→inner diameters 146/104/64 + 26 dot, widths 4/6/9
  const ring = (d: number, w: number, o: number) =>
    `<circle cx="${cx}" cy="${cy}" r="${(d / 2) * scale}" fill="none" stroke="${PAPER}" stroke-width="${w * scale}" opacity="${o * alpha}"/>`;
  return `${ring(146, 4, 0.28)}${ring(104, 6, 0.55)}${ring(64, 9, 1)}<circle cx="${cx}" cy="${cy}" r="${13 * scale}" fill="${PAPER}" opacity="${alpha}"/>`;
}

function wordmarkInline(text: string, color: string, x: number, baseline: number, fontSize: number): string {
  const p = font.getPath(text, x, baseline, fontSize);
  return `<path d="${pathD(p)}" fill="${color}"/>`;
}

// 1200×630 OG card
const og = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
  <rect width="1200" height="630" fill="${INK}"/>
  <g>${rippleMotif(4.4, 1200, 630, 0.5)}</g>
  <g transform="translate(72 96)">
    ${markGroup(PAPER, "scale(2.8)")}
    ${wordmarkInline("sonara", PAPER, 120, 70, 96)}
  </g>
  ${wordmarkInline("music, made visible.", PAPER, 72, 430, 110)}
  <g font-family="monospace">
    <text x="72" y="540" fill="${STONE}" font-size="26" letter-spacing="5" style="text-transform:uppercase">SONARA.FM · LIVE MUSIC VISUALS</text>
  </g>
</svg>`;
writeFileSync(`${socialDir}/og-1200x630.png`, rasterize(og, 1200));

// 1080×1080 square (IG / avatar): centered stacked lockup on ink + corner ripple
const square = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1080" width="1080" height="1080">
  <rect width="1080" height="1080" fill="${INK}"/>
  <g>${rippleMotif(3.0, 80, 1000, 0.35)}</g>
  ${markGroup(PAPER, "translate(450 300) scale(5.6)")}
  ${wordmarkInline("sonara", PAPER, 300, 700, 150)}
  <text x="540" y="800" fill="${STONE}" font-family="monospace" font-size="30" letter-spacing="8" text-anchor="middle" style="text-transform:uppercase">MUSIC, MADE VISIBLE</text>
</svg>`;
writeFileSync(`${socialDir}/square-1080.png`, rasterize(square, 1080));
console.log("✓ social cards written");

// ===========================================================================
// 5. PDF (vector, for print) via cairosvg — best effort
// ===========================================================================
const printDir = dir("print");
function svgToPdf(svgPath: string, pdfPath: string) {
  execFileSync(VENV_PY, ["-c", `import cairosvg,sys; cairosvg.svg2pdf(url=sys.argv[1], write_to=sys.argv[2])`, svgPath, pdfPath]);
}
try {
  // light = ink lockup on (implicitly white) paper; dark = paper lockup
  svgToPdf(`${svgDir}/lockup-horizontal-ink.svg`, `${printDir}/lockup-horizontal-light.pdf`);
  svgToPdf(`${svgDir}/lockup-horizontal-paper.svg`, `${printDir}/lockup-horizontal-dark.pdf`);
  svgToPdf(`${svgDir}/lockup-stacked-ink.svg`, `${printDir}/lockup-stacked-light.pdf`);
  console.log("✓ PDF (vector) written via cairosvg");
} catch (e) {
  console.log("⚠ PDF step skipped:", (e as Error).message.split("\n")[0]);
}

// ===========================================================================
// 6. Contact sheet (one PNG overview of the system) — for quick review
// ===========================================================================
/** Place a standalone svg's content at (x,y), scaled so its height = targetH. */
function place(svg: string, x: number, y: number, targetH: number): string {
  const vb = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/)!;
  const k = targetH / Number(vb[2]);
  const inner = svg.replace(/^[\s\S]*?>/, "").replace(/<\/svg>\s*$/, "");
  return `<g transform="translate(${r2(x)} ${r2(y)}) scale(${r2(k)})">${inner}</g>`;
}
const swatch = (x: number, hex: string, label: string, fg: string) =>
  `<rect x="${x}" y="640" width="150" height="60" rx="4" fill="${hex}" stroke="${STONE}" stroke-opacity="0.4"/>` +
  `<text x="${x + 12}" y="724" font-family="monospace" font-size="16" fill="${fg}">${label} ${hex}</text>`;

const contact = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 760" width="1200" height="760">
  <rect width="1200" height="760" fill="${PAPER}"/>
  <rect x="600" width="600" height="760" fill="${INK}"/>
  <text x="48" y="56" font-family="serif" font-style="italic" font-size="30" fill="${INK}">Sonara — visual identity</text>
  <text x="648" y="56" font-family="monospace" font-size="16" letter-spacing="3" fill="${STONE}">ON DARK</text>
  <!-- LIGHT column (ink marks on paper) -->
  ${place(lockupHorizontal(INK), 48, 96, 64)}
  ${place(lockupStacked(INK), 48, 210, 150)}
  ${place(markSVG(INK), 300, 230, 110)}
  ${place(wordmarkSVG("sonara.fm", INK), 48, 420, 46)}
  <!-- DARK column (paper marks on ink) -->
  ${place(lockupHorizontal(PAPER), 648, 96, 64)}
  ${place(lockupStacked(PAPER), 648, 210, 150)}
  ${place(markSVG(PAPER), 900, 230, 110)}
  ${place(wordmarkSVG("sonara.fm", PAPER), 648, 420, 46)}
  <!-- palette -->
  ${swatch(48, PAPER, "paper", INK)}${swatch(210, INK, "ink", INK)}${swatch(372, STONE, "stone", INK)}
  <text x="648" y="560" font-family="serif" font-style="italic" font-size="22" fill="${PAPER}">Fraunces · Public Sans · IBM Plex Mono</text>
</svg>`;
writeFileSync(`${dir("png")}/contact-sheet.png`, rasterize(contact, 1400));
console.log("✓ contact sheet written");

// ===========================================================================
// 7. App integration — emit the static copies the Next app serves
// ===========================================================================
// The web app consumes a few of these assets directly (PWA manifest icons +
// the static OG/Twitter card). Generate them here too, from the same source, so
// `bun build.ts` keeps the app and the kit in sync and the checked-in app PNGs
// aren't orphan files. `tile`, `maskable`, and `og` are defined above.
const APP_PUBLIC = "/home/kristjan/code/sonara/apps/web/public";
const APP_DIR = "/home/kristjan/code/sonara/apps/web/src/app";
writeFileSync(`${APP_PUBLIC}/icon-192.png`, rasterize(tile, 192));
writeFileSync(`${APP_PUBLIC}/icon-512.png`, rasterize(tile, 512));
writeFileSync(`${APP_PUBLIC}/maskable-512.png`, rasterize(maskable, 512));
const ogPng = rasterize(og, 1200);
writeFileSync(`${APP_DIR}/opengraph-image.png`, ogPng);
writeFileSync(`${APP_DIR}/twitter-image.png`, ogPng);
console.log("✓ app integration assets written (public icons + static OG/Twitter)");

console.log("\nDone.");
