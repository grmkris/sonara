"use client";

import { useVisualizerStore } from "@/stores/visualizer-store";
import { cn } from "@/lib/utils";

// Small chip showing the identified track. Hidden when nothing is known.
// The refresh button bumps `identifyTick` which `useSongRecognition` watches
// to force a manual recognition regardless of auto-floor / silence gates.
export function NowPlaying() {
  const track = useVisualizerStore((s) => s.nowPlaying);
  const requestIdentify = useVisualizerStore((s) => s.requestIdentify);
  if (!track) return null;
  return (
    <div className="pointer-events-auto flex items-center gap-2 rounded-sm border border-[color:var(--hairline)]/40 bg-black/20 px-2 py-1 backdrop-blur-sm">
      {track.albumArtUrl ? (
        <img
          src={track.albumArtUrl}
          alt=""
          aria-hidden
          className="h-7 w-7 rounded-sm object-cover opacity-90"
        />
      ) : (
        <div className="h-7 w-7 rounded-sm bg-[color:var(--stone)]/10" />
      )}
      <div className="flex min-w-0 max-w-[160px] flex-col leading-tight">
        <span
          className={cn(
            "truncate font-serif text-[11px] italic",
            "text-[color:var(--paper)]/90",
          )}
          title={`${track.title} — ${track.artist}`}
        >
          {track.title}
        </span>
        <span className="truncate font-mono text-[9px] uppercase tracking-[0.2em] text-[color:var(--stone)]">
          {track.artist}
        </span>
      </div>
      <button
        type="button"
        onClick={requestIdentify}
        className="rounded-sm p-1 text-[color:var(--stone)] transition hover:text-[color:var(--paper)]"
        title="identify again"
        aria-label="identify again"
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 12a9 9 0 1 1-3-6.7" />
          <path d="M21 3v6h-6" />
        </svg>
      </button>
    </div>
  );
}
