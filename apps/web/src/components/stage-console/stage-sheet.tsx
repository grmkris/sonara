"use client";

import { Radio } from "lucide-react";

import { StageHostPanel } from "@/components/stage/stage-host-panel";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import type { ControlTarget } from "@/lib/control-actions";
import { cn } from "@/lib/utils";
import { useVisualizerStore } from "@/stores/visualizer";

// The crowd-stage controls, demoted from a resident rail section to a
// one-tap sheet off the transport card. The trigger carries the live state
// (room code + signal dot) so the operator never loses sight of an open
// stage; server truth arrives via the stage.status push (store.stageRoom),
// which also re-syncs the panel when the sheet remounts.
export const StageSheet = ({ target }: { target: ControlTarget | null }) => {
  const stageRoom = useVisualizerStore((s) => s.stageRoom);

  if (!target) {
    return null;
  }

  return (
    <Sheet>
      <SheetTrigger asChild>
        <button
          type="button"
          aria-label="crowd stage controls"
          className={cn(
            "focus-ring flex items-center gap-1.5 rounded-sm border border-[color:var(--hairline)]/30 px-2 py-1.5 font-sans text-[10px] uppercase tracking-[0.18em] transition-colors hover:border-[color:var(--paper)]/60",
            stageRoom
              ? "text-[color:var(--paper)]"
              : "text-[color:var(--paper)]/85"
          )}
        >
          <Radio
            className={cn(
              "size-3",
              stageRoom
                ? "text-[color:var(--signal)]"
                : "text-[color:var(--stone)]"
            )}
            strokeWidth={1.5}
          />
          {stageRoom ? `stage · ${stageRoom}` : "stage"}
        </button>
      </SheetTrigger>
      <SheetContent
        side="right"
        className="w-[340px] overflow-y-auto border-l border-[color:var(--hairline)]/30 bg-[color:var(--ink)]/95 p-4 backdrop-blur-md"
      >
        <SheetTitle className="font-sans text-[10px] uppercase tracking-[0.26em] text-[color:var(--stone)]">
          crowd stage
        </SheetTitle>
        <div className="mt-4">
          <StageHostPanel initialRoom={stageRoom} target={target} />
        </div>
      </SheetContent>
    </Sheet>
  );
};
