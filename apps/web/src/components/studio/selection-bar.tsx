"use client";

import type { FrameSetSummary } from "@sonara/shared";
import type { FrameSetId, ImageLibraryId } from "@sonara/shared/typeid";
import { ChevronUp, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useCuratedSetsPicker } from "@/hooks/use-curated-sets-picker";
import { rpcClient } from "@/lib/orpc";

// Floating action bar for studio's multi-select mode: shown bottom-center
// while frames are selected. The primary button one-clicks the selection into
// the LAST-USED target set (remembered in localStorage so the multi-recording
// flow — hop recordings, same target — costs one click per batch); the
// chevron opens the curated-sets picker; "new set from selection" cuts a
// fresh set seeded with exactly the selected frames.

const LAST_TARGET_KEY = "sonara.lastTargetSet";

interface TargetSet {
  id: string;
  name: string;
}

const readLastTarget = (): TargetSet | null => {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(LAST_TARGET_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<TargetSet>;
    if (typeof parsed.id === "string" && typeof parsed.name === "string") {
      return { id: parsed.id, name: parsed.name };
    }
    return null;
  } catch {
    return null;
  }
};

const writeLastTarget = (target: TargetSet): void => {
  try {
    window.localStorage.setItem(LAST_TARGET_KEY, JSON.stringify(target));
  } catch {
    // Private mode etc. — the memory is a convenience, not a requirement.
  }
};

const barButtonClass =
  "focus-ring font-sans inline-flex items-center gap-1.5 border border-[color:var(--hairline)]/40 px-3 py-1.5 text-[10px] uppercase tracking-[0.22em] text-[color:var(--paper)]/85 transition-colors hover:border-[color:var(--paper)]/70 hover:text-[color:var(--paper)]";

// Self-clearing inline name input (Enter submits, Escape/blur cancels).
const InlineNamePrompt = ({
  ariaLabel,
  onCancel,
  onSubmit,
}: {
  ariaLabel: string;
  onCancel: () => void;
  onSubmit: (name: string) => void;
}) => {
  const [draft, setDraft] = useState("");
  const submit = () => {
    const name = draft.trim();
    if (name.length > 0) {
      onSubmit(name);
    } else {
      onCancel();
    }
  };
  return (
    <input
      type="text"
      value={draft}
      autoFocus
      aria-label={ariaLabel}
      maxLength={120}
      placeholder="set name…"
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          submit();
        } else if (e.key === "Escape") {
          onCancel();
        }
      }}
      onBlur={onCancel}
      className="focus-ring w-40 border-b border-[color:var(--hairline)]/40 bg-transparent px-1 py-1 font-sans text-[12px] text-[color:var(--paper)] placeholder:text-[color:var(--stone)]/60"
    />
  );
};

