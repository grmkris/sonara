"use client";

import { ArrowRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { DreamSceneState } from "@music-visualizer/shared";
import type { SessionSend } from "@/lib/session-actions";
import { Input } from "@/components/ui/input";
import { useVisualizerStore } from "@/stores/visualizer-store";

interface PromptInputProps {
  send: SessionSend;
}

type FieldKey = "subject" | "environment" | "mood" | "palette";

// Per-field example pools. When the field is empty, the placeholder rotates
// through these every ~8 s — educational for both typing and voice users.
const PLACEHOLDERS: Record<FieldKey, readonly string[]> = {
  subject: [
    "a heron over grey water",
    "two lanterns drifting above a pond",
    "a figure walking into tall wheat",
    "a cat asleep in a library",
    "a crow perched on a broken mast",
    "a single violinist on a stage",
    "a dragon coiled in a sky",
    "a child holding a sparkler",
  ],
  environment: [
    "ancient cathedral interior, afternoon",
    "winter sea, overcast sky",
    "empty rooftop at 3am",
    "zen courtyard after rain",
    "moonlit bedroom, drapes moving",
    "overgrown marble ruins at dusk",
    "neon alley, puddles reflecting signs",
    "endless salt flats at golden hour",
  ],
  mood: [
    "melancholic, otherworldly",
    "hushed, reverent",
    "fierce, alone",
    "tender, hypnagogic",
    "euphoric, electric",
    "centered, still",
    "haunted, beautiful",
    "intimate, quiet",
  ],
  palette: [
    "iridescent teal and gold",
    "rust and bone",
    "moss green and dappled gold",
    "slate, foam, iron",
    "indigo and silver",
    "neon amber and deep blue",
    "sapphire, garnet, cold gold",
    "wet stone and moss",
  ],
};

const PLACEHOLDER_INTERVAL_MS = 8000;

const FIELDS: {
  key: FieldKey;
  index: string;
  label: string;
}[] = [
  { key: "subject",     index: "1", label: "SUBJECT"  },
  { key: "environment", index: "2", label: "SETTING"  },
  { key: "mood",        index: "3", label: "MOOD"     },
  { key: "palette",     index: "4", label: "PALETTE"  },
];

// One random seed per field, set post-mount so each session opens with a
// different example — avoids an identical first-load every time. SSR + first
// client-hydrate render use `0` (stable, matching) so React doesn't flag a
// hydration mismatch on the `placeholder` attribute.
const ZERO_SEEDS: Record<FieldKey, number> = {
  subject: 0,
  environment: 0,
  mood: 0,
  palette: 0,
};
function randomSeeds(): Record<FieldKey, number> {
  return {
    subject: Math.floor(Math.random() * PLACEHOLDERS.subject.length),
    environment: Math.floor(Math.random() * PLACEHOLDERS.environment.length),
    mood: Math.floor(Math.random() * PLACEHOLDERS.mood.length),
    palette: Math.floor(Math.random() * PLACEHOLDERS.palette.length),
  };
}

export function PromptInput({ send }: PromptInputProps) {
  const scene = useVisualizerStore((s) => s.scene);
  const status = useVisualizerStore((s) => s.status);
  const [draft, setDraft] = useState<Partial<Record<FieldKey, string>>>({});
  const [sweepKey, setSweepKey] = useState<Record<FieldKey, number>>({
    subject: 0,
    environment: 0,
    mood: 0,
    palette: 0,
  });
  // Most-recently-committed field. Drives the "⟲ regenerating…" chip beneath
  // that field while a job is in flight, so the user sees their edit was
  // received even though the fal generation takes a few seconds. Cleared
  // when status returns to idle.
  const [lastCommittedKey, setLastCommittedKey] = useState<FieldKey | null>(null);
  const inputRefs = useRef<Record<FieldKey, HTMLInputElement | null>>({
    subject: null,
    environment: null,
    mood: null,
    palette: null,
  });

  const [seeds, setSeeds] = useState<Record<FieldKey, number>>(ZERO_SEEDS);
  useEffect(() => setSeeds(randomSeeds()), []);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), PLACEHOLDER_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  // Drop the in-flight indicator the moment the server settles. "running" is
  // the only state where we want the chip visible; idle / cancelled / error
  // all imply the wait is over.
  useEffect(() => {
    if (status !== "running") setLastCommittedKey(null);
  }, [status]);

  const commit = (key: FieldKey) => {
    const value = draft[key];
    if (value === undefined) return;
    if (value === scene[key]) return;
    send({
      type: "scene.patch",
      patch: { [key]: value } as Partial<DreamSceneState>,
    });
    setDraft((d) => {
      const { [key]: _removed, ...rest } = d;
      return rest;
    });
    setSweepKey((s) => ({ ...s, [key]: s[key] + 1 }));
    setLastCommittedKey(key);
  };

  return (
    <div className="flex flex-col gap-5">
      {FIELDS.map((f) => {
        const value = draft[f.key] ?? scene[f.key];
        const sweep = sweepKey[f.key];
        const pool = PLACEHOLDERS[f.key];
        const placeholder = pool[(seeds[f.key] + tick) % pool.length] ?? pool[0];
        return (
          <div key={f.key} className="group relative flex flex-col gap-1.5">
            <div className="flex items-baseline gap-3">
              <span className="font-mono nums text-[10px] leading-none tracking-[0.2em] text-[color:var(--stone)]">
                {f.index}
              </span>
              <span className="font-sans text-[10px] uppercase tracking-[0.28em] text-[color:var(--stone)]">
                {f.label}
              </span>
            </div>
            <div className="relative flex items-center gap-2">
              <Input
                ref={(el) => {
                  inputRefs.current[f.key] = el;
                }}
                value={value}
                placeholder={placeholder}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, [f.key]: e.target.value }))
                }
                onBlur={() => commit(f.key)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commit(f.key);
                    inputRefs.current[f.key]?.blur();
                  }
                }}
              />
              <button
                type="button"
                aria-label={`Commit ${f.label}`}
                className="shrink-0 text-[color:var(--stone)] transition-colors hover:text-[color:var(--paper)]"
                onClick={() => {
                  commit(f.key);
                  inputRefs.current[f.key]?.focus();
                }}
              >
                <ArrowRight className="size-3.5" strokeWidth={1.5} />
              </button>
              {sweep > 0 && (
                <span
                  key={`${f.key}-${sweep}`}
                  aria-hidden
                  className="field-sweep"
                />
              )}
            </div>
            {lastCommittedKey === f.key && status === "running" && (
              <div
                aria-live="polite"
                className="font-sans text-[10px] italic tracking-[0.04em] text-[color:var(--stone)]/80"
              >
                ⟲ regenerating…
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
