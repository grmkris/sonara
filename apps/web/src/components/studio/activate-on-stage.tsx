"use client";

import type { FrameSetId } from "@sonara/shared/typeid";
import { Radio } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useLiveStages } from "@/hooks/use-live-stages";
import { rpcClient } from "@/lib/orpc";

// "Activate on <stage>" — push this set onto a LIVE projector from /studio.
// Follows the same 0/1/N rule as /control: hidden when nothing is live (no
// dead buttons; LiveNowCard carries awareness), a direct button for the one
// live stage, a picker when several are. The server relays a `source.set`
// event; the screen starts playback exactly like a local pick and confirms
// via source.report.

const BUTTON_CLASSES =
  "focus-ring font-sans inline-flex items-center gap-1.5 border border-[color:var(--hairline)]/40 px-3 py-1.5 text-[10px] uppercase tracking-[0.22em] text-[color:var(--paper)]/85 transition-colors hover:border-[color:var(--paper)]/70 hover:text-[color:var(--paper)]";

export const ActivateOnStage = ({ setId }: { setId: FrameSetId }) => {
  const liveStages = useLiveStages();
  const [open, setOpen] = useState(false);

  const activate = async (stageId: string, name: string): Promise<void> => {
    setOpen(false);
    try {
      await rpcClient.control.setSource({
        source: { kind: "set", label: null, setId },
        stageId,
      });
      toast.success(`now showing on ${name}`);
    } catch {
      toast.error("couldn't activate — is the stage still live?");
    }
  };

  if (liveStages.length === 0) {
    return null;
  }

  if (liveStages.length === 1) {
    const [only] = liveStages;
    if (!only) {
      return null;
    }
    return (
      <button
        type="button"
        onClick={() => void activate(only.stageId, only.name)}
        className={BUTTON_CLASSES}
      >
        <Radio className="size-3" strokeWidth={1.5} />
        activate on {only.name}
      </button>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={BUTTON_CLASSES}>
          <Radio className="size-3" strokeWidth={1.5} />
          activate on…
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="bottom"
        className="w-56 rounded-sm border-[color:var(--hairline)]/40 bg-[color:var(--ink)]/95 p-1 text-[color:var(--paper)] backdrop-blur-md"
      >
        <ul className="flex flex-col">
          {liveStages.map((s) => (
            <li key={s.stageId}>
              <button
                type="button"
                onClick={() => void activate(s.stageId, s.name)}
                className="focus-ring flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left transition-colors hover:bg-[color:var(--paper)]/10"
              >
                <span className="truncate font-sans text-[12px] text-[color:var(--paper)]/90">
                  {s.name}
                </span>
                <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.16em] text-[color:var(--stone)]">
                  {s.code}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
};
