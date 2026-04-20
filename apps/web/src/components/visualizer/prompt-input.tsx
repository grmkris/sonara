"use client";

import { ArrowRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ClientEvent, DreamSceneState } from "@music-visualizer/shared";
import { Input } from "@/components/ui/input";
import { useVisualizerStore } from "@/stores/visualizer-store";

interface PromptInputProps {
  send: (e: ClientEvent) => void;
}

type FieldKey = "subject" | "environment" | "mood" | "palette";

const FIELDS: {
  key: FieldKey;
  index: string;
  label: string;
  placeholder: string;
}[] = [
  { key: "subject",     index: "1", label: "SUBJECT",  placeholder: "ethereal forest spirits" },
  { key: "environment", index: "2", label: "SETTING",  placeholder: "ancient glass cathedral, underwater" },
  { key: "mood",        index: "3", label: "MOOD",     placeholder: "melancholic, otherworldly" },
  { key: "palette",     index: "4", label: "PALETTE",  placeholder: "iridescent teal and gold" },
];

export function PromptInput({ send }: PromptInputProps) {
  const scene = useVisualizerStore((s) => s.scene);
  const [draft, setDraft] = useState<Partial<Record<FieldKey, string>>>({});
  const [sweepKey, setSweepKey] = useState<Record<FieldKey, number>>({
    subject: 0,
    environment: 0,
    mood: 0,
    palette: 0,
  });
  const inputRefs = useRef<Record<FieldKey, HTMLInputElement | null>>({
    subject: null,
    environment: null,
    mood: null,
    palette: null,
  });

  // Adopt remote scene updates when the user hasn't edited (draft is undefined).
  const sceneRef = useRef(scene);
  useEffect(() => {
    sceneRef.current = scene;
  }, [scene]);

  const commit = (key: FieldKey) => {
    const value = draft[key];
    if (value === undefined) return;
    if (value === scene[key]) return;
    send({ type: "scene.patch", patch: { [key]: value } as Partial<DreamSceneState> });
    setDraft((d) => {
      const { [key]: _removed, ...rest } = d;
      return rest;
    });
    setSweepKey((s) => ({ ...s, [key]: s[key] + 1 }));
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-baseline gap-2">
        <span className="font-mincho text-[15px] text-[color:var(--paper)]">詩</span>
        <span className="font-kaku text-[9px] uppercase tracking-[0.3em] text-[color:var(--stone)]">
          scene
        </span>
      </div>

      {FIELDS.map((f) => {
        const value = draft[f.key] ?? scene[f.key];
        const sweep = sweepKey[f.key];
        return (
          <div key={f.key} className="group relative flex flex-col gap-1.5">
            <div className="flex items-baseline gap-3">
              <span className="font-plex nums text-[color:var(--stone)] text-[10px] leading-none tracking-[0.2em]">
                {f.index}
              </span>
              <span className="font-kaku text-[10px] uppercase tracking-[0.28em] text-[color:var(--stone)]">
                {f.label}
              </span>
            </div>
            <div className="relative flex items-center gap-2">
              <Input
                ref={(el) => {
                  inputRefs.current[f.key] = el;
                }}
                value={value}
                placeholder={f.placeholder}
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
                <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.5} />
              </button>
              {sweep > 0 && (
                <span
                  key={`${f.key}-${sweep}`}
                  aria-hidden
                  className="field-sweep"
                />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
