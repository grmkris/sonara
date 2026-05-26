import { ImageResponse } from "next/og";

// iOS home-screen icon (PNG). Drawn as nested bordered circles rather than SVG
// so it renders reliably in Satori; alpha colours (not `opacity`) keep the
// fade from compounding through the nesting. Geometry mirrors lib/brand.ts.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

const INK = "#1a1612";
const ring = (alpha: number) => `rgba(237, 231, 217, ${alpha})`;
const PAPER = "#ede7d9";

const circle = (
  d: number,
  border: number,
  color: string,
  child?: React.ReactNode,
): React.ReactNode => (
  <div
    style={{
      width: d,
      height: d,
      borderRadius: d,
      border: `${border}px solid ${color}`,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    }}
  >
    {child}
  </div>
);

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: INK,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {circle(
          146,
          4,
          ring(0.28),
          circle(
            104,
            6,
            ring(0.55),
            circle(
              64,
              9,
              PAPER,
              <div
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 26,
                  background: PAPER,
                }}
              />,
            ),
          ),
        )}
      </div>
    ),
    size,
  );
}
