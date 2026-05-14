"use client";

import { ArrowRight, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { SonaraSceneState } from "@sonara/shared";
import type { SessionSend } from "@/lib/session-actions";
import { Input } from "@/components/ui/input";
import { useVisualizerStore } from "@/stores/visualizer";
import { cn } from "@/lib/utils";

interface PromptInputProps {
  send: SessionSend;
}

type FieldKey = "subject" | "environment" | "mood" | "palette";

// Per-field suggestion pools. Surfaced as both the static placeholder text
// (first entry) and as clickable chips beneath each input via `FieldChips`.
const FIELD_SUGGESTIONS: Record<FieldKey, readonly string[]> = {
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
  // Which field's chip pool is expanded. At most one row is open at a time so
  // the panel stays quiet by default; opens on focus or chevron-tap.
  const [expandedKey, setExpandedKey] = useState<FieldKey | null>(null);
  const inputRefs = useRef<Record<FieldKey, HTMLInputElement | null>>({
    subject: null,
    environment: null,
    mood: null,
    palette: null,
  });
  // Tracks the value most recently sent over WS for each field, used to
  // suppress duplicate sends (e.g. chip-click then immediate input blur).
  // Cleared by the reconcile effect below once the server echoes the value
  // back into `scene[key]`.
  const lastSentRef = useRef<Partial<Record<FieldKey, string>>>({});

  // Drop the in-flight indicator the moment the server settles. "running" is
  // the only state where we want the chip visible; idle / cancelled / error
  // all imply the wait is over.
  useEffect(() => {
    if (status !== "running") setLastCommittedKey(null);
  }, [status]);

  // When the server echoes a committed value back into `scene[key]`, clear
  // the matching optimistic draft + `lastSentRef` so future identical sends
  // aren't suppressed and the input reads from `scene[key]` again.
  useEffect(() => {
    setDraft((d) => {
      let next = d;
      let changed = false;
      for (const f of FIELDS) {
        if (next[f.key] !== undefined && next[f.key] === scene[f.key]) {
          if (lastSentRef.current[f.key] === scene[f.key]) {
            lastSentRef.current[f.key] = undefined;
          }
          const { [f.key]: _drop, ...rest } = next;
          next = rest;
          changed = true;
        }
      }
      return changed ? next : d;
    });
  }, [scene]);

  const commitValue = (key: FieldKey, value: string) => {
    if (value === scene[key]) return;
    if (lastSentRef.current[key] === value) return;
    lastSentRef.current[key] = value;
    send({
      type: "scene.patch",
      patch: { [key]: value } as Partial<SonaraSceneState>,
    });
    setDraft((d) => ({ ...d, [key]: value }));
    setSweepKey((s) => ({ ...s, [key]: s[key] + 1 }));
    setLastCommittedKey(key);
  };

  const commit = (key: FieldKey) => {
    const v = draft[key];
    if (v === undefined) return;
    commitValue(key, v);
  };

  return (
    <div className="flex flex-col gap-5">
      {FIELDS.map((f) => {
        const value = draft[f.key] ?? scene[f.key];
        const sweep = sweepKey[f.key];
        const pool = FIELD_SUGGESTIONS[f.key];
        const placeholder = pool[0];
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
                onFocus={() => setExpandedKey(f.key)}
                onBlur={() => commit(f.key)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commit(f.key);
                    inputRefs.current[f.key]?.blur();
                    setExpandedKey(null);
                  } else if (e.key === "Escape") {
                    setExpandedKey(null);
                    inputRefs.current[f.key]?.blur();
                  }
                }}
              />
              <button
                type="button"
                aria-label={
                  expandedKey === f.key
                    ? `Hide ${f.label} suggestions`
                    : `Show ${f.label} suggestions`
                }
                aria-expanded={expandedKey === f.key}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() =>
                  setExpandedKey((cur) => (cur === f.key ? null : f.key))
                }
                className={cn(
                  "shrink-0 text-[color:var(--stone)] transition-all hover:text-[color:var(--paper)]",
                  expandedKey === f.key && "text-[color:var(--paper)] rotate-180",
                )}
              >
                <ChevronDown className="size-3.5" strokeWidth={1.5} />
              </button>
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
            {expandedKey === f.key && (
              <div
                className="chips-reveal flex flex-wrap gap-1.5"
                onMouseDown={(e) => e.preventDefault()}
              >
                {pool.map((chip) => {
                  const isActive = chip === value;
                  return (
                    <button
                      key={chip}
                      type="button"
                      title={chip}
                      onClick={() => {
                        commitValue(f.key, chip);
                        setExpandedKey(null);
                      }}
                      className={cn(
                        "font-sans text-[10px] uppercase tracking-[0.14em] transition-colors border-b px-1.5 py-0.5",
                        isActive
                          ? "text-[color:var(--paper)] border-[color:var(--paper)]"
                          : "text-[color:var(--stone)] border-[color:var(--hairline)]/30 hover:text-[color:var(--paper)] hover:border-[color:var(--paper)]/60",
                      )}
                    >
                      {chip}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
