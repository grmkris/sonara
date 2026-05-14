"use client";

import { useEffect, useRef, useState } from "react";
import type { SonaraSceneState } from "@sonara/shared";
import type { SessionSend } from "@/lib/session-actions";
import { FieldRow } from "@/components/visualizer/controls/field-row";
import { flashCommit } from "@/lib/commit-flash";
import {
  SCENE_FIELDS,
  type SceneFieldKey,
} from "@/lib/scene-fields";
import { useVisualizerStore } from "@/stores/visualizer";

interface PromptInputProps {
  send: SessionSend;
}

export function PromptInput({ send }: PromptInputProps) {
  const scene = useVisualizerStore((s) => s.scene);
  const status = useVisualizerStore((s) => s.status);
  const [draft, setDraft] = useState<Partial<Record<SceneFieldKey, string>>>({});
  const [sweepKey, setSweepKey] = useState<Record<SceneFieldKey, number>>({
    subject: 0,
    environment: 0,
    mood: 0,
    palette: 0,
  });
  const [lastCommittedKey, setLastCommittedKey] = useState<SceneFieldKey | null>(
    null,
  );
  // Which field's popover is open. At most one is open at a time.
  const [openKey, setOpenKey] = useState<SceneFieldKey | null>(null);
  const inputRefs = useRef<Record<SceneFieldKey, HTMLInputElement | null>>({
    subject: null,
    environment: null,
    mood: null,
    palette: null,
  });
  const lastSentRef = useRef<Partial<Record<SceneFieldKey, string>>>({});

  useEffect(() => {
    if (status !== "running") setLastCommittedKey(null);
  }, [status]);

  // Reconcile drafts with the server-echoed scene state. As soon as we see
  // any value for a field after our send (even one the server normalised
  // from our draft), clear the optimistic draft so the input reads from
  // `scene[key]` again. The previous version compared strict equality,
  // which left the draft stuck whenever the server normalised the input.
  useEffect(() => {
    setDraft((d) => {
      let next = d;
      let changed = false;
      for (const f of SCENE_FIELDS) {
        const sent = lastSentRef.current[f.key];
        if (
          sent !== undefined &&
          scene[f.key] !== undefined &&
          next[f.key] !== undefined
        ) {
          const { [f.key]: _drop, ...rest } = next;
          next = rest;
          lastSentRef.current[f.key] = undefined;
          changed = true;
        }
      }
      return changed ? next : d;
    });
  }, [scene]);

  const commitValue = (key: SceneFieldKey, value: string) => {
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
    flashCommit();
  };

  const commit = (key: SceneFieldKey) => {
    const v = draft[key];
    if (v === undefined) return;
    commitValue(key, v);
  };

  return (
    <div className="flex flex-col gap-5">
      {SCENE_FIELDS.map((f) => {
        const value = draft[f.key] ?? scene[f.key];
        return (
          <FieldRow
            key={f.key}
            field={f}
            value={value}
            isOpen={openKey === f.key}
            isRunning={status === "running"}
            isLastCommitted={lastCommittedKey === f.key}
            sweepKey={sweepKey[f.key]}
            inputRef={(el) => {
              inputRefs.current[f.key] = el;
            }}
            onDraftChange={(next) =>
              setDraft((d) => ({ ...d, [f.key]: next }))
            }
            onCommit={() => commit(f.key)}
            onCommitValue={(next) => {
              commitValue(f.key, next);
              setOpenKey(null);
            }}
            onOpenChange={(open) => setOpenKey(open ? f.key : null)}
            onFocusInput={() => inputRefs.current[f.key]?.focus()}
          />
        );
      })}
    </div>
  );
}
