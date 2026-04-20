"use client";

import { useVisualizerStore } from "@/stores/visualizer-store";
import { cn } from "@/lib/utils";

export function SceneHud() {
  const status = useVisualizerStore((s) => s.status);
  const statusMessage = useVisualizerStore((s) => s.statusMessage);
  const connected = useVisualizerStore((s) => s.connected);
  const version = useVisualizerStore((s) => s.latestVersion);
  const commitPulse = useVisualizerStore((s) => s.commitPulse);

  const label = statusLabel(status);

  return (
    <div className="font-plex flex items-center gap-4 text-[10px] uppercase tracking-[0.22em] text-[color:var(--stone)]">
      <span className="flex items-center gap-1.5">
        <span
          aria-hidden
          className={cn(
            "inline-block h-1.5 w-1.5 rounded-full",
            connected
              ? "bg-[color:var(--paper)]"
              : "bg-[color:var(--hanko)]",
          )}
        />
        <span>ws</span>
      </span>

      <span className="flex items-baseline gap-1.5">
        {/* 版 as a decorative hanko-red seal, not a label. */}
        <span
          aria-hidden
          className="font-mincho text-[11px] normal-case tracking-normal text-[color:var(--hanko)]/90"
        >
          版
        </span>
        <span className="nums text-[color:var(--paper)]">
          v{version.toString().padStart(2, "0")}
        </span>
        {commitPulse > 0 && (
          <span
            key={commitPulse}
            className="hanko-tick ml-1 inline-block h-1.5 w-1.5 bg-[color:var(--hanko)]"
          />
        )}
      </span>

      <span className="flex items-baseline gap-1.5">
        <span className={cn("tracking-[0.22em]", label.tone)}>
          {label.text}
        </span>
        {statusMessage && status !== "idle" && (
          <span className="text-[color:var(--stone)] normal-case">
            · {statusMessage}
          </span>
        )}
      </span>

      <span className="ml-auto flex items-center gap-4 normal-case tracking-[0.18em]">
        <span className="flex items-baseline gap-1">
          <span className="font-mincho text-[11px] text-[color:var(--paper)]">⏎</span>
          <span>commit</span>
        </span>
        <span className="flex items-baseline gap-1">
          <span className="font-mincho text-[11px] text-[color:var(--paper)]">⌫</span>
          <span>reset</span>
        </span>
      </span>
    </div>
  );
}

function statusLabel(status: string): { text: string; tone: string } {
  switch (status) {
    case "running":
      return { text: "generating", tone: "text-[color:var(--paper)]" };
    case "error":
      return { text: "error",      tone: "text-[color:var(--hanko)]" };
    case "cancelled":
      return { text: "cancelled",  tone: "text-[color:var(--stone)]" };
    default:
      return { text: "idle",       tone: "text-[color:var(--stone)]" };
  }
}
