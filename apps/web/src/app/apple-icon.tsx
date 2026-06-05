import { ImageResponse } from "next/og";

// iOS home-screen icon (PNG). Drawn as nested bordered circles rather than SVG
// so it renders reliably in Satori; alpha colours (not `opacity`) keep the
// fade from compounding through the nesting. Geometry mirrors lib/brand.ts.
export const size = { height: 180, width: 180 };
export const contentType = "image/png";

const INK = "#1a1612";
const ring = (alpha: number) => `rgba(237, 231, 217, ${alpha})`;
const PAPER = "#ede7d9";

const circle = (
  d: number,
  border: number,
  color: string,
  child?: React.ReactNode
): React.ReactNode => (
  <div
    style={{
      alignItems: "center",
      border: `${border}px solid ${color}`,
      borderRadius: d,
      display: "flex",
      height: d,
      justifyContent: "center",
      width: d,
    }}
  >
    {child}
  </div>
);

export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        alignItems: "center",
        background: INK,
        display: "flex",
        height: "100%",
        justifyContent: "center",
        width: "100%",
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
                background: PAPER,
                borderRadius: 26,
                height: 26,
                width: 26,
              }}
            />
          )
        )
      )}
    </div>,
    size
  );
}
