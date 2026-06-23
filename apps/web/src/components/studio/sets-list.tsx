"use client";

import type { FrameSetSummary } from "@sonara/shared";
import { Plus } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";

import { LibraryRow } from "@/components/studio/library-row";
import { NewSetDropRow, SetDropRow } from "@/components/studio/set-drop-row";

interface SetsListProps {
  sets: FrameSetSummary[];
  // Built-in sets ("decks" — same entity, origin=builtin): listed in their
  // own group below the user's sets. Plain rows — immutable, so never drop
  // targets.
  builtins: FrameSetSummary[];
  loading: boolean;
  bootstrapped: boolean;
  selectedSetId: string | null;
  onSelect: (setId: string) => void;
  onCreate: (name: string) => void;
  // Size of the in-flight frame drag (0 = none) — rows light up as targets.
  dragCount?: number;
}

const BuiltinRow = ({
  set,
  selected,
  onSelect,
}: {
  set: FrameSetSummary;
  selected: boolean;
  onSelect: (setId: string) => void;
}) => (
  <LibraryRow
    coverUrl={set.coverUrl}
    title={set.name}
    meta={`${set.frameCount} frames${
      set.look ? ` · ${set.look.preset.replaceAll("_", " ")}` : ""
    }${set.visibility === "unlisted" ? " · unlisted" : ""}`}
    selected={selected}
    onClick={() => onSelect(set.id)}
  />
);

// Left-rail list of curated sets. Each card shows the cover thumb, name, and
// frame count. A "new set" affordance reveals an inline input. Click selects.
export const SetsList = ({
  sets,
  builtins,
  loading,
  bootstrapped,
  selectedSetId,
  onSelect,
  onCreate,
  dragCount = 0,
}: SetsListProps) => {
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState("");

  const submitCreate = () => {
    const name = draftName.trim();
    if (name.length === 0) {
      return;
    }
    onCreate(name);
    setDraftName("");
    setCreating(false);
  };

  let body: ReactNode;
  if (!bootstrapped || loading) {
    body = (
      <div className="px-4 py-6 font-sans text-[10px] uppercase tracking-[0.22em] text-[color:var(--stone)]">
        loading sets…
      </div>
    );
  } else if (sets.length === 0) {
    body = (
      <p className="px-4 py-6 font-sans text-[11px] leading-relaxed text-[color:var(--stone)]">
        No sets yet. Make one, then add frames from your recordings.
      </p>
    );
  } else {
    body = (
      <ul className="flex flex-col">
        {dragCount > 0 && (
          <li>
            <NewSetDropRow dragCount={dragCount} />
          </li>
        )}
        {sets.map((r) => (
          <li key={r.id}>
            <SetDropRow
              set={r}
              selected={r.id === selectedSetId}
              onSelect={onSelect}
              dragCount={dragCount}
            />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <nav aria-label="sets" className="flex flex-col">
      <div className="flex items-center justify-between px-4 pt-5 pb-2">
        <h3 className="font-sans text-[9px] uppercase tracking-[0.26em] text-[color:var(--stone)]">
          sets
        </h3>
        <button
          type="button"
          onClick={() => setCreating((c) => !c)}
          aria-label="new set"
          className="focus-ring flex items-center gap-1 font-sans text-[9px] uppercase tracking-[0.22em] text-[color:var(--stone)] transition-colors hover:text-[color:var(--paper)]"
        >
          <Plus className="size-3" strokeWidth={1.5} />
          new
        </button>
      </div>

      {creating && (
        <div className="px-4 pb-3">
          <input
            type="text"
            value={draftName}
            autoFocus
            aria-label="new set name"
            placeholder="set name…"
            maxLength={120}
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                submitCreate();
              } else if (e.key === "Escape") {
                setCreating(false);
                setDraftName("");
              }
            }}
            onBlur={submitCreate}
            className="focus-ring w-full border-b border-[color:var(--hairline)]/40 bg-transparent pb-1 font-sans text-[12px] text-[color:var(--paper)] placeholder:text-[color:var(--stone)]/60"
          />
        </div>
      )}

      {body}

      {builtins.length > 0 && (
        <>
          <div className="px-4 pt-6 pb-2">
            <h3 className="font-sans text-[9px] uppercase tracking-[0.26em] text-[color:var(--stone)]">
              built-ins
            </h3>
          </div>
          <ul className="flex flex-col">
            {builtins.map((b) => (
              <li key={b.id}>
                <BuiltinRow
                  set={b}
                  selected={b.id === selectedSetId}
                  onSelect={onSelect}
                />
              </li>
            ))}
          </ul>
        </>
      )}
    </nav>
  );
};
