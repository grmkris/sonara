"use client";

import type { FrameSetSummary } from "@sonara/shared";
import { Plus } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";

import { cn } from "@/lib/utils";

interface SetsListProps {
  sets: FrameSetSummary[];
  loading: boolean;
  bootstrapped: boolean;
  selectedSetId: string | null;
  onSelect: (setId: string) => void;
  onCreate: (name: string) => void;
}

// Left-rail list of curated sets. Each card shows the cover thumb, name, and
// frame count. A "new set" affordance reveals an inline input. Click selects.
export const SetsList = ({
  sets,
  loading,
  bootstrapped,
  selectedSetId,
  onSelect,
  onCreate,
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
        {sets.map((r) => {
          const selected = r.id === selectedSetId;
          return (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => onSelect(r.id)}
                aria-current={selected ? "true" : undefined}
                className={cn(
                  "focus-ring flex w-full items-center gap-3 border-b border-[color:var(--hairline)]/20 px-4 py-2 text-left transition-colors",
                  selected
                    ? "bg-[color:var(--paper)]/10"
                    : "hover:bg-[color:var(--paper)]/5"
                )}
              >
                {r.coverUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={r.coverUrl}
                    alt=""
                    loading="lazy"
                    className="size-10 shrink-0 rounded-sm border border-[color:var(--hairline)]/40 object-cover"
                  />
                ) : (
                  <div className="size-10 shrink-0 rounded-sm border border-[color:var(--hairline)]/40 bg-[color:var(--ink)]/40" />
                )}
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span
                    className={cn(
                      "truncate font-sans text-[11px] uppercase tracking-[0.16em]",
                      selected
                        ? "text-[color:var(--paper)]"
                        : "text-[color:var(--paper)]/80"
                    )}
                  >
                    {r.name}
                  </span>
                  <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-[color:var(--stone)]">
                    {r.frameCount} frame{r.frameCount === 1 ? "" : "s"}
                  </span>
                </div>
              </button>
            </li>
          );
        })}
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
    </nav>
  );
};
