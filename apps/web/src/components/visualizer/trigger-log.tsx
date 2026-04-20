"use client";

import { ScrollArea } from "@/components/ui/scroll-area";
import {
  type TriggerEntry,
  type TriggerReason,
  useVisualizerStore,
} from "@/stores/visualizer-store";

// Rolling log of generation triggers. Reason is shown as a single decorative
// kanji seal followed by English status. Kept newest-first, truncated to 5.
const REASON_META: Record<
  TriggerReason,
  { seal: string; label: string }
> = {
  pause:    { seal: "間", label: "pause"    },
  semantic: { seal: "詞", label: "edit"     },
  section:  { seal: "節", label: "section"  },
  periodic: { seal: "律", label: "periodic" },
  commit:   { seal: "印", label: "commit"   },
  voice:    { seal: "声", label: "voice"    },
};

const VISIBLE = 5;

export function TriggerLog() {
  const entries = useVisualizerStore((s) => s.triggerLog);
  if (entries.length === 0) return null;

  return (
    <div className="pointer-events-none flex flex-col gap-0.5">
      <ScrollArea className="max-h-[72px]">
        <ul className="font-plex nums flex flex-col gap-0.5 text-right text-[9px] uppercase tracking-[0.18em] text-[color:var(--stone)]/70">
          {entries.slice(0, VISIBLE).map((e) => (
            <li
              key={e.id}
              className="flex items-baseline justify-end gap-2"
              style={{ animation: "log-fade 600ms ease forwards" }}
            >
              <span className="font-mincho text-[color:var(--paper)]/80 text-[13px] leading-none normal-case tracking-normal">
                {REASON_META[e.reason].seal}
              </span>
              <span className="text-[color:var(--paper)]/75">
                {REASON_META[e.reason].label}
              </span>
              <span>· v{e.version.toString().padStart(2, "0")}</span>
              <span>· {formatClock(e.at)}</span>
            </li>
          ))}
        </ul>
      </ScrollArea>
    </div>
  );
}

function formatClock(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// Silence unused export warning when consumers only use the component.
export type { TriggerEntry };
