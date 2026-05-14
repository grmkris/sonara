"use client";

import { useFps } from "@/hooks/use-fps";
import { useThrottledValue } from "@/hooks/use-throttled-value";
import { useUptime } from "@/hooks/use-uptime";
import { useVisualizerStore } from "@/stores/visualizer";
import { cn } from "@/lib/utils";

// Mission-control style status strip beneath the wordmark.
// Layout: DEMO <deck> · VER nn · AMP 0.62 · FPS 60 · UP MM:SS · <status>.
// Telemetry readouts are passive (text-only) — no buttons or interaction.
export function SceneHud() {
  const status = useVisualizerStore((s) => s.status);
  const statusMessage = useVisualizerStore((s) => s.statusMessage);
  const version = useVisualizerStore((s) => s.latestVersion);
  const demoMode = useVisualizerStore((s) => s.demoMode);
  const demoDeck = useVisualizerStore((s) => s.demoDeck);
  const rms = useVisualizerStore((s) => s.audio.rms);

  const fps = useFps();
  const uptime = useUptime();
  // RMS lands every frame from the audio analyser — render-throttled to 4Hz so
  // the strip doesn't repaint 60 times a second.
  const ampDisplay = useThrottledValue(rms, 250);
  const ampLabel = ampDisplay > 0.001 ? ampDisplay.toFixed(2) : "—";

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

      <Readout label="ver" value={version.toString().padStart(2, "0")} accent />
      <Readout label="amp" value={ampLabel} />
      <Readout label="fps" value={String(fps)} />
      <Readout label="up" value={uptime} />

      <span className="flex items-baseline gap-1.5">
        <span
          className={cn(
            "tracking-[0.18em]",
            label.italic && "font-serif italic tracking-normal text-[12px]",
            label.tone,
          )}
        >
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

function Readout({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="tracking-[0.22em]">{label}</span>
      <span
        className={cn(
          "nums",
          accent
            ? "text-[color:var(--paper)]"
            : "text-[color:var(--paper)]/75",
        )}
      >
        {value}
      </span>
    </span>
  );
}

function statusLabel(
  status: string,
): { text: string; tone: string; italic: boolean } {
  switch (status) {
    case "running":
      return {
        text: "rendering",
        tone: "text-[color:var(--paper)]",
        italic: true,
      };
    case "error":
      return {
        text: "error",
        tone: "text-[color:var(--signal)]",
        italic: false,
      };
    case "cancelled":
      return {
        text: "stopped",
        tone: "text-[color:var(--stone)]",
        italic: true,
      };
    default:
      return {
        text: "waiting",
        tone: "text-[color:var(--stone)]",
        italic: true,
      };
  }
}
