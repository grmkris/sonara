"use client";

import type { FrameSetSummary } from "@sonara/shared";

import { NewSetDropRow, SetDropRow } from "@/components/studio/set-drop-row";

// While a frame drag is live on the RECORDINGS tab, the left rail shows
// recordings — nowhere to drop. This shelf swaps in for the duration of the
// drag: a compact list of curated-set targets plus the new-set target.
export const SetsDropShelf = ({
  sets,
  dragCount,
}: {
  sets: FrameSetSummary[];
  dragCount: number;
}) => (
  <div aria-label="drop targets" className="flex flex-col">
    <div className="px-4 pb-2 pt-5 font-mono text-[9px] uppercase tracking-[0.26em] text-[color:var(--signal)]">
      drop to add
    </div>
    <NewSetDropRow dragCount={dragCount} />
    {sets.map((s) => (
      <SetDropRow key={s.id} set={s} dragCount={dragCount} selected={false} />
    ))}
    {sets.length === 0 && (
      <p className="px-4 py-4 font-sans text-[11px] leading-relaxed text-[color:var(--stone)]">
        No sets yet — drop on “new set” above.
      </p>
    )}
  </div>
);
