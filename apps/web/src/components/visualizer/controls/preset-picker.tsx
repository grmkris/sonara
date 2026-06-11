"use client";

import { useEffect } from "react";

import { PRESET_DESCRIPTIONS, PRESET_NAMES } from "@/lib/render/presets";
import type { PresetName } from "@/lib/render/presets";
import { cn } from "@/lib/utils";
import { useVisualizerStore } from "@/stores/visualizer";
import type { PresetMode } from "@/stores/visualizer";

const MODES: { id: PresetMode; label: string; title: string }[] = [
  {
    id: "manual",
    label: "manual",
    title: "Stay on the selected preset until changed.",
  },
  { id: "cycle", label: "cycle", title: "Rotate through presets on a timer." },
  {
    id: "section",
    label: "section",
    title: "Switch preset whenever the server detects a music section change.",
  },
  {
    id: "llm",
    label: "llm",
    title: "Let the LLM pick the preset from your voice + the music.",
  },
];

// Pretty labels for the preset names (replace underscores).
const pretty = (name: PresetName): string => name.replaceAll("_", " ");

export const PresetPicker = () => {
  const preset = useVisualizerStore((s) => s.preset);
  const mode = useVisualizerStore((s) => s.presetMode);
  const cycleMs = useVisualizerStore((s) => s.presetCycleMs);
  const setPreset = useVisualizerStore((s) => s.setPreset);
  const setMode = useVisualizerStore((s) => s.setPresetMode);
  const setCycleMs = useVisualizerStore((s) => s.setPresetCycleMs);
  const savedPresets = useVisualizerStore((s) => s.savedPresets);
  const customPreset = useVisualizerStore((s) => s.customPreset);
  const snapshotCurrentPreset = useVisualizerStore(
    (s) => s.snapshotCurrentPreset
  );
  const selectSavedPreset = useVisualizerStore((s) => s.selectSavedPreset);
  const deleteSavedPreset = useVisualizerStore((s) => s.deleteSavedPreset);
  const savedNames = Object.keys(savedPresets);
  // A saved preset "appears active" when customPreset is set AND it matches
  // one of the saved entries by value-reference. We compare the JSON since
  // the stored snapshot is a deep copy.
  const activeSavedName =
    customPreset === null
      ? null
      : (savedNames.find(
          (n) =>
            JSON.stringify(savedPresets[n]) === JSON.stringify(customPreset)
        ) ?? null);

  // ===== Cycle mode: swap presets on a timer =====
  useEffect(() => {
    if (mode !== "cycle") {
      return;
    }
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      timer = setTimeout(() => {
        const cur = useVisualizerStore.getState().preset;
        // Pick a random different preset.
        const pool = PRESET_NAMES.filter((n) => n !== cur);
        const next = pool[Math.floor(Math.random() * pool.length)];
        if (next) {
          setPreset(next);
        }
        schedule();
      }, cycleMs);
    };
    schedule();
    return () => {
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [mode, cycleMs, setPreset]);

  // ===== Section mode: swap on server section triggers =====
  // Server sends job.status with reason="section" when it detects a musical
  // section change. pushTrigger mirrors those into the client log. We watch
  // the log for new section entries and pick a new preset.
  useEffect(() => {
    if (mode !== "section") {
      return;
    }
    let lastSeenId = useVisualizerStore.getState().triggerLog[0]?.id ?? 0;
    const unsub = useVisualizerStore.subscribe((state) => {
      const [head] = state.triggerLog;
      if (!head || head.id <= lastSeenId) {
        return;
      }
      lastSeenId = head.id;
      if (head.reason !== "section") {
        return;
      }
      const cur = useVisualizerStore.getState().preset;
      const pool = PRESET_NAMES.filter((n) => n !== cur);
      const next = pool[Math.floor(Math.random() * pool.length)];
      if (next) {
        setPreset(next);
      }
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
          const active = name === preset && customPreset === null;
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
                  : "border-transparent text-[color:var(--stone)] hover:text-[color:var(--paper)]/90 hover:border-[color:var(--hairline)]/40"
              )}
            >
              {pretty(name)}
            </button>
          );
        })}
        {savedNames.map((name) => {
          const active = name === activeSavedName;
          return (
            <button
              key={`saved:${name}`}
              type="button"
              onClick={() => selectSavedPreset(name)}
              onContextMenu={(ev) => {
                ev.preventDefault();
                // oxlint-disable-next-line no-alert -- REVIEW: native confirm is the intended lightweight delete guard
                if (window.confirm(`Delete saved preset "${name}"?`)) {
                  deleteSavedPreset(name);
                }
              }}
              title={`saved snapshot (right-click to delete): ${name}`}
              className={cn(
                "group font-serif text-[11px] italic tracking-normal transition-colors",
                "border-b px-1 pb-0.5",
                "before:mr-1 before:text-[color:var(--paper)]/60 before:content-['\u2022']",
                active
                  ? "border-[color:var(--paper)] text-[color:var(--paper)]"
                  : "border-transparent text-[color:var(--stone)] hover:text-[color:var(--paper)]/90 hover:border-[color:var(--hairline)]/40"
              )}
            >
              {name}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => {
            // oxlint-disable-next-line no-alert -- REVIEW: native prompt is the intended lightweight name capture
            const name = window.prompt("name this mid-state")?.trim();
            if (name) {
              snapshotCurrentPreset(name);
            }
          }}
          title="Capture the current effective preset (including any in-progress crossfade and drift) as a saved snapshot."
          className="font-mono text-[9px] uppercase tracking-[0.22em] text-[color:var(--stone)] hover:text-[color:var(--paper)] border-b border-dashed border-[color:var(--hairline)]/40 px-1 pb-0.5"
        >
          + save
        </button>
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
                  "border-b px-1 pb-0.5",
                  active
                    ? "border-[color:var(--paper)] text-[color:var(--paper)]"
                    : "border-transparent text-[color:var(--stone)] hover:text-[color:var(--paper)]/80 hover:border-[color:var(--hairline)]/40"
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
            aria-label="cycle period in seconds"
          />
          <span className="font-mono nums text-[10px] text-[color:var(--paper)]/80 w-10 text-right">
            {Math.round(cycleMs / 1000)}s
          </span>
        </div>
      )}
    </div>
  );
};
