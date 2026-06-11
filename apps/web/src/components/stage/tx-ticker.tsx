"use client";

import type { StageActivityEvent } from "@sonara/shared";

import { cn } from "@/lib/utils";

import { HandleGlyph } from "./address-glyph";

// Teleprinter feed of crowd actions, newest at the BOTTOM — the paper feeds
// upward, like the hardware. Stable seq keys mean only genuinely new lines
// mount and run the .wire-print reveal; older lines fade with height.

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
}) => (
  <li className="wire-print" style={{ opacity: fade }}>
    <span
      className={cn(
        "flex items-baseline gap-2 whitespace-nowrap font-mono uppercase tracking-[0.18em] text-[color:var(--paper)]/85",
        dense ? "text-[9px]" : "text-[10px]"
      )}
    >
      <HandleGlyph
        className="shrink-0 self-center"
        size={dense ? 9 : 11}
        who={event.who}
      />
      <span className="text-[color:var(--stone)]">{event.who}</span>
      <span>{actionLabel(event)}</span>
      {event.kind === "prompt" && event.text && (
        <span className="max-w-[15ch] truncate font-serif normal-case italic tracking-normal text-[color:var(--paper)]/70">
          “{event.text}”
        </span>
      )}
    </span>
  </li>
);

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
