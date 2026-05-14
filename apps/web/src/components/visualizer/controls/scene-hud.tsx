"use client";

import { useVisualizerStore } from "@/stores/visualizer";
import { cn } from "@/lib/utils";

export function SceneHud() {
  const status = useVisualizerStore((s) => s.status);
  const statusMessage = useVisualizerStore((s) => s.statusMessage);
  const version = useVisualizerStore((s) => s.latestVersion);
  const demoMode = useVisualizerStore((s) => s.demoMode);
  const demoDeck = useVisualizerStore((s) => s.demoDeck);

  const label = statusLabel(status);

  return (
    <div className="font-mono flex items-center gap-4 text-[10px] uppercase tracking-[0.22em] text-[color:var(--stone)]">
      {demoMode && (
        <span className="flex items-baseline gap-1.5">
          <span className="bg-[color:var(--paper)] text-[color:var(--ink)] px-1 tracking-[0.14em]">
            demo
          </span>
          {demoDeck && (
            <span className="text-[color:var(--paper)]">{demoDeck}</span>
          )}
        </span>
      )}

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
