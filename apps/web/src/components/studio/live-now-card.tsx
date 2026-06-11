"use client";

import Link from "next/link";

import { useLiveStages } from "@/hooks/use-live-stages";

// One-line awareness strip at the top of the studio rail: while one of YOUR
// stages is live, link straight to its console (one row per live stage —
// there is no resolver page; this IS the resolution). Renders nothing when
// idle — studio stays calm.

export const LiveNowCard = () => {
  const liveStages = useLiveStages();

  if (liveStages.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col border-b border-[color:var(--hairline)]/30">
      {liveStages.map((s) => (
        <Link
          key={s.stageId}
          href={`/stage/${s.code}/console`}
          className="focus-ring flex items-center gap-2 px-4 py-2.5 font-sans text-[10px] uppercase tracking-[0.22em] text-[color:var(--paper)]/85 transition-colors hover:bg-[color:var(--paper)]/5"
        >
          <span
            aria-hidden
            className="breath size-1.5 rounded-full bg-[color:var(--signal)]"
          />
          {s.name} is live — open its console
        </Link>
      ))}
    </div>
  );
};
