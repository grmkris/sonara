// Deterministic mini-mark for a crowd handle, so repeat participants become
// recognizable characters in the wire feed without avatars. Hue + one of six
// proofreader-style strokes derived from a string hash — desaturated so it
// sits inside the ink/paper palette and never competes with --signal.

// Simple multiplicative string hash — handles are short opaque strings, not
// hex. No bitwise ops (lint) — Math.imul + abs keeps it deterministic.
const hash = (s: string): number => {
  let h = 7;
  for (const ch of s) {
    h = Math.abs(Math.imul(h, 31) + (ch.codePointAt(0) ?? 0));
  }
  return h;
};

export const glyphFor = (who: string): { hue: number; mark: number } => {
  const h = hash(who.toLowerCase());
  return {
    hue: h % 360,
    mark: Math.floor(h / 360) % 6,
  };
};

const MARKS = [
  // dot
  <circle cx="6" cy="6" fill="currentColor" key="dot" r="2.2" stroke="none" />,
  // hollow square
  <rect height="6.5" key="square" rx="0.5" width="6.5" x="2.75" y="2.75" />,
  // diagonal slash
  <path d="M2.5 9.5 9.5 2.5" key="slash" />,
  // cross
  <path d="M6 2.5v7M2.5 6h7" key="cross" />,
  // triangle
  <path d="M6 2.8 9.6 9.2H2.4Z" key="triangle" />,
  // double dash
  <path d="M2.5 4.4h7M2.5 7.6h7" key="dashes" />,
];

export const HandleGlyph = ({
  who,
  className,
  size = 12,
}: {
  who: string;
  className?: string;
  size?: number;
}) => {
  const { hue, mark } = glyphFor(who);
  return (
    <svg
      aria-hidden
      className={className}
      fill="none"
      height={size}
      stroke={`hsl(${hue} 30% 64%)`}
      strokeWidth="1"
      style={{ color: `hsl(${hue} 30% 64%)` }}
      viewBox="0 0 12 12"
      width={size}
    >
      {MARKS[mark]}
    </svg>
  );
};
