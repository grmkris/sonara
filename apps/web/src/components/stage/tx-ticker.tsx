"use client";

import { formatUsdc, txExplorerUrl } from "@sonara/onchain";
import type { StageActivityEvent } from "@sonara/shared";

import { cn } from "@/lib/utils";

import { AddressGlyph, shortAddress } from "./address-glyph";

// Teleprinter feed of on-chain actions, newest at the BOTTOM — the paper
// feeds upward, like the hardware. Stable seq keys mean only genuinely new
// lines mount and run the .wire-print reveal; older lines fade with height.
// Each line links to the tx on the chain explorer (new tab) — the wire
// wrappers are pointer-events-none, so the anchor re-enables its own events.

// "+0.50" → "+0.5", "1.00" → "1"
const trimZeros = (units: string): string =>
  formatUsdc(BigInt(units)).replace(/\.0+$|(\.\d*?)0+$/u, "$1");

const actionLabel = (e: StageActivityEvent): string => {
  if (e.kind === "nudge") {
    const delta = e.delta ?? 0;
    return `${e.knob ?? "?"} ${delta >= 0 ? "+" : ""}${delta.toFixed(2)}`;
  }
  if (e.kind === "set") {
    return `${e.knob ?? "?"} = ${(e.value ?? 0).toFixed(2)}`;
  }
  return "prompt";
};

const TickerLine = ({
  dense,
  event,
  fade,
}: {
  dense: boolean;
  event: StageActivityEvent;
  fade: number;
}) => {
  const tipped = event.kind === "prompt" && event.tip && event.tip !== "0";
  return (
    <li className="wire-print" style={{ opacity: fade }}>
      <a
        href={txExplorerUrl(event.txHash)}
        target="_blank"
        rel="noreferrer"
        title="view tx on monadscan"
        className={cn(
          "focus-ring group pointer-events-auto flex items-baseline gap-2 whitespace-nowrap font-mono uppercase tracking-[0.18em] text-[color:var(--paper)]/85 transition-colors hover:text-[color:var(--paper)]",
          dense ? "text-[9px]" : "text-[10px]"
        )}
      >
        <AddressGlyph
          address={event.who}
          className="shrink-0 self-center"
          size={dense ? 9 : 11}
        />
        <span className="text-[color:var(--stone)]">
          {shortAddress(event.who)}
        </span>
        <span>{actionLabel(event)}</span>
        {event.kind === "prompt" && event.text && (
          <span className="max-w-[15ch] truncate font-serif normal-case italic tracking-normal text-[color:var(--paper)]/70">
            “{event.text}”
          </span>
        )}
        {tipped && (
          <span className="text-[color:var(--signal)]">
            +{trimZeros(event.tip ?? "0")} USDC
          </span>
        )}
        {event.agent && (
          <span className="text-[color:var(--stone)]/80">· agent</span>
        )}
        <span
          aria-hidden
          className="text-[color:var(--stone)]/60 opacity-0 transition-opacity group-hover:opacity-100"
        >
          ↗
        </span>
      </a>
    </li>
  );
};

export const TxTicker = ({
  className,
  dense = false,
  events,
  max = 6,
}: {
  className?: string;
  dense?: boolean;
  // newest first, as use-stage-feed provides
  events: StageActivityEvent[];
  max?: number;
}) => {
  const shown = events.slice(0, max);
  if (shown.length === 0) {
    return null;
  }
  return (
    <ul
      className={cn("flex flex-col-reverse gap-1 overflow-hidden", className)}
    >
      {shown.map((event, i) => (
        <TickerLine
          dense={dense}
          event={event}
          fade={1 - i * 0.13}
          key={event.seq}
        />
      ))}
    </ul>
  );
};
