import { ImageResponse } from "next/og";

// Branded social card (1200×630, the summary_large_image standard) used as the
// default og:image / twitter:image for every route. Self-contained: the ripple
// mark + ink/paper palette carry the brand with no external image. The Fraunces
// wordmark is best-effort — if the font fetch fails, it falls back to Satori's
// default and the card still renders.
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Sonara — music, made visible";

const INK = "#1a1612";
const PAPER = "#ede7d9";
const STONE = "#8c8578";
const ring = (a: number) => `rgba(237, 231, 217, ${a})`;

// Nested bordered circles = the sonar mark (Satori-safe; alpha keeps the fade
// from compounding). `scale` lets the same shape serve as the foreground mark
// and the oversized background motif.
function rings(scale: number, alpha = 1): React.ReactNode {
  const c = (d: number, b: number, color: string, child?: React.ReactNode) => (
    <div
      style={{
        width: d * scale,
        height: d * scale,
        borderRadius: d * scale,
        border: `${b * scale}px solid ${color}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {child}
    </div>
  );
  return c(
    146,
    4,
    ring(0.28 * alpha),
    c(
      104,
      6,
      ring(0.55 * alpha),
      c(
        64,
        9,
        ring(alpha),
        <div
          style={{
            width: 26 * scale,
            height: 26 * scale,
            borderRadius: 26 * scale,
            background: ring(alpha),
          }}
        />,
      ),
    ),
  );
}

async function loadFraunces(): Promise<ArrayBuffer | null> {
  try {
    const css = await fetch(
      "https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@1,9..144,600&display=swap",
      // An old UA elicits a TTF src (Satori can't read woff2).
      { headers: { "User-Agent": "Mozilla/5.0 (compatible; MSIE 9.0)" } },
    ).then((r) => r.text());
    const url = css.match(/src: ?url\((https:[^)]+)\)/)?.[1];
    if (!url) return null;
    return await fetch(url).then((r) => r.arrayBuffer());
  } catch {
    return null;
  }
}

export default async function OpengraphImage() {
  const fraunces = await loadFraunces();
  const serif = fraunces ? "Fraunces" : "serif";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: INK,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 80,
          position: "relative",
        }}
      >
        {/* Oversized ripple motif bleeding off the bottom-right corner. */}
        <div
          style={{
            position: "absolute",
            right: -260,
            bottom: -260,
            display: "flex",
          }}
        >
          {rings(4.4, 0.5)}
        </div>

        {/* Mark + wordmark lockup, top-left. */}
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          {rings(0.62)}
          <div
            style={{
              fontFamily: serif,
              fontStyle: "italic",
              fontSize: 92,
              color: PAPER,
              lineHeight: 1,
            }}
          >
            sonara
          </div>
        </div>

        {/* Tagline. */}
        <div
          style={{
            fontFamily: serif,
            fontStyle: "italic",
            fontSize: 116,
            color: PAPER,
            lineHeight: 1.02,
            maxWidth: 900,
            display: "flex",
          }}
        >
          music, made visible.
        </div>

        {/* Footer line. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            fontSize: 26,
            letterSpacing: 4,
            textTransform: "uppercase",
            color: STONE,
          }}
        >
          sonara.fm
          <span style={{ color: ring(0.4) }}>·</span>
          live music visuals
        </div>
      </div>
    ),
    {
      ...size,
      fonts: fraunces
        ? [{ name: "Fraunces", data: fraunces, style: "italic", weight: 600 }]
        : [],
    },
  );
}
