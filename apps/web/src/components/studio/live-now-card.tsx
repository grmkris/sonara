"use client";

import Link from "next/link";

import { useLiveStages } from "@/hooks/use-live-stages";

// One-line awareness strip at the top of the studio rail: while one of YOUR
// stages is live, link straight to its console (via /control, the resolver).
// Renders nothing when idle — studio stays calm.

export const LiveNowCard = () => {
  const liveStages = useLiveStages();
  const liveCount = liveStages.length;

  if (liveCount === 0) {
    return null;
  }

  return (
    <Link
      href="/control"
      className="focus-ring flex items-center gap-2 border-b border-[color:var(--hairline)]/30 px-4 py-2.5 font-sans text-[10px] uppercase tracking-[0.22em] text-[color:var(--paper)]/85 transition-colors hover:bg-[color:var(--paper)]/5"
    >
      <span
        aria-hidden
        className="breath size-1.5 rounded-full bg-[color:var(--signal)]"
      />
      {liveCount === 1
        ? `${liveStages[0]?.name ?? "your stage"} is live — open your console`
        : `${liveCount} stages live — choose your console`}
    </Link>
  );
};
