"use client";

import type { LibraryFrame } from "@sonara/shared";
import type { FrameSetId } from "@sonara/shared/typeid";
import { Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useCuratedSetsPicker } from "@/hooks/use-curated-sets-picker";
import { rpcClient } from "@/lib/orpc";

// Inspector action: add this frame to a curated set. Opening fetches the
// user's curated sets; picking one (or creating a new one inline) adds the
// frame and toasts. Works from either studio tab — any frame can go into any
// curated set (recordings are frozen; make a cut to edit those).
export const AddToSetPopover = ({ frame }: { frame: LibraryFrame }) => {
  const [open, setOpen] = useState(false);
  const { createSet, loading, refresh, sets } = useCuratedSetsPicker();
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState("");

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      void refresh();
    } else {
      setCreating(false);
      setDraft("");
    }
  };

  const addToSet = async (setId: string, name: string) => {
    setOpen(false);
    try {
      await rpcClient.sets.addFrame({
        frameId: frame.id,
        setId: setId as FrameSetId,
      });
      toast(`added to “${name}”`, { duration: 1600 });
    } catch {
      toast.error("couldn't add to set");
    }
  };

  const createAndAdd = async () => {
    const name = draft.trim();
    if (name.length === 0) {
      return;
    }
    setOpen(false);
    try {
      const created = await createSet(name);
      await rpcClient.sets.addFrame({ frameId: frame.id, setId: created.id });
      toast(`added to “${created.name}”`, { duration: 1600 });
    } catch {
      toast.error("couldn't create set");
    }
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="default"
          size="sm"
          className="w-full font-sans text-[10px] uppercase tracking-[0.22em]"
        >
          add to set
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" side="top" className="w-64 p-0">
        <div className="border-b border-[color:var(--hairline)]/30 px-3 py-2 font-mono text-[9px] uppercase tracking-[0.26em] text-[color:var(--stone)]">
          add to set
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
                    onClick={() => void addToSet(s.id, s.name)}
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
            <input
              type="text"
              value={draft}
              autoFocus
              aria-label="new set name"
              maxLength={120}
              placeholder="set name…"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  void createAndAdd();
                } else if (e.key === "Escape") {
                  setCreating(false);
                  setDraft("");
                }
              }}
              className="focus-ring w-full bg-transparent px-1 py-1 font-sans text-[12px] text-[color:var(--paper)] placeholder:text-[color:var(--stone)]/60"
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
      </PopoverContent>
    </Popover>
  );
};
