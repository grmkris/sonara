"use client";

import { useCallback } from "react";
import type { LibraryFrame } from "@sonara/shared";
import { formatAgo } from "@/lib/format-time";
import type { SessionSend } from "@/lib/session-actions";
import { cn } from "@/lib/utils";

interface FrameThumbProps {
  frame: LibraryFrame;
  send: SessionSend;
}

// Single library thumbnail. Click = use as image anchor at the default
// "style + subject" strength (0.55). The presigned bucket URL is passed
// straight through to fal — fal accepts arbitrary HTTPS URLs for the
// image_url field, so no fal.storage upload step is needed.
//
// Hover preview is intentionally minimal for v1 (border emphasis only).
// Wiring a true canvas crossfade preview requires synthetic version
// management; deferred until the strip surface has more signal.
export function FrameThumb({ frame, send }: FrameThumbProps) {
  const onClick = useCallback(() => {
    send({
      type: "image.anchor.set",
      url: frame.url,
      strength: 0.55,
    });
  }, [frame.url, send]);

  // "n m ago" / "n s ago" formatter — small + dependency-free.
  const ago = formatAgo(frame.createdAt);

  return (
    <button
      type="button"
      onClick={onClick}
      title={`${frame.prompt}\n\n${ago} · click to use as anchor`}
      aria-label={`use frame as anchor: ${frame.prompt.slice(0, 80)}`}
      className={cn(
        "focus-ring group relative shrink-0 overflow-hidden rounded-sm",
        "border border-[color:var(--hairline)]/40 bg-[color:var(--ink)]/40",
        "transition-all duration-150",
        "hover:border-[color:var(--paper)]/80 hover:scale-[1.04]",
      )}
      style={{ width: 64, height: 64 }}
    >
      {/* Image loads lazily — only thumbnails near the viewport actually
          fetch. content-visibility on the parent strip handles the rest. */}
      <img
        src={frame.url}
        alt=""
        loading="lazy"
        decoding="async"
        className="h-full w-full object-cover"
      />
      <span
        className={cn(
          "pointer-events-none absolute inset-x-0 bottom-0",
          "bg-gradient-to-t from-[color:var(--ink)]/85 to-transparent",
          "px-1 py-0.5 font-sans text-[8px] uppercase tracking-[0.16em]",
          "text-[color:var(--paper)]/90 opacity-0 transition-opacity",
          "group-hover:opacity-100",
        )}
      >
        {ago}
      </span>
    </button>
  );
}

