"use client";

import type { FrameSetId, LiveSessionId } from "@sonara/shared/typeid";
import { SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { AppRouterClient } from "server/rpc";

import { AppNavLinks } from "@/components/app-nav";
import { Mark } from "@/components/brand/mark";
import { OperatorConsole } from "@/components/control/operator-console";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { rpcClient } from "@/lib/orpc";
import { cn } from "@/lib/utils";

// /s/[id] — the permalink. One lens onto a set: LIVE while the show runs
// (poll currentFrameUrl ~1s, crossfade viewer, crowd-stage pill, owner mixer),
// REPLAY forever after (client-side cycle over the set's frames, original
// timing for recordings). This page is a viewer only — it must NEVER mount
// producer hooks or send frame.report/source.report; the projector (/play)
// is the producer.

type Lens = Awaited<ReturnType<AppRouterClient["control"]["lens"]>>;
type FoundLens = Extract<Lens, { exists: true }>;
type ReplaySet = Awaited<ReturnType<AppRouterClient["sets"]["get"]>>;

const LENS_POLL_MS = 1000;
// Nothing here (yet) — keep a slow watch so the page wakes when the show starts.
const GONE_POLL_MS = 5000;

// Replay cadence — same bounds as the projector's set playback: recordings
// honor the original tMs deltas (clamped so a long pause doesn't stall and a
// burst doesn't strobe); everything else holds a fixed loop.
const FIXED_CADENCE_MS = 2500;
const MIN_CADENCE_MS = 600;
const MAX_CADENCE_MS = 6000;

const FADE_MS = 600;

// Two absolutely-stacked <img> layers. A new url loads in the hidden back
// layer and only fades over the front once it has actually loaded, so the
// viewer never sees a blank between frames. Replay loops revisit urls, so a
// back layer that already holds the incoming url flips without a reload.
const CrossfadeFrame = ({ url }: { url: string | null }) => {
  const [layers, setLayers] = useState<{ a: string | null; b: string | null }>(
    { a: null, b: null }
  );
  const [front, setFront] = useState<"a" | "b">("a");
  const loadedRef = useRef<{ a: boolean; b: boolean }>({ a: false, b: false });

  useEffect(() => {
    if (!url || layers[front] === url) {
      return;
    }
    const back: "a" | "b" = front === "a" ? "b" : "a";
    if (layers[back] === url) {
      // Already staged (and maybe loaded) in the back layer — flip if ready;
      // otherwise its onLoad will flip when the bytes land.
      if (loadedRef.current[back]) {
        setFront(back);
      }
      return;
    }
    loadedRef.current[back] = false;
    setLayers((cur) => ({ ...cur, [back]: url }));
  }, [url, front, layers]);

  const onLoad = (key: "a" | "b") => {
    loadedRef.current[key] = true;
    if (key !== front) {
      setFront(key);
    }
  };

  return (
    <div aria-hidden className="fixed inset-0 bg-[color:var(--ink)]">
      {(["a", "b"] as const).map((key) =>
        layers[key] ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            alt=""
            className={cn(
              "absolute inset-0 h-full w-full object-cover transition-opacity ease-out",
              key === front ? "opacity-100" : "opacity-0"
            )}
            key={key}
            onLoad={() => onLoad(key)}
            src={layers[key] as string}
            style={{ transitionDuration: `${FADE_MS}ms` }}
          />
        ) : null
      )}
    </div>
  );
};

const Wordmark = () => (
  <Link
    href="/"
    className="focus-ring flex w-fit items-center gap-2.5 text-[color:var(--paper)]/85"
  >
    <Mark className="h-6 w-6 shrink-0" />
    <span
      className="font-serif select-none italic tracking-tight"
      style={{ fontSize: "24px", fontWeight: 500, lineHeight: 0.9 }}
    >
      sonara.fm
    </span>
  </Link>
);

// exists:false — nothing resolvable at this id (or it's private to someone
// else). The poll loop keeps a slow watch upstream; if the show starts, the
// page flips to the live viewer on its own.
const NotFoundShell = () => (
  <main className="flex min-h-svh items-center justify-center bg-[color:var(--ink)] px-6 text-[color:var(--paper)]">
    <div className="flex flex-col items-center gap-5 text-center">
      <Wordmark />
      <p className="font-serif text-[15px] italic text-[color:var(--paper)]/85">
        nothing is playing here.
      </p>
      <Link
        href="/play"
        className="focus-ring font-sans text-[11px] uppercase tracking-[0.24em] text-[color:var(--stone)] transition-colors hover:text-[color:var(--paper)]"
      >
        open the visualizer
      </Link>
    </div>
  </main>
);