// The chevron popover: curated sets list + inline "new set". Same shape as
// the inspector's add-to-set popover (shared data via useCuratedSetsPicker).
const SetPickerContent = ({
  loading,
  onCreate,
  onPick,
  sets,
}: {
  loading: boolean;
  onCreate: (name: string) => void;
  onPick: (set: FrameSetSummary) => void;
  sets: FrameSetSummary[];
}) => {
  const [creating, setCreating] = useState(false);
  return (
    <>
      <div className="border-b border-[color:var(--hairline)]/30 px-3 py-2 font-mono text-[9px] uppercase tracking-[0.26em] text-[color:var(--stone)]">
        add selection to set
      </div>
      {loading ? (
        <div className="px-3 py-4 font-sans text-[10px] uppercase tracking-[0.22em] text-[color:var(--stone)]">
          loading…
        </div>
      ) : (
        <ul className="max-h-[240px] overflow-y-auto">
          {sets.length === 0 ? (
            <li className="px-3 py-3 font-sans text-[11px] text-[color:var(--stone)]">
              No sets yet — make one below.
            </li>
          ) : (
            sets.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => onPick(s)}
                  className="focus-ring flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition-colors hover:bg-[color:var(--paper)]/10"
                >
                  <span className="truncate font-sans text-[12px] text-[color:var(--paper)]/90">
                    {s.name}
                  </span>
                  <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.16em] text-[color:var(--stone)]">
                    {s.frameCount}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
      <div className="border-t border-[color:var(--hairline)]/30 p-2">
        {creating ? (
          <InlineNamePrompt
            ariaLabel="new set name"
            onCancel={() => setCreating(false)}
            onSubmit={(name) => {
              setCreating(false);
              onCreate(name);
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="focus-ring flex w-full items-center gap-1.5 px-1 py-1 font-sans text-[10px] uppercase tracking-[0.22em] text-[color:var(--stone)] transition-colors hover:text-[color:var(--paper)]"
          >
            <Plus className="size-3" strokeWidth={1.5} />
            new set
          </button>
        )}
      </div>
    </>
  );
};

interface SelectionBarProps {
  selectedFrameIds: string[];
  onClear: () => void;
  // Fired after a successful add — the page clears the selection (keeping
  // select mode) and refreshes the open set if it was the target.
  onAdded: (target: TargetSet) => void;
  // Fired after "new set from selection" — the page refreshes the sidebar and
  // navigates to the new set.
  onCreatedFromSelection: (set: FrameSetSummary) => void;
}

export const SelectionBar = ({
  selectedFrameIds,
  onClear,
  onAdded,
  onCreatedFromSelection,
}: SelectionBarProps) => {
  const { createSet, loading, refresh, sets } = useCuratedSetsPicker();
  const [lastTarget, setLastTarget] = useState<TargetSet | null>(readLastTarget);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [namingFromSelection, setNamingFromSelection] = useState(false);

  // Fetch once on mount so the remembered target can be verified against the
  // live list (it may have been deleted since).
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const count = selectedFrameIds.length;
  const verifiedTarget =
    lastTarget && sets.some((s) => s.id === lastTarget.id) ? lastTarget : null;

  const addTo = async (target: TargetSet) => {
    setPickerOpen(false);
    try {
      const { added } = await rpcClient.sets.addFrames({
        frameIds: selectedFrameIds as ImageLibraryId[],
        setId: target.id as FrameSetId,
      });
      toast(`${added} frame${added === 1 ? "" : "s"} → “${target.name}”`, {
        duration: 1800,
      });
      writeLastTarget(target);
      setLastTarget(target);
      onAdded(target);
    } catch {
      toast.error("couldn't add to set");
    }
  };

  const onCreateInPicker = async (name: string) => {
    setPickerOpen(false);
    try {
      const created = await createSet(name);
      await addTo({ id: created.id, name: created.name });
    } catch {
      toast.error("couldn't create set");
    }
  };

  const onNewSetFromSelection = async (name: string) => {
    setNamingFromSelection(false);
    try {
      const { set } = await rpcClient.sets.create({
        frameIds: selectedFrameIds as ImageLibraryId[],
        name,
      });
      toast(`created “${set.name}”`, { duration: 1600 });
      onCreatedFromSelection(set);
    } catch {
      toast.error("couldn't create set");
    }
  };

  return (
    <div className="fixed bottom-6 left-1/2 z-40 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-3 rounded-sm border border-[color:var(--hairline)]/40 bg-[color:var(--ink)]/85 px-4 py-2.5 backdrop-blur-md">
      <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[color:var(--paper)]/90">
        {count} selected
      </span>
      <span className="h-4 w-px bg-[color:var(--hairline)]/40" aria-hidden />

      <div className="flex items-center">
        <button
          type="button"
          onClick={() => {
            if (verifiedTarget) {
              void addTo(verifiedTarget);
            } else {
              setPickerOpen(true);
              void refresh();
            }
          }}
          className={`${barButtonClass} border-r-0`}
        >
          {verifiedTarget ? (
            <>
              add to{" "}
              <span className="max-w-[160px] truncate normal-case">
                {verifiedTarget.name}
              </span>
            </>
          ) : (
            "add to set"
          )}
        </button>
        <Popover
          open={pickerOpen}
          onOpenChange={(next) => {
            setPickerOpen(next);
            if (next) {
              void refresh();
            }
          }}
        >
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="choose a set"
              className={`${barButtonClass} px-1.5`}
            >
              <ChevronUp className="size-3" strokeWidth={1.5} />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="center"
            side="top"
            className="w-64 rounded-sm border-[color:var(--hairline)]/40 bg-[color:var(--ink)]/95 p-0 text-[color:var(--paper)] backdrop-blur-md"
          >
            <SetPickerContent
              loading={loading}
              onCreate={(name) => void onCreateInPicker(name)}
              onPick={(s) => void addTo({ id: s.id, name: s.name })}
              sets={sets}
            />
          </PopoverContent>
        </Popover>
      </div>

      {namingFromSelection ? (
        <InlineNamePrompt
          ariaLabel="new set from selection name"
          onCancel={() => setNamingFromSelection(false)}
          onSubmit={(name) => void onNewSetFromSelection(name)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setNamingFromSelection(true)}
          className={barButtonClass}
        >
          <Plus className="size-3" strokeWidth={1.5} />
          new set from selection
        </button>
      )}

      <button
        type="button"
        onClick={onClear}
        className="focus-ring font-sans px-1 py-1.5 text-[10px] uppercase tracking-[0.22em] text-[color:var(--stone)] transition-colors hover:text-[color:var(--paper)]"
      >
        clear
      </button>
    </div>
  );
};
