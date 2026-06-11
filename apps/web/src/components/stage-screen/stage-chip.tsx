"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AppRouterClient } from "server/rpc";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { OwnStage } from "@/hooks/use-own-stage";
import { rpcClient } from "@/lib/orpc";
import { cn } from "@/lib/utils";

// The screen's visible stage identity — "which stage is this projector?" was
// the silent-resolver confusion; this chip answers it on-screen and makes
// switching deliberate. Rows load lazily on open; switching navigates to the
// explicit /stage/<code>/screen URL (the address bar tells the truth).
// Management (rename/create/links) lives in /studio.

type StageEntry = Awaited<
  ReturnType<AppRouterClient["control"]["stages"]>
>["stages"][number];

export const StageChip = ({ current }: { current: OwnStage | null }) => {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [stages, setStages] = useState<StageEntry[]>([]);

  if (!current) {
    return null;
  }

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      return;
    }
    void (async () => {
      try {
        const { stages: rows } = await rpcClient.control.stages();
        setStages(rows);
      } catch {
        // transient — the chip still shows the current stage
      }
    })();
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="switch stage"
          className="focus-ring pointer-events-auto flex w-fit items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-[color:var(--stone)] transition-colors hover:text-[color:var(--paper)]"
        >
          {current.name} · {current.code}
          <ChevronDown className="size-3 shrink-0" strokeWidth={1.5} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        className="w-60 rounded-sm border-[color:var(--hairline)]/40 bg-[color:var(--ink)]/95 p-1 text-[color:var(--paper)] backdrop-blur-md"
      >
        <ul className="flex flex-col">
          {stages.map((s) => (
            <li key={s.stageId}>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  if (s.stageId !== current.stageId) {
                    router.push(`/stage/${s.code}/screen`);
                  }
                }}
                className={cn(
                  "focus-ring flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left transition-colors hover:bg-[color:var(--paper)]/10",
                  s.stageId === current.stageId && "bg-[color:var(--paper)]/10"
                )}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    aria-hidden
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      s.live
                        ? "bg-[color:var(--signal)]"
                        : "bg-[color:var(--stone)]/50"
                    )}
                  />
                  <span className="truncate font-sans text-[12px] text-[color:var(--paper)]/90">
                    {s.name}
                  </span>
                </span>
                <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.16em] text-[color:var(--stone)]">
                  {s.code}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <Link
          href="/studio"
          className="focus-ring mt-1 block border-t border-[color:var(--hairline)]/30 px-2 py-1.5 font-sans text-[10px] uppercase tracking-[0.2em] text-[color:var(--stone)] transition-colors hover:text-[color:var(--paper)]"
        >
          manage stages ↗
        </Link>
      </PopoverContent>
    </Popover>
  );
};
