"use client";

import type { FrameSet } from "@sonara/shared";
import { Play } from "lucide-react";
import Link from "next/link";

import { ActivateOnStage } from "@/components/studio/activate-on-stage";

// Read-only center pane for a BUILT-IN set (a "deck" — same frame_set entity,
// origin=builtin, system-owned). No rename/reorder/selection machinery: the
// header states the baked look, the grid just shows the frames, and the two
// actions every set has — preview locally, activate on a live stage.
export const BuiltinSetDetail = ({ frameSet }: { frameSet: FrameSet }) => (
  <div className="flex h-full flex-col gap-6 overflow-y-auto px-6 py-8 md:px-10">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-1">
        <span className="font-mono text-[10px] uppercase tracking-[0.26em] text-[color:var(--stone)]">
          built-in set
        </span>
        <h2 className="truncate font-sans text-[14px] uppercase tracking-[0.18em] text-[color:var(--paper)]/90">
          {frameSet.name}
        </h2>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--stone)]">
          {frameSet.frames.length} frame
          {frameSet.frames.length === 1 ? "" : "s"}
          {frameSet.look
            ? ` · ${frameSet.look.preset.replaceAll("_", " ")} · reactivity ${Math.round(frameSet.look.intensity * 100)}%`
            : ""}
          {frameSet.visibility === "unlisted" ? " · unlisted" : ""}
        </span>
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
        <ActivateOnStage setId={frameSet.id} />
        <Link
          href={`/play?set=${encodeURIComponent(frameSet.id)}`}
          className="focus-ring font-sans inline-flex items-center gap-1.5 border border-[color:var(--hairline)]/40 px-3 py-1.5 text-[10px] uppercase tracking-[0.22em] text-[color:var(--paper)]/85 transition-colors hover:border-[color:var(--paper)]/70 hover:text-[color:var(--paper)]"
        >
          <Play className="size-3" strokeWidth={1.5} />
          preview
        </Link>
      </div>
    </header>

    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
      {frameSet.frames.map((frame, i) => (
        <div
          key={frame.id}
          title={frame.prompt.slice(0, 120)}
          className="relative aspect-square overflow-hidden rounded-sm border border-[color:var(--hairline)]/40 bg-[color:var(--ink)]/40"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={frame.url}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
            className="h-full w-full object-cover"
          />
          <span className="absolute left-1 top-1 rounded-sm bg-[color:var(--ink)]/80 px-1 font-mono text-[8px] tracking-[0.12em] text-[color:var(--paper)]/85">
            {i + 1}
          </span>
        </div>
      ))}
    </div>
  </div>
);
