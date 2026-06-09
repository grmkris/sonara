"use client";

import type { FrameSetId, LiveSessionId } from "@sonara/shared/typeid";
import { Mic, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AppRouterClient } from "server/rpc";
import { toast } from "sonner";

import { AppNavLinks } from "@/components/app-nav";
import { Mark } from "@/components/brand/mark";
import { OperatorConsole } from "@/components/control/operator-console";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { SonaraCanvas } from "@/components/visualizer/canvas/sonara-canvas";
import { FullscreenToggle } from "@/components/visualizer/controls/fullscreen-toggle";
import { MusicSource } from "@/components/visualizer/controls/music-source";
import { useAudioFeatures } from "@/hooks/use-audio-features";
import type { AudioSource } from "@/hooks/use-audio-features";
import { useReelPlaybackLoop } from "@/hooks/use-reel-playback-loop";
import { rpcClient } from "@/lib/orpc";
import { useVisualizerStore } from "@/stores/visualizer";

// /s/[id] — the permalink, and a projector endpoint. The set (or the live
// producer) supplies the FRAMES; the viewer supplies the MOTION: this page
// runs the same WebGL pipeline as /play, driven by audio captured on THIS
// machine (mic / tab). Share the URL with a friend, they point it at a
// projector and feed it the room's sound — the set dances to their party.
// LIVE while the show runs (poll currentFrameUrl ~1s into the canvas, crowd-
// stage pill, owner mixer); REPLAY forever after (client-side set playback,
// original timing for recordings).
//
// Audio never crosses the network: like /play, features are computed locally.
// This page is a viewer — it must NEVER mount the producer reporters
// (frame.report / source.report) and its audio.features go nowhere (noop
// send); the projector-producer (/play) is the only voice to the server.

type Lens = Awaited<ReturnType<AppRouterClient["control"]["lens"]>>;
type FoundLens = Extract<Lens, { exists: true }>;
type ReplaySet = Awaited<ReturnType<AppRouterClient["sets"]["get"]>>;

