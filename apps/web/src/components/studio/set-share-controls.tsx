"use client";

import type { FrameSetVisibility } from "@sonara/shared";
import { Link2 } from "lucide-react";
import { toast } from "sonner";

const VISIBILITIES: FrameSetVisibility[] = ["private", "unlisted", "public"];

// Per-set share affordance, shared by the recording timeline and the set
// editor headers: a visibility select (private / unlisted / public) plus a
// copy-link button for the /s/<setId> permalink. The /s page ships in a later
// WP — the link shape is final.
export const SetShareControls = ({
  setId,
  visibility,
  onVisibilityChange,
}: {
  setId: string;
  visibility: FrameSetVisibility;
  onVisibilityChange: (visibility: FrameSetVisibility) => void;
}) => {
  const onCopyLink = () => {
    void (async () => {
      try {
        await navigator.clipboard.writeText(
          `${window.location.origin}/s/${setId}`
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
    <div className="flex items-center gap-2">
      <select
        value={visibility}
        onChange={(e) =>
          onVisibilityChange(e.target.value as FrameSetVisibility)
        }
        aria-label="set visibility"
        className="focus-ring border border-[color:var(--hairline)]/40 bg-transparent px-2 py-1.5 font-sans text-[10px] uppercase tracking-[0.22em] text-[color:var(--stone)] transition-colors hover:text-[color:var(--paper)]"
      >
        {VISIBILITIES.map((v) => (
          <option key={v} value={v} className="bg-[color:var(--ink)]">
            {v}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={onCopyLink}
        aria-label="copy share link"
        className="focus-ring inline-flex items-center gap-1.5 border border-[color:var(--hairline)]/40 px-3 py-1.5 font-sans text-[10px] uppercase tracking-[0.22em] text-[color:var(--stone)] transition-colors hover:border-[color:var(--paper)]/70 hover:text-[color:var(--paper)]"
      >
        <Link2 className="size-3" strokeWidth={1.5} />
        copy link
      </button>
    </div>
  );
};
