"use client";

import { useSession } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { useVisualizerStore } from "@/stores/visualizer";

// Small chip showing the identified track (with a "refresh" action) OR — when
// nothing is known yet — a minimal "identify" button. Without the always-
// visible fallback there's no way to manually kick the pipeline before the
// auto-gate conditions are met (sustained loud audio), which was stranding
// first-time users.
//
// When a manual identify is in flight the button shows a spinning icon +
// "listening…" instead of just bouncing back to the resting state — users
// couldn't tell whether the click had registered otherwise.
//
// Hidden for anonymous visitors. The underlying `recognize` WS proc returns
// null for `userId === null`, so the chip would never light up anyway.
export function NowPlaying() {
  const { data: sessionData } = useSession();
  const track = useVisualizerStore((s) => s.nowPlaying);
  const requestIdentify = useVisualizerStore((s) => s.requestIdentify);
  const recognizing = useVisualizerStore((s) => s.recognizing);

  if (!sessionData?.session) {
    return null;
  }

  if (!track) {
    return (
      <button
        type="button"
        onClick={requestIdentify}
        disabled={recognizing}
        className={cn(
          "focus-ring pointer-events-auto flex items-center gap-2 rounded-sm border border-[color:var(--hairline)]/40 bg-black/20 px-2 py-1 backdrop-blur-sm",
          "font-mono text-[10px] uppercase tracking-[0.2em] text-[color:var(--stone)] transition",
          "hover:text-[color:var(--paper)] disabled:opacity-60"
        )}
        title={recognizing ? "recognising…" : "identify music playing now"}
        aria-label={recognizing ? "recognising" : "identify music playing now"}
      >
        {recognizing ? <SpinnerIcon /> : <RefreshIcon />}
        <span className="hidden sm:inline">
          {recognizing ? "listening…" : "identify"}
        </span>
      </button>
    );
  }

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
      <div className="hidden min-w-0 max-w-[160px] flex-col leading-tight sm:flex">
        <span
          className={cn(
            "truncate font-serif text-[11px] italic",
            "text-[color:var(--paper)]/90"
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
        disabled={recognizing}
        className="focus-ring rounded-sm p-1 text-[color:var(--stone)] transition hover:text-[color:var(--paper)] disabled:opacity-60"
        title={recognizing ? "recognising…" : "identify again"}
        aria-label={recognizing ? "recognising" : "identify again"}
      >
        {recognizing ? <SpinnerIcon /> : <RefreshIcon />}
      </button>
    </div>
  );
}

function RefreshIcon() {
  return (
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
  );
}

function SpinnerIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="animate-spin"
      aria-hidden
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}
