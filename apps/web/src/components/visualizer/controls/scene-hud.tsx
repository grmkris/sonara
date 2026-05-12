"use client";

import { useVisualizerStore } from "@/stores/visualizer";
import { cn } from "@/lib/utils";

export function SceneHud() {
  const status = useVisualizerStore((s) => s.status);
  const statusMessage = useVisualizerStore((s) => s.statusMessage);
  const connected = useVisualizerStore((s) => s.connected);
  const version = useVisualizerStore((s) => s.latestVersion);

  const label = statusLabel(status);

  return (
    <div className="font-mono flex items-center gap-4 text-[10px] uppercase tracking-[0.22em] text-[color:var(--stone)]">
      <span className="flex items-center gap-1.5">
        <span
          aria-hidden
          className={cn(
            "inline-block size-1.5 rounded-full",
            connected
              ? "bg-[color:var(--paper)]"
              : "bg-[color:var(--stone)]",
          )}
        />
        <span>ws</span>
      </span>

      <span className="flex items-baseline gap-1.5">
        <span className="tracking-[0.18em]">ver</span>
        <span className="nums text-[color:var(--paper)]">
          {version.toString().padStart(2, "0")}
        </span>
      </span>

      <span className="flex items-baseline gap-1.5">
        <span className={cn("tracking-[0.22em]", label.tone)}>
          {label.text}
        </span>
        {statusMessage && status !== "idle" && (
          <span className="normal-case text-[color:var(--stone)]">
            · {statusMessage}
          </span>
        )}
      </span>

      <span className="ml-auto flex items-center gap-4 tracking-[0.18em]">
        <span className="flex items-baseline gap-1">
          <span className="text-[color:var(--paper)]">⌫</span>
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
      return { text: "error", tone: "text-[color:var(--signal)]" };
    case "cancelled":
      return { text: "cancelled", tone: "text-[color:var(--stone)]" };
    default:
      return { text: "idle", tone: "text-[color:var(--stone)]" };
  }
}
