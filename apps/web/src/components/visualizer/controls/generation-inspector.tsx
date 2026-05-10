"use client";

import { useEffect, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  type DriftSource,
  type TriggerEntry,
  type TriggerReason,
  useVisualizerStore,
} from "@/stores/visualizer-store";

// Replaces the old TriggerLog with a fuller observability surface for the
// generation pipeline. Shows the most recent ResolvedScene, drift source,
// palette swatches, the prompt string sent to FAL, and a rolling recent log.
//
// Read-only — no actions live here. The data comes from `generation.requested`
// and `generation.completed` WS events fanned into the inspector + triggerLog
// store slices.

const REASON_META: Record<TriggerReason, { code: string; label: string }> = {
  pause:    { code: "p", label: "pause"    },
  semantic: { code: "s", label: "edit"     },
  section:  { code: "e", label: "section"  },
  periodic: { code: "t", label: "periodic" },
  commit:   { code: "c", label: "commit"   },
  voice:    { code: "v", label: "voice"    },
};

const DRIFT_META: Record<DriftSource, { label: string; tone: string }> = {
  llm:   { label: "llm",     tone: "text-[color:var(--paper)]"  },
  voice: { label: "voice",   tone: "text-[color:var(--paper)]"  },
  pool:  { label: "pool",    tone: "text-[color:var(--stone)]" },
  none:  { label: "none",    tone: "text-[color:var(--stone)]/60" },
};

const VISIBLE_LOG = 4;

export function GenerationInspector() {
  const inspector = useVisualizerStore((s) => s.inspector);
  const log = useVisualizerStore((s) => s.triggerLog);

  if (!inspector && log.length === 0) return null;

  return (
    <div className="pointer-events-auto flex flex-col gap-2 text-right">
      {inspector && <Header inspector={inspector} />}
      {inspector && <Palette colors={inspector.resolvedScene.color_palette} />}
      {inspector && <SubjectLine inspector={inspector} />}
      {inspector && <Details inspector={inspector} />}
      <RecentLog entries={log} />
    </div>
  );
}

function Header({
  inspector,
}: {
  inspector: NonNullable<ReturnType<typeof useVisualizerStore.getState>["inspector"]>;
}) {
  const reason = REASON_META[inspector.reason];
  const drift = DRIFT_META[inspector.driftSource];
  return (
    <div className="font-mono nums flex items-baseline justify-end gap-2 text-[10px] uppercase tracking-[0.2em] text-[color:var(--paper)]/85">
      <span>[{reason.code}]</span>
      <span>{reason.label}</span>
      <span className="text-[color:var(--stone)]">·</span>
      <span>v{inspector.version.toString().padStart(2, "0")}</span>
      <span className="text-[color:var(--stone)]">·</span>
      <span className={drift.tone}>drift {drift.label}</span>
      <Countdown nextAt={inspector.nextKeyframeAt} />
    </div>
  );
}

// Compact swatch row — one square per hex color in the resolved palette.
// Empty palette renders nothing (no LLM-extracted colors yet for this scene).
function Palette({ colors }: { colors: string[] }) {
  if (colors.length === 0) return null;
  return (
    <div className="flex items-center justify-end gap-1">
      {colors.slice(0, 6).map((c, i) => (
        <span
          key={`${c}-${i}`}
          className="h-3 w-3 rounded-sm border border-[color:var(--hairline)]/40"
          style={{ backgroundColor: c }}
          title={c}
        />
      ))}
    </div>
  );
}

function SubjectLine({
  inspector,
}: {
  inspector: NonNullable<ReturnType<typeof useVisualizerStore.getState>["inspector"]>;
}) {
  const first = inspector.resolvedScene.subjects[0]?.description ?? "—";
  const extra = inspector.resolvedScene.subjects.length - 1;
  return (
    <div className="font-sans truncate text-right text-[11px] italic text-[color:var(--paper)]/80">
      {first}
      {extra > 0 && (
        <span className="ml-1 text-[9px] uppercase tracking-[0.18em] text-[color:var(--stone)]/70 not-italic">
          +{extra}
        </span>
      )}
    </div>
  );
}

function Details({
  inspector,
}: {
  inspector: NonNullable<ReturnType<typeof useVisualizerStore.getState>["inspector"]>;
}) {
  const status = inspector.success === null
    ? "running"
    : inspector.success
      ? `done · ${inspector.durationMs ?? 0}ms`
      : "error";
  return (
    <div className="flex flex-col items-end gap-1 text-[9px] uppercase tracking-[0.18em] text-[color:var(--stone)]/70">
      <span className="font-mono nums">{status}</span>
      <details className="group w-full">
        <summary className="font-mono cursor-pointer list-none text-right hover:text-[color:var(--paper)]">
          prompt ↓
        </summary>
        <pre className="font-mono mt-1 max-h-28 overflow-auto whitespace-pre-wrap break-words rounded-sm border border-[color:var(--hairline)]/30 bg-black/30 p-2 text-left text-[9px] tracking-normal normal-case text-[color:var(--paper)]/75">
          {inspector.promptString}
        </pre>
      </details>
      <details className="group w-full">
        <summary className="font-mono cursor-pointer list-none text-right hover:text-[color:var(--paper)]">
          scene json ↓
        </summary>
        <pre className="font-mono mt-1 max-h-48 overflow-auto whitespace-pre rounded-sm border border-[color:var(--hairline)]/30 bg-black/30 p-2 text-left text-[9px] tracking-normal normal-case text-[color:var(--paper)]/75">
          {JSON.stringify(inspector.resolvedScene, null, 2)}
        </pre>
      </details>
    </div>
  );
}

function RecentLog({ entries }: { entries: TriggerEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <ScrollArea className="max-h-[64px]">
      <ul className="font-mono nums flex flex-col gap-0.5 text-right text-[9px] uppercase tracking-[0.18em] text-[color:var(--stone)]/70">
        {entries.slice(0, VISIBLE_LOG).map((e) => (
          <li
            key={e.id}
            className="flex items-baseline justify-end gap-2"
            style={{ animation: "log-fade 600ms ease forwards" }}
          >
            <span className="text-[color:var(--paper)]/80">[{REASON_META[e.reason].code}]</span>
            <span>v{e.version.toString().padStart(2, "0")}</span>
            {typeof e.durationMs === "number" && (
              <span>· {e.durationMs}ms</span>
            )}
            <span>· {formatClock(e.at)}</span>
          </li>
        ))}
      </ul>
    </ScrollArea>
  );
}

// Countdown to the next periodic keyframe. Re-renders ~1Hz; harmless on a
// component that already lives in the (already-mounted) inspector tree.
function Countdown({ nextAt }: { nextAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  const remaining = Math.max(0, Math.round((nextAt - now) / 1000));
  return <span className="ml-1 text-[color:var(--stone)]/70">· {remaining}s</span>;
}

function formatClock(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
