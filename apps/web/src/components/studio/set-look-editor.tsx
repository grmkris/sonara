"use client";

import { DEFAULT_CADENCE } from "@sonara/shared";
import type { SetLook } from "@sonara/shared";
import { Palette } from "lucide-react";
import { useState } from "react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { PRESET_DESCRIPTIONS, PRESET_NAMES } from "@/lib/render/presets";
import { cn } from "@/lib/utils";

interface SetLookEditorProps {
  look: SetLook | null;
  onChange: (look: SetLook | null) => void;
}

const NEW_LOOK: SetLook = {
  cadence: { ...DEFAULT_CADENCE },
  intensity: 0.5,
  preset: "rave",
};

const LABEL =
  "font-sans text-[9px] uppercase tracking-[0.28em] text-[color:var(--stone)]";

const secs = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;

// The look's calm/loud cadence is the audio-reactive hold range (un-pinned
// frames interpolate between them by live intensity). We expose it as two
// intuitive knobs instead — an "average hold" and how hard it "reacts to
// music" — and map back and forth. react=0 → calm==loud (steady); higher react
// → longer on calm, shorter on loud.
const MIN_HOLD = 500;
const MAX_HOLD = 30_000;
const clamp = (n: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, n));

const toCadence = (
  avgHold: number,
  react: number
): { calm: number; loud: number } => ({
  calm: Math.round(clamp(avgHold * (1 + react), 1000, MAX_HOLD)),
  loud: Math.round(clamp(avgHold * (1 - 0.8 * react), MIN_HOLD, MAX_HOLD)),
});

const fromCadence = (cadence: {
  calm: number;
  loud: number;
}): { avgHold: number; react: number } => ({
  avgHold: clamp(
    Math.round((cadence.calm + cadence.loud) / 2),
    MIN_HOLD,
    12_000
  ),
  react: clamp(
    (cadence.calm - cadence.loud) / (0.9 * (cadence.calm + cadence.loud)),
    0,
    1
  ),
});

// Author a set's baked look: render preset + reactivity intensity + frame
// cadence, applied as a unit whenever the set is picked (the deck DECK_LOOK
// contract, now on any owned set). Edits a local draft; save commits via
// sets.setLook, clear removes the look (the set plays with app defaults).
export const SetLookEditor = ({ look, onChange }: SetLookEditorProps) => {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<SetLook>(look ?? NEW_LOOK);

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      setDraft(look ?? NEW_LOOK);
    }
  };

  const save = () => {
    onChange(draft);
    setOpen(false);
  };
  const clear = () => {
    onChange(null);
    setOpen(false);
  };

  const { avgHold, react } = fromCadence(draft.cadence);

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="edit look"
          className={cn(
            "focus-ring font-sans inline-flex items-center gap-1.5 border border-[color:var(--hairline)]/40 px-3 py-1.5 text-[10px] uppercase tracking-[0.22em] transition-colors",
            look
              ? "text-[color:var(--paper)]/85 hover:border-[color:var(--paper)]/70"
              : "text-[color:var(--stone)] hover:border-[color:var(--paper)]/70 hover:text-[color:var(--paper)]"
          )}
        >
          <Palette className="size-3" strokeWidth={1.5} />
          {look ? `look · ${look.preset}` : "look"}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" side="bottom" className="w-72 p-4">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <span className={LABEL}>preset</span>
            <select
              value={draft.preset}
              onChange={(e) =>
                setDraft((d) => ({ ...d, preset: e.target.value }))
              }
              className="focus-ring w-full rounded-sm border border-[color:var(--hairline)]/40 bg-transparent px-2 py-1.5 font-sans text-[12px] text-[color:var(--paper)]"
              title={
                PRESET_DESCRIPTIONS[
                  draft.preset as keyof typeof PRESET_DESCRIPTIONS
                ]
              }
            >
              {PRESET_NAMES.map((p) => (
                <option key={p} value={p} className="bg-[color:var(--ink)]">
                  {p.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between">
              <span className={LABEL}>intensity</span>
              <span className="font-mono text-[10px] text-[color:var(--paper)]/70">
                {draft.intensity.toFixed(2)}
              </span>
            </div>
            <Slider
              value={[draft.intensity]}
              min={0}
              max={1}
              step={0.01}
              onValueChange={(v) => {
                const next = Array.isArray(v) ? v[0] : v;
                setDraft((d) => ({
                  ...d,
                  intensity: (next as number | undefined) ?? d.intensity,
                }));
              }}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between">
              <span className={LABEL}>average hold</span>
              <span className="font-mono text-[10px] text-[color:var(--paper)]/70">
                {secs(avgHold)}
              </span>
            </div>
            <Slider
              value={[avgHold]}
              min={MIN_HOLD}
              max={12_000}
              step={100}
              onValueChange={(v) => {
                const next = Array.isArray(v) ? v[0] : v;
                if (typeof next === "number") {
                  setDraft((d) => ({ ...d, cadence: toCadence(next, react) }));
                }
              }}
            />
            <div className="flex items-baseline justify-between">
              <span className={LABEL}>react to music</span>
              <span className="font-mono text-[10px] text-[color:var(--paper)]/70">
                {Math.round(react * 100)}%
              </span>
            </div>
            <Slider
              value={[react]}
              min={0}
              max={1}
              step={0.01}
              onValueChange={(v) => {
                const next = Array.isArray(v) ? v[0] : v;
                if (typeof next === "number") {
                  setDraft((d) => ({
                    ...d,
                    cadence: toCadence(avgHold, next),
                  }));
                }
              }}
            />
            <span className="font-mono text-[9px] text-[color:var(--stone)] leading-relaxed">
              {secs(draft.cadence.calm)} calm → {secs(draft.cadence.loud)} loud
            </span>
          </div>

          <div className="flex items-center justify-end gap-2">
            {look && (
              <button
                type="button"
                onClick={clear}
                className="focus-ring font-sans px-3 py-1.5 text-[10px] uppercase tracking-[0.22em] text-[color:var(--stone)] transition-colors hover:text-[color:var(--signal)]"
              >
                clear
              </button>
            )}
            <button
              type="button"
              onClick={save}
              className="focus-ring font-sans border border-[color:var(--paper)]/60 bg-[color:var(--paper)]/10 px-3 py-1.5 text-[10px] uppercase tracking-[0.22em] text-[color:var(--paper)] transition-colors hover:bg-[color:var(--paper)]/20"
            >
              save look
            </button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};
