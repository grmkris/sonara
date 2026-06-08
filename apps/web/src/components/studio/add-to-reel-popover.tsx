"use client";

import type { LibraryFrame, ReelSummary } from "@sonara/shared";
import type { ReelId } from "@sonara/shared/typeid";
import { Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { rpcClient } from "@/lib/orpc";

// Inspector action: add this frame to a curated reel. Opening fetches the
// user's reels; picking one (or creating a new one inline) adds the frame and
// toasts. Works from either studio tab — any frame can go into any reel.
export const AddToReelPopover = ({ frame }: { frame: LibraryFrame }) => {
  const [open, setOpen] = useState(false);
  const [reels, setReels] = useState<ReelSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState("");

  const loadReels = async () => {
    setLoading(true);
    try {
      const { reels: r } = await rpcClient.reels.list({});
      setReels(r);
    } catch {
      toast.error("couldn't load reels");
    } finally {
      setLoading(false);
    }
  };

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      void loadReels();
    } else {
      setCreating(false);
      setDraft("");
    }
  };

  const addToReel = async (reelId: string, name: string) => {
    setOpen(false);
    try {
      await rpcClient.reels.addFrame({
        frameId: frame.id,
        reelId: reelId as ReelId,
      });
      toast(`added to “${name}”`, { duration: 1600 });
    } catch {
      toast.error("couldn't add to reel");
    }
  };

  const createAndAdd = async () => {
    const name = draft.trim();
    if (name.length === 0) {
      return;
    }
    setOpen(false);
    try {
      const { reel } = await rpcClient.reels.create({ name });
      await rpcClient.reels.addFrame({ frameId: frame.id, reelId: reel.id });
      toast(`added to “${reel.name}”`, { duration: 1600 });
    } catch {
      toast.error("couldn't create reel");
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
          add to reel
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="top"
        className="w-64 rounded-sm border-[color:var(--hairline)]/40 bg-[color:var(--ink)]/95 p-0 text-[color:var(--paper)] backdrop-blur-md"
      >
        <div className="border-b border-[color:var(--hairline)]/30 px-3 py-2 font-mono text-[9px] uppercase tracking-[0.26em] text-[color:var(--stone)]">
          add to reel
        </div>

        {loading ? (
          <div className="px-3 py-4 font-sans text-[10px] uppercase tracking-[0.22em] text-[color:var(--stone)]">
            loading…
          </div>
        ) : (
          <ul className="max-h-[240px] overflow-y-auto">
            {reels.length === 0 ? (
              <li className="px-3 py-3 font-sans text-[11px] text-[color:var(--stone)]">
                No reels yet — make one below.
              </li>
            ) : (
              reels.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => void addToReel(r.id, r.name)}
                    className="focus-ring flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition-colors hover:bg-[color:var(--paper)]/10"
                  >
                    <span className="truncate font-sans text-[12px] text-[color:var(--paper)]/90">
                      {r.name}
                    </span>
                    <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.16em] text-[color:var(--stone)]">
                      {r.frameCount}
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
              aria-label="new reel name"
              maxLength={120}
              placeholder="reel name…"
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
              new reel
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};
