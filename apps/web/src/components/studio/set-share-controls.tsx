"use client";

import type { FrameSetVisibility } from "@sonara/shared";
import { Check, ExternalLink, Link2, Share2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const VISIBILITIES: FrameSetVisibility[] = ["private", "unlisted", "public"];

// Plain-language gloss for each visibility level (shown under its label).
const VISIBILITY_HINT: Record<FrameSetVisibility, string> = {
  private: "only you",
  public: "anyone can find it",
  unlisted: "anyone with the link",
};

// Per-set share affordance for the recording / set editor headers. Collapses
// the old three-control cluster (visibility select + copy link + watch link)
// into ONE "share" button → popover: pick who can open it, copy the link, or
// open the full-screen player. The /set/<setId> permalink shape is final.
export const SetShareControls = ({
  setId,
  visibility,
  onVisibilityChange,
}: {
  setId: string;
  visibility: FrameSetVisibility;
  onVisibilityChange: (visibility: FrameSetVisibility) => void;
}) => {
  const [open, setOpen] = useState(false);

  const onCopyLink = () => {
    void (async () => {
      try {
        await navigator.clipboard.writeText(
          `${window.location.origin}/set/${setId}`
        );
        toast("link copied", { duration: 1600 });
      } catch {
        toast.error("copy failed", {
          description: "clipboard permission denied",
          duration: 2400,
        });
      }
    })();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="default"
          size="sm"
          className="font-sans text-[10px] uppercase tracking-[0.22em]"
        >
          <Share2 className="size-3" strokeWidth={1.5} />
          share
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" side="bottom" className="w-72 p-0">
        <div className="border-b border-[color:var(--hairline)]/30 px-3 py-2.5 font-mono text-[9px] uppercase tracking-[0.26em] text-[color:var(--stone)]">
          who can open this
        </div>
        <ul className="flex flex-col p-1">
          {VISIBILITIES.map((v) => {
            const active = visibility === v;
            return (
              <li key={v}>
                <button
                  type="button"
                  onClick={() => onVisibilityChange(v)}
                  aria-current={active ? "true" : undefined}
                  className={cn(
                    "focus-ring flex w-full items-center justify-between gap-3 rounded-[2px] px-2.5 py-2 text-left transition-colors",
                    active
                      ? "bg-[color:var(--paper)]/10"
                      : "hover:bg-[color:var(--paper)]/5"
                  )}
                >
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span
                      className={cn(
                        "font-sans text-[11px] uppercase tracking-[0.18em]",
                        active
                          ? "text-[color:var(--paper)]"
                          : "text-[color:var(--paper)]/80"
                      )}
                    >
                      {v}
                    </span>
                    <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-[color:var(--stone)]">
                      {VISIBILITY_HINT[v]}
                    </span>
                  </span>
                  <Check
                    className={cn(
                      "size-3.5 shrink-0 text-[color:var(--paper)] transition-opacity",
                      active ? "opacity-100" : "opacity-0"
                    )}
                    strokeWidth={1.5}
                  />
                </button>
              </li>
            );
          })}
        </ul>
        <div className="flex flex-col border-t border-[color:var(--hairline)]/30 p-1">
          <button
            type="button"
            onClick={onCopyLink}
            className="focus-ring flex w-full items-center gap-2.5 rounded-[2px] px-2.5 py-2 font-sans text-[10px] uppercase tracking-[0.22em] text-[color:var(--stone)] transition-colors hover:bg-[color:var(--paper)]/5 hover:text-[color:var(--paper)]"
          >
            <Link2 className="size-3.5 shrink-0" strokeWidth={1.5} />
            copy link
          </button>
          {/* See it as your audience would — the permalink in a new tab. */}
          <Link
            href={`/set/${setId}`}
            target="_blank"
            rel="noopener"
            className="focus-ring flex w-full items-center gap-2.5 rounded-[2px] px-2.5 py-2 font-sans text-[10px] uppercase tracking-[0.22em] text-[color:var(--stone)] transition-colors hover:bg-[color:var(--paper)]/5 hover:text-[color:var(--paper)]"
          >
            <ExternalLink className="size-3.5 shrink-0" strokeWidth={1.5} />
            open player
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
};