// Live polls fast — the lens is a cheap registry/PK read and frame skew vs
// the projector is poll-bounded, so 350ms reads as simultaneous in a room.
// (The proper upgrade is a /ws/view push feed; this buys ~80% of it free.)
// Replay is fully local playback — the lens only watches for a restarted
// show, so it can idle. Not-found keeps a slow watch for the show starting.
const LIVE_POLL_MS = 350;
const REPLAY_POLL_MS = 3000;
const GONE_POLL_MS = 5000;

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
      let wait = LIVE_POLL_MS;
      try {
        const next = await rpcClient.control.lens({ id });
        if (cancelled) {
          return;
        }
        setLens(next);
        if (!next.exists) {
          wait = GONE_POLL_MS;
        } else if (next.tense === "replay") {
          wait = REPLAY_POLL_MS;
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

// Feed the polled live frame into the visualizer store so the WebGL canvas
// (not a bare <img>) renders it — same crossfade/reveal pipeline as /play.
// Local monotonic versions; reset on mount so a previous tense's counter
// can't outrank us.
const useLiveFrameFeed = (
  tense: "live" | "replay" | null,
  frameUrl: string | null
): void => {
  const versionRef = useRef(0);

  useEffect(() => {
    if (tense !== "live") {
      return;
    }
    useVisualizerStore.getState().resetFrameVersion();
    versionRef.current = 0;
  }, [tense]);

  useEffect(() => {
    if (tense !== "live" || !frameUrl) {
      return;
    }
    const s = useVisualizerStore.getState();
    if (s.currentFrame === frameUrl) {
      return;
    }
    versionRef.current += 1;
    s.pushFrame(frameUrl, versionRef.current);
  }, [tense, frameUrl]);
};

// Replay rides the existing set-playback machinery: load the frames into the
// store and let useReelPlaybackLoop (mounted by the page) drive pushFrame at
// the right cadence — original timing for recordings, fixed loop otherwise.
// Viewer-local only: the loop writes to the store, never to the server.
const useReplayPlayback = (replaySet: ReplaySet | null): void => {
  useEffect(() => {
    if (!replaySet || replaySet.frames.length === 0) {
      return;
    }
    const s = useVisualizerStore.getState();
    s.startReelPlayback({
      cadence: replaySet.origin === "recording" ? "original" : "fixed",
      frames: replaySet.frames,
      id: replaySet.id,
      name: replaySet.name,
    });
    return () => {
      useVisualizerStore.getState().stopReelPlayback();
    };
  }, [replaySet]);
};

// Viewer-local audio: same engine as /play, but features stay on this
// machine (noop send — there's no producer socket here, and a viewer must
// never speak for the producer).
const useViewerAudio = (): {
  audioSource: AudioSource;
  setAudioSource: (s: AudioSource) => void;
} => {
  const [audioSource, setAudioSource] = useState<AudioSource>({
    type: "none",
  });
  const noopSend = useCallback(() => {
    // viewer features never go upstream
  }, []);
  const onAudioError = useCallback((err: unknown) => {
    const name = err instanceof Error ? err.name || err.message : "unavailable";
    // NotAllowedError fires when the user cancels the share picker or denies
    // mic permission — silent reset is friendlier than a toast.
    if (name !== "NotAllowedError") {
      toast.error("audio unavailable", { description: name, duration: 3200 });
    }
    setAudioSource({ type: "none" });
  }, []);
  const onAudioSourceLost = useCallback(() => {
    toast("audio stopped", { duration: 2200 });
    setAudioSource({ type: "none" });
  }, []);
  useAudioFeatures(audioSource, noopSend, onAudioError, onAudioSourceLost);
  return { audioSource, setAudioSource };
};

// Bottom-center wake-up call while no audio source is connected: the canvas
// is dimmed ("asleep", same as /play's deck idle) until the viewer brings
// the room's sound.
const AudioCta = ({ onMic }: { onMic: () => void }) => (
  <button
    type="button"
    onClick={onMic}
    className="focus-ring pointer-events-auto flex items-center gap-2 rounded-full border border-[color:var(--hairline)]/40 bg-[color:var(--ink)]/70 px-4 py-2 font-sans text-[10px] uppercase tracking-[0.24em] text-[color:var(--paper)]/85 backdrop-blur-sm transition-colors hover:border-[color:var(--paper)]/50"
  >
    <Mic className="size-3.5" strokeWidth={1.5} />
    add your sound — the visuals dance to it
  </button>
);

// The found-state viewer: the real WebGL canvas full-bleed + overlay chrome,
// in either tense.
const LensView = ({
  lens,
  replaySet,
  audioSource,
  setAudioSource,
}: {
  lens: FoundLens;
  replaySet: ReplaySet | null;
  audioSource: AudioSource;
  setAudioSource: (s: AudioSource) => void;
}) => {
  const consoleSessionId =
    lens.tense === "live" && lens.isOwner
      ? (lens.live?.liveSessionId ?? null)
      : null;
  const nowPlaying = lens.tense === "live" ? lens.live?.nowPlaying : null;
  const stage = lens.tense === "live" ? lens.stage : null;
  const name = lens.set?.name ?? "live session";
  const frameCount = replaySet?.frames.length ?? lens.set?.frameCount ?? 0;
  const audioConnected = audioSource.type !== "none";

  return (
    <main className="fixed inset-0 overflow-hidden bg-[color:var(--ink)] text-[color:var(--paper)]">
      <SonaraCanvas dimmed={!audioConnected} />

      {/* Top chrome — identity cluster left; audio source + fullscreen +
          now-playing + (owner) mobile console trigger right. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-start justify-between gap-3 px-4 pt-6 md:px-10 md:pt-8">
        <div className="pointer-events-auto flex flex-col gap-3">
          <Wordmark />
          <AppNavLinks current="s" />
          <TenseLabel name={name} tense={lens.tense} frameCount={frameCount} />
        </div>
        <div className="pointer-events-auto flex items-center gap-3 pt-2 sm:gap-4">
          {nowPlaying && (
            <span
              className="max-w-[200px] truncate font-serif text-[12px] italic text-[color:var(--paper)]/85"
              title={`${nowPlaying.title} — ${nowPlaying.artist}`}
            >
              {nowPlaying.title}
            </span>
          )}
          <MusicSource source={audioSource} setSource={setAudioSource} />
          <FullscreenToggle />
          {consoleSessionId && <ConsoleSheet liveSessionId={consoleSessionId} />}
        </div>
      </div>

      {/* Owner mixer rail — md+ only; the mobile shape is the Sheet above. */}
      {consoleSessionId && <ConsoleRail liveSessionId={consoleSessionId} />}

      {/* Bottom affordances: wake-up audio CTA until sound is connected, and
          the crowd-stage pill while the room is open. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-6 z-30 flex flex-col items-center gap-3">
        {!audioConnected && (
          <AudioCta onMic={() => setAudioSource({ type: "mic" })} />
        )}
        {stage?.open && (
          <Link
            href={`/stage/${stage.room}`}
            className="focus-ring pointer-events-auto rounded-full border border-[color:var(--hairline)]/40 bg-[color:var(--ink)]/70 px-4 py-2 font-sans text-[10px] uppercase tracking-[0.24em] text-[color:var(--paper)]/85 backdrop-blur-sm transition-colors hover:border-[color:var(--paper)]/50"
          >
            join the stage · {stage.room}
          </Link>
        )}
      </div>
    </main>
  );
};

export default function SetPermalinkPage() {
  const params = useParams<{ id: string }>();
  const { id } = params;

  const lens = useLensPoll(id);
  const tense = lens?.exists ? lens.tense : null;
  const { gone: replayGone, replaySet } = useReplaySet(tense, id);

  // The viewer's render pipeline: set-playback loop (inert until replay
  // loads frames), live frame feed, and local audio analysis.
  useReelPlaybackLoop();
  useLiveFrameFeed(
    tense,
    lens?.exists && lens.tense === "live"
      ? (lens.live?.currentFrameUrl ?? null)
      : null
  );
  useReplayPlayback(tense === "replay" ? replaySet : null);
  const { audioSource, setAudioSource } = useViewerAudio();

  // First response hasn't landed yet — hold a quiet ink screen, no verdict.
  if (!lens) {
    return <main className="min-h-svh bg-[color:var(--ink)]" />;
  }

  if (!lens.exists || replayGone) {
    return <NotFoundShell />;
  }

  return (
    <LensView
      audioSource={audioSource}
      lens={lens}
      replaySet={replaySet}
      setAudioSource={setAudioSource}
    />
  );
}
