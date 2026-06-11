// Deterministic mini-mark for an on-chain address, so repeat participants
// become recognizable characters in the wire feed without avatars. Hue + one
// of six proofreader-style strokes derived from the hex — desaturated so it
// sits inside the ink/paper palette and never competes with --signal.

export const glyphFor = (address: string): { hue: number; mark: number } => {
  const hex = address.toLowerCase().replace(/^0x/u, "").padEnd(10, "0");
  return {
    hue: Number.parseInt(hex.slice(0, 6), 16) % 360,
    mark: Number.parseInt(hex.slice(6, 8), 16) % 6,
  };
};

export const shortAddress = (address: string): string =>
  `${address.slice(0, 6)}…${address.slice(-4)}`;

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

export const AddressGlyph = ({
  address,
  className,
  size = 12,
}: {
  address: string;
  className?: string;
  size?: number;
}) => {
  const { hue, mark } = glyphFor(address);
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
