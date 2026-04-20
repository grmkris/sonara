"use client";

import { useEffect } from "react";
import {
  PRESET_DESCRIPTIONS,
  PRESET_NAMES,
  type PresetName,
} from "@/lib/render/presets";
import { useVisualizerStore, type PresetMode } from "@/stores/visualizer-store";
import { cn } from "@/lib/utils";

const MODES: { id: PresetMode; label: string; title: string }[] = [
  { id: "manual", label: "manual",  title: "Stay on the selected preset until changed." },
  { id: "cycle",  label: "cycle",   title: "Rotate through presets on a timer." },
  { id: "section",label: "section", title: "Switch preset whenever the server detects a music section change." },
  { id: "llm",    label: "llm",     title: "Let the drift LLM pick a preset based on scene + voice + mood." },
];

// Pretty labels for the preset names (replace underscores).
function pretty(name: PresetName): string {
  return name.replace(/_/g, " ");
}

export function PresetPicker() {
  const preset = useVisualizerStore((s) => s.preset);
  const mode = useVisualizerStore((s) => s.presetMode);
  const cycleMs = useVisualizerStore((s) => s.presetCycleMs);
  const setPreset = useVisualizerStore((s) => s.setPreset);
  const setMode = useVisualizerStore((s) => s.setPresetMode);
  const setCycleMs = useVisualizerStore((s) => s.setPresetCycleMs);

  // ===== Cycle mode: swap presets on a timer =====
  useEffect(() => {
    if (mode !== "cycle") return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      timer = setTimeout(() => {
        const cur = useVisualizerStore.getState().preset;
        // Pick a random different preset.
        const pool = PRESET_NAMES.filter((n) => n !== cur);
        const next = pool[Math.floor(Math.random() * pool.length)];
        if (next) setPreset(next);
        schedule();
      }, cycleMs);
    };
    schedule();
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [mode, cycleMs, setPreset]);

  // ===== Section mode: swap on server section triggers =====
  // Server sends job.status with reason="section" when it detects a musical
  // section change. pushTrigger mirrors those into the client log. We watch
  // the log for new section entries and pick a new preset.
  useEffect(() => {
    if (mode !== "section") return;
    let lastSeenId = useVisualizerStore.getState().triggerLog[0]?.id ?? 0;
    const unsub = useVisualizerStore.subscribe((state) => {
      const head = state.triggerLog[0];
      if (!head || head.id <= lastSeenId) return;
      lastSeenId = head.id;
      if (head.reason !== "section") return;
      const cur = useVisualizerStore.getState().preset;
      const pool = PRESET_NAMES.filter((n) => n !== cur);
      const next = pool[Math.floor(Math.random() * pool.length)];
      if (next) setPreset(next);
    });
    return unsub;
  }, [mode, setPreset]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <span className="font-sans text-[9px] uppercase tracking-[0.3em] text-[color:var(--stone)]">
          preset
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--paper)]/70">
          {pretty(preset)}
        </span>
      </div>

      {/* Preset chips. Wrap to multiple rows. */}
      <div className="flex flex-wrap gap-1.5">
        {PRESET_NAMES.map((name) => {
          const active = name === preset;
          return (
            <button
              key={name}
              type="button"
              onClick={() => setPreset(name)}
              title={PRESET_DESCRIPTIONS[name]}
              className={cn(
                "group font-serif text-[11px] tracking-normal transition-colors",
                "border-b px-1 pb-0.5",
                active
                  ? "border-[color:var(--paper)] text-[color:var(--paper)]"
                  : "border-transparent text-[color:var(--stone)] hover:text-[color:var(--paper)]/90 hover:border-[color:var(--hairline)]/40",
              )}
            >
              {pretty(name)}
            </button>
          );
        })}
      </div>

      {/* Mode selector */}
      <div className="mt-1 flex items-baseline gap-2">
        <span className="font-sans text-[9px] uppercase tracking-[0.3em] text-[color:var(--stone)]">
          mode
        </span>
        <div className="flex items-center gap-2">
          {MODES.map((m) => {
            const active = mode === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setMode(m.id)}
                title={m.title}
                className={cn(
                  "font-mono text-[9px] uppercase tracking-[0.22em] transition-colors",
                  active
                    ? "text-[color:var(--paper)]"
                    : "text-[color:var(--stone)] hover:text-[color:var(--paper)]/80",
                )}
              >
                {m.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Cycle period slider, only visible in cycle mode */}
      {mode === "cycle" && (
        <div className="flex items-center gap-2 text-[color:var(--stone)]">
          <span className="font-sans text-[9px] uppercase tracking-[0.3em]">
            every
          </span>
          <input
            type="range"
            min={15}
            max={300}
            step={5}
            value={Math.round(cycleMs / 1000)}
            onChange={(ev) => setCycleMs(Number(ev.target.value) * 1000)}
            className="flex-1 accent-[color:var(--paper)]"
          />
          <span className="font-mono nums text-[10px] text-[color:var(--paper)]/80 w-10 text-right">
            {Math.round(cycleMs / 1000)}s
          </span>
        </div>
      )}
    </div>
  );
}
