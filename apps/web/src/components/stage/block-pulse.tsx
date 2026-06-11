"use client";

import { cn } from "@/lib/utils";

// Live Monad block-number odometer. Each digit is a 1ch window over a rolled
// 0–9 column; blocks land every ~400ms so only the trailing column or two
// ever moves — exactly the mechanical-counter feel. A 1px hairline keyed by
// blockNumber re-mounts per block to strike the .wire-flash, making the
// chain's cadence visible even when nobody is tapping.

const DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];

const OdometerDigit = ({ digit }: { digit: number }) => (
  <span className="relative inline-block h-[1em] w-[1ch] overflow-hidden align-baseline">
    <span
      className="absolute left-0 top-0 flex flex-col leading-none transition-transform duration-200 ease-out motion-reduce:transition-none"
      style={{ transform: `translateY(-${digit}em)` }}
    >
      {DIGITS.map((d) => (
        <span className="h-[1em]" key={d}>
          {d}
        </span>
      ))}
    </span>
  </span>
);

export const BlockPulse = ({
  blockNumber,
  className,
  dense = false,
}: {
  blockNumber: number | null;
  className?: string;
  dense?: boolean;
}) => {
  const digits =
    blockNumber === null ? [] : [...blockNumber.toString()].map(Number);
  return (
    <span className={cn("inline-flex flex-col gap-0.5", className)}>
      <span
        className={cn(
          "flex items-baseline gap-1.5 font-mono tabular-nums text-[color:var(--paper)]/85",
          dense ? "text-[9px]" : "text-[11px]"
        )}
      >
        <span className="uppercase tracking-[0.26em] text-[color:var(--stone)]">
          block
        </span>
        {blockNumber === null ? (
          <span className="text-[color:var(--stone)]">———</span>
        ) : (
          <span className="inline-flex">
            {digits.map((d, i) => (
              // Key from the right so a length increase prepends a column
              // instead of reshuffling every digit.
              <OdometerDigit digit={d} key={digits.length - i} />
            ))}
          </span>
        )}
      </span>
      {blockNumber !== null && (
        <span
          aria-hidden
          className="wire-flash block h-px w-full bg-[color:var(--hairline)]"
          key={blockNumber}
        />
      )}
    </span>
  );
};
