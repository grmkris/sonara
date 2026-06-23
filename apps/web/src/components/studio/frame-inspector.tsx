"use client";

import type { LibraryFrame } from "@sonara/shared";
import { X } from "lucide-react";

import { FrameInspectorContent } from "./frame-inspector-content";

interface FrameInspectorProps {
  frame: LibraryFrame;
  onClose: () => void;
  // Present only for a member of the open curated set — edit & re-render it.
  onRegenerate?: (prompt: string) => Promise<boolean>;
}

// Desktop right-pane wrapper for the inspector. On mobile this is
// rendered inside a <Sheet> instead (see studio/page.tsx).
export const FrameInspector = ({
  frame,
  onClose,
  onRegenerate,
}: FrameInspectorProps) => (
  <div className="flex h-full flex-col">
    <header className="flex items-center justify-between border-b border-[color:var(--hairline)]/30 px-5 py-3">
      <span className="font-mono text-[10px] uppercase tracking-[0.26em] text-[color:var(--stone)]">
        inspector
      </span>
      <button
        type="button"
        onClick={onClose}
        aria-label="close inspector"
        className="focus-ring rounded-sm p-1 text-[color:var(--stone)] transition-colors hover:bg-[color:var(--paper)]/10 hover:text-[color:var(--paper)]"
      >
        <X className="size-3.5" strokeWidth={1.5} />
      </button>
    </header>
    <div className="flex-1 overflow-y-auto">
      <FrameInspectorContent frame={frame} onRegenerate={onRegenerate} />
    </div>
  </div>
);