// Top-left identity cluster + the tense label (live pulse / replay count).
const TenseLabel = ({
  name,
  tense,
  frameCount,
}: {
  name: string;
  tense: "live" | "replay";
  frameCount: number;
}) => (
  <div className="flex items-center gap-2">
    {tense === "live" && (
      <span
        aria-hidden
        className="size-1.5 shrink-0 animate-pulse rounded-full bg-[color:var(--signal)]"
      />
    )}
    <span className="font-sans text-[10px] uppercase tracking-[0.24em] text-[color:var(--paper)]/85">
      {name}
    </span>
    <span className="font-sans text-[10px] uppercase tracking-[0.24em] text-[color:var(--stone)]">
      {tense === "live" ? "live" : `replay · ${frameCount} frames`}
    </span>
  </div>
);

// The owner's mixer, desktop shape: a scrollable hairline rail pinned to the
// right edge of the viewport on md+. Viewers never get this far — the parent
// gates on lens.isOwner.
const ConsoleRail = ({ liveSessionId }: { liveSessionId: LiveSessionId }) => (
  <aside className="absolute inset-y-0 right-0 z-30 hidden w-full max-w-sm overflow-y-auto border-l border-[color:var(--hairline)]/25 bg-[color:var(--ink)]/85 p-5 pt-8 backdrop-blur-md md:block">
    <OperatorConsole liveSessionId={liveSessionId} />
  </aside>
);

// Mobile shape: a bottom Sheet behind a small trigger in the top-right
// cluster (mirrors /play's mobile controls Sheet). The console only mounts
// while the sheet is open, so there's no hidden second poller at rest.
const ConsoleSheet = ({ liveSessionId }: { liveSessionId: LiveSessionId }) => (
  <div className="md:hidden">
    <Sheet>
      <SheetTrigger asChild>
        <button
          type="button"
          aria-label="open operator console"
          className="focus-ring flex items-center text-[color:var(--stone)] transition-colors hover:text-[color:var(--paper)]"
        >
          <SlidersHorizontal className="size-4" strokeWidth={1.5} />
        </button>
      </SheetTrigger>
      <SheetContent
        side="bottom"
        className="max-h-[80svh] overflow-y-auto border-t border-[color:var(--hairline)]/30 bg-[color:var(--ink)]/95 p-5 backdrop-blur-md"
      >
        <span
          aria-hidden
          className="mx-auto -mt-2 mb-3 block h-1 w-10 rounded-full bg-[color:var(--stone)]/40"
        />
        <SheetTitle className="font-mono text-[10px] uppercase tracking-[0.22em] text-[color:var(--stone)]">
          console
        </SheetTitle>
        <div className="mt-4">
          <OperatorConsole liveSessionId={liveSessionId} />
        </div>
      </SheetContent>
    </Sheet>
  </div>
);

