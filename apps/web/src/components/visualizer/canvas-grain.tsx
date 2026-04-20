// Paper-grain overlay. One 240×240 SVG tile tiled with fractal-noise turbulence.
// Tuned to sit *under* color but *above* the image, so it reads as tooth, not haze.
export function CanvasGrain() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0"
      style={{
        backgroundImage: `url("data:image/svg+xml;utf8,${encodeURIComponent(
          `<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.93  0 0 0 0 0.90  0 0 0 0 0.84  0 0 0 0.9 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>`,
        )}")`,
        backgroundSize: "240px 240px",
        opacity: 0.07,
        mixBlendMode: "overlay",
      }}
    />
  );
}
