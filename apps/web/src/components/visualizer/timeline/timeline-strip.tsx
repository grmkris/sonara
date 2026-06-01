"use client";

import { useEffect, useRef } from "react";
import type { SessionSend } from "@/lib/session-actions";
import { useSession } from "@/lib/auth-client";
import { useVisualizerStore } from "@/stores/visualizer";
import { FrameThumb } from "./frame-thumb";
import { cn } from "@/lib/utils";

interface TimelineStripProps {
  send: SessionSend;
}

// Horizontal scrubbable library strip. Newest-first (leftmost). Mounted
// at the bottom of /play; visibility is gated by the ui-slice's
// timelineOpen flag. Only authed users see content here — anon gets a
// sign-in invite in its place.
//
// Pagination: IntersectionObserver watches a sentinel at the right edge
// (oldest end). When it enters the viewport, the slice fetches the next
// page via library.list with the cursor.
export function TimelineStrip({ send }: TimelineStripProps) {
  const { data: sessionData } = useSession();
  const isSignedIn = !!sessionData?.session;
  const timelineOpen = useVisualizerStore((s) => s.timelineOpen);
  const frames = useVisualizerStore((s) => s.libraryFrames);
  const hasMore = useVisualizerStore((s) => s.libraryHasMore);
  const loading = useVisualizerStore((s) => s.libraryLoading);
  const bootstrapped = useVisualizerStore((s) => s.libraryBootstrapped);
  const loadMore = useVisualizerStore((s) => s.libraryLoadMore);

  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!timelineOpen || !hasMore) return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          void loadMore();
        }
      },
      { root: null, rootMargin: "0px 200px 0px 0px", threshold: 0 },
    );
    obs.observe(sentinel);
    return () => obs.disconnect();
  }, [timelineOpen, hasMore, loadMore]);

  if (!timelineOpen) return null;

  // Anon: invitation instead of the strip. Authed but no frames yet:
  // quiet hint so the panel doesn't look broken on first open.
  if (!isSignedIn) {
    return (
      <div className="w-full px-4 py-3 md:px-10">
        <p className="font-sans text-[10px] uppercase tracking-[0.22em] text-[color:var(--stone)]">
          sign in to keep your library
        </p>
      </div>
    );
  }

  if (bootstrapped && frames.length === 0) {
    return (
      <div className="w-full px-4 py-3 md:px-10">
        <p className="font-sans text-[10px] uppercase tracking-[0.22em] text-[color:var(--stone)]">
          your library will grow as you generate frames
        </p>
      </div>
    );
  }

  return (
    <div className="w-full px-4 py-3 md:px-10">
      <div
        className={cn(
          "scrollbar-thin flex gap-1.5 overflow-x-auto",
          // content-visibility skips offscreen layout cost as the user
          // scrolls; cheap perf win at large library sizes.
          "[&>*]:[content-visibility:auto]",
        )}
      >
        {frames.map((f) => (
          <FrameThumb key={f.id} frame={f} send={send} />
        ))}
        {hasMore && (
          <div
            ref={sentinelRef}
            aria-hidden
            className="shrink-0"
            style={{ width: 1, height: 64 }}
          />
        )}
        {loading && (
          <div
            aria-hidden
            className="flex h-16 shrink-0 items-center justify-center px-3 font-sans text-[9px] uppercase tracking-[0.2em] text-[color:var(--stone)]"
          >
            loading…
          </div>
        )}
      </div>
    </div>
  );
}
