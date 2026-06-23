"use client";

import type { Ref } from "react";

import { cn } from "@/lib/utils";

interface LibraryRowProps {
  // Cover thumbnail (falls back to an empty ink tile when absent).
  coverUrl?: string | null;
  title: string;
  // Secondary line (frame count, look, visibility, "+N" drop badge…).
  meta: string;
  selected?: boolean;
  // Drag-over highlight (signal ring) for drop-target rows.
  highlighted?: boolean;
  // Tints the meta line — "signal" while a drop is hovering.
  metaTone?: "default" | "signal";
  onClick?: () => void;
  // Forwarded to the root <button> so drop-target adapters can attach.
  rootRef?: Ref<HTMLButtonElement>;
}

// The one sidebar row, shared by recordings, curated sets, and built-ins so
// every list reads identically: cover thumb · title · meta, with a left rule +
// paper wash on the selected row and a signal ring while a drag hovers.
export const LibraryRow = ({
  coverUrl,
  title,
  meta,
  selected = false,
  highlighted = false,
  metaTone = "default",
  onClick,
  rootRef,
}: LibraryRowProps) => (
  <button
    ref={rootRef}
    type="button"
    onClick={onClick}
    aria-current={selected ? "true" : undefined}
    className={cn(
      "focus-ring flex w-full items-center gap-3 border-b border-l-2 border-l-transparent border-[color:var(--hairline)]/20 px-4 py-2 text-left transition-colors",
      selected
        ? "border-l-[color:var(--paper)] bg-[color:var(--paper)]/15"
        : "hover:bg-[color:var(--paper)]/5",
      highlighted &&
        "bg-[color:var(--paper)]/10 ring-1 ring-inset ring-[color:var(--signal)]"
    )}
  >
    {coverUrl ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={coverUrl}
        alt=""
        loading="lazy"
        className={cn(
          "size-10 shrink-0 rounded-sm border object-cover",
          selected
            ? "border-[color:var(--paper)]/70"
            : "border-[color:var(--hairline)]/40"
        )}
      />
    ) : (
      <div
        className={cn(
          "size-10 shrink-0 rounded-sm border bg-[color:var(--ink)]/40",
          selected
            ? "border-[color:var(--paper)]/70"
            : "border-[color:var(--hairline)]/40"
        )}
      />
    )}
    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span
        className={cn(
          "truncate font-sans text-[11px] uppercase tracking-[0.16em]",
          selected
            ? "font-medium text-[color:var(--paper)]"
            : "text-[color:var(--paper)]/80"
        )}
      >
        {title}
      </span>
      <span
        className={cn(
          "font-mono text-[9px] uppercase tracking-[0.18em]",
          metaTone === "signal"
            ? "text-[color:var(--signal)]"
            : "text-[color:var(--stone)]"
        )}
      >
        {meta}
      </span>
    </div>
  </button>
);