// The lens poll — 1s while something resolves, ~5s in the not-found state
// (the show may start any minute). setTimeout chain with cancellation, same
// discipline as /stage's feed-less polls.
const useLensPoll = (id: string): Lens | null => {
  const [lens, setLens] = useState<Lens | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async (): Promise<void> => {
      let wait = LENS_POLL_MS;
      try {
        const next = await rpcClient.control.lens({ id });
        if (cancelled) {
          return;
        }
        setLens(next);
        if (!next.exists) {
          wait = GONE_POLL_MS;
        }
      } catch {
        // Transient — keep the last lens on screen and retry next tick.
      }
      if (!cancelled) {
        timer = setTimeout(poll, wait);
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [id]);

  return lens;
};

// Replay tense → fetch the full set (ordered frames + fresh urls) once when
// the tense flips. Replay only ever resolves for set_ ids (a bare lse_ id
// with no live session comes back exists:false), so the cast is safe.
// `gone` flags a NOT_FOUND throw (deleted / re-privated between polls).
const useReplaySet = (
  tense: "live" | "replay" | null,
  id: string
): { gone: boolean; replaySet: ReplaySet | null } => {
  const [replaySet, setReplaySet] = useState<ReplaySet | null>(null);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    if (tense !== "replay") {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const set = await rpcClient.sets.get({ setId: id as FrameSetId });
        if (!cancelled) {
          setReplaySet(set);
        }
      } catch {
        if (!cancelled) {
          setGone(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tense, id]);

  return { gone, replaySet };
};

// Cycle the replay client-side, looping forever. Recordings replay on their
// original timing (tMs deltas, clamped); curated/builtin hold a fixed beat.
const useReplayFrameIdx = (
  tense: "live" | "replay" | null,
  replaySet: ReplaySet | null
): number => {
  const [frameIdx, setFrameIdx] = useState(0);

  useEffect(() => {
    if (tense !== "replay" || !replaySet || replaySet.frames.length === 0) {
      return;
    }
    const { frames } = replaySet;
    const originalTiming = replaySet.origin === "recording";
    const cadenceFor = (i: number): number => {
      if (!originalTiming) {
        return FIXED_CADENCE_MS;
      }
      const cur = frames[i];
      const next = frames[(i + 1) % frames.length];
      if (!(cur && next)) {
        return FIXED_CADENCE_MS;
      }
      const delta = next.tMs - cur.tMs;
      if (delta <= 0) {
        return FIXED_CADENCE_MS;
      }
      return Math.min(MAX_CADENCE_MS, Math.max(MIN_CADENCE_MS, delta));
    };

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let idx = 0;
    const tick = () => {
      if (cancelled) {
        return;
      }
      setFrameIdx(idx);
      const wait = cadenceFor(idx);
      idx = (idx + 1) % frames.length;
      timer = setTimeout(tick, wait);
    };
    tick();
    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [tense, replaySet]);

  return frameIdx;
};

// Per-tense view state. Live reads the polled snapshot (frame, track, stage,
// owner console binding); replay reads the cycled set and shows none of the
// live-only chrome.
const livePropsOf = (lens: FoundLens) => ({
  consoleSessionId: lens.isOwner ? (lens.live?.liveSessionId ?? null) : null,
  frameUrl: lens.live?.currentFrameUrl ?? null,
  nowPlaying: lens.live?.nowPlaying ?? null,
  stage: lens.stage,
});

const replayPropsOf = (replaySet: ReplaySet | null, frameIdx: number) => ({
  consoleSessionId: null,
  frameUrl: replaySet?.frames[frameIdx]?.url ?? null,
  nowPlaying: null,
  stage: null,
});

// The found-state viewer: full-bleed crossfade frame + overlay chrome, in
// either tense.
const LensView = ({
  lens,
  replaySet,
  frameIdx,
}: {
  lens: FoundLens;
  replaySet: ReplaySet | null;
  frameIdx: number;
}) => {
  const { consoleSessionId, frameUrl, nowPlaying, stage } =
    lens.tense === "live"
      ? livePropsOf(lens)
      : replayPropsOf(replaySet, frameIdx);
  const name = lens.set?.name ?? "live session";
  const frameCount = replaySet?.frames.length ?? lens.set?.frameCount ?? 0;

  return (
    <main className="fixed inset-0 overflow-hidden bg-[color:var(--ink)] text-[color:var(--paper)]">
      <CrossfadeFrame url={frameUrl} />

      {/* Top chrome — identity cluster left, now-playing + (owner) mobile
          console trigger right. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-start justify-between gap-3 px-4 pt-6 md:px-10 md:pt-8">
        <div className="pointer-events-auto flex flex-col gap-3">
          <Wordmark />
          <AppNavLinks current="s" />
          <TenseLabel
            name={name}
            tense={lens.tense}
            frameCount={frameCount}
          />
        </div>
        <div className="pointer-events-auto flex items-center gap-3 pt-2">
          {nowPlaying && (
            <span
              className="max-w-[200px] truncate font-serif text-[12px] italic text-[color:var(--paper)]/85"
              title={`${nowPlaying.title} — ${nowPlaying.artist}`}
            >
              {nowPlaying.title}
            </span>
          )}
          {consoleSessionId && <ConsoleSheet liveSessionId={consoleSessionId} />}
        </div>
      </div>

      {/* Owner mixer rail — md+ only; the mobile shape is the Sheet above. */}
      {consoleSessionId && <ConsoleRail liveSessionId={consoleSessionId} />}

      {/* Crowd stage — the on-chain panel lives at /stage/[room]; this just
          points the audience there. */}
      {stage?.open && (
        <div className="pointer-events-none absolute inset-x-0 bottom-6 z-30 flex justify-center">
          <Link
            href={`/stage/${stage.room}`}
            className="focus-ring pointer-events-auto rounded-full border border-[color:var(--hairline)]/40 bg-[color:var(--ink)]/70 px-4 py-2 font-sans text-[10px] uppercase tracking-[0.24em] text-[color:var(--paper)]/85 backdrop-blur-sm transition-colors hover:border-[color:var(--paper)]/50"
          >
            join the stage · {stage.room}
          </Link>
        </div>
      )}
    </main>
  );
};

export default function SetPermalinkPage() {
  const params = useParams<{ id: string }>();
  const { id } = params;

  const lens = useLensPoll(id);
  const tense = lens?.exists ? lens.tense : null;
  const { gone: replayGone, replaySet } = useReplaySet(tense, id);
  const frameIdx = useReplayFrameIdx(tense, replaySet);

  // First response hasn't landed yet — hold a quiet ink screen, no verdict.
  if (!lens) {
    return <main className="min-h-svh bg-[color:var(--ink)]" />;
  }

  if (!lens.exists || replayGone) {
    return <NotFoundShell />;
  }

  return <LensView frameIdx={frameIdx} lens={lens} replaySet={replaySet} />;
}
