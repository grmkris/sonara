"use client";

import { useCallback } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useSession } from "@/lib/auth-client";
import { useVisualizerStore } from "@/stores/visualizer";
import { cn } from "@/lib/utils";

// Small toggle that opens/closes the timeline strip. Visible only for
// signed-in users (anon has no library); also hidden if the user is
// signed in but has zero frames yet — first frame they generate flips
// it on. The strip itself renders separately and gates on the same
// timelineOpen flag.
export function TimelineToggle() {
  const { data: sessionData } = useSession();
  const isSignedIn = !!sessionData?.session;
  const timelineOpen = useVisualizerStore((s) => s.timelineOpen);
  const frameCount = useVisualizerStore((s) => s.libraryFrames.length);
  const setTimelineOpen = useVisualizerStore((s) => s.setTimelineOpen);

  const onClick = useCallback(() => {
    setTimelineOpen(!timelineOpen);
  }, [timelineOpen, setTimelineOpen]);

  if (!isSignedIn) return null;
  if (frameCount === 0 && !timelineOpen) return null;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={timelineOpen ? "close library" : "open library"}
      aria-expanded={timelineOpen}
      className={cn(
        "focus-ring inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5",
        "font-sans text-[10px] uppercase tracking-[0.22em]",
        "border-[color:var(--hairline)]/40 bg-transparent text-[color:var(--stone)]",
        "transition-colors hover:border-[color:var(--paper)]/60 hover:text-[color:var(--paper)]",
      )}
    >
      {timelineOpen ? (
        <ChevronDown className="size-3" strokeWidth={1.5} />
      ) : (
        <ChevronUp className="size-3" strokeWidth={1.5} />
      )}
      <span>library{frameCount > 0 ? ` · ${frameCount}` : ""}</span>
    </button>
  );
}
