"use client";

import { deckLabel } from "@sonara/shared";
import { SlidersHorizontal, Smartphone } from "lucide-react";
import Link from "next/link";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { AppNavLinks } from "@/components/app-nav";
import { Mark } from "@/components/brand/mark";
import { StageWire } from "@/components/stage/stage-wire";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { UserControls } from "@/components/user-controls";
import { AudioRibbon } from "@/components/visualizer/audio/audio-ribbon";
import { GhostOverlay } from "@/components/visualizer/canvas/ghost-overlay";
import { ScanSweep } from "@/components/visualizer/canvas/scan-sweep";
import { SonaraCanvas } from "@/components/visualizer/canvas/sonara-canvas";
import { ControlsPanel } from "@/components/visualizer/controls/controls-panel";
import { DemoRecorder } from "@/components/visualizer/controls/demo-recorder";
import { FullscreenToggle } from "@/components/visualizer/controls/fullscreen-toggle";
import { HideToggle } from "@/components/visualizer/controls/hide-toggle";
import { MusicSource } from "@/components/visualizer/controls/music-source";
import { NowPlaying } from "@/components/visualizer/controls/now-playing";
import { PromptInput } from "@/components/visualizer/controls/prompt-input";
import { ShareLink } from "@/components/visualizer/controls/share-link";
import { SetPlaybackConsumer } from "@/components/visualizer/set-playback-consumer";
import { SetPlaybackHud } from "@/components/visualizer/set-playback-hud";
import { StudioActionConsumer } from "@/components/visualizer/studio-action-consumer";
import { useAudioFeatures } from "@/hooks/use-audio-features";
import type { AudioSource } from "@/hooks/use-audio-features";
import { useDemoFrameLoop } from "@/hooks/use-demo-frame-loop";
import { useFrameReporter } from "@/hooks/use-frame-reporter";
import { useHotkey } from "@/hooks/use-hotkey";
import { useSetPlaybackLoop } from "@/hooks/use-set-playback-loop";
import { useSongRecognition } from "@/hooks/use-song-recognition";
import { useSourceReporter } from "@/hooks/use-source-reporter";
import { useWsSession } from "@/hooks/use-ws-session";
import { useSession } from "@/lib/auth-client";
import { HOTKEYS } from "@/lib/hotkeys";
import { cn } from "@/lib/utils";
import {
  hydrateAnchorPrefs,
  hydrateDemoPrefs,
  hydrateModelPrefs,
  hydratePresetPrefs,
  hydrateUiVisible,
  useVisualizerStore,
} from "@/stores/visualizer";

// Quieter rail-side hint for anonymous visitors who reached /play from the
// landing. Going live (typing a scene / pinning an anchor) needs credits, so
// anon never gets the PromptInput — this sign-in nudge is the wall. Deck
// switching + bringing your own audio stay free for them.
const AnonPromptPlaceholder = () => (
  <div className="flex flex-col gap-3">
    <span className="font-serif italic text-[color:var(--paper)]/85 text-[15px] leading-snug">
      sign in to direct the visuals.
    </span>
    <Button asChild variant="ghost" size="sm" className="-ml-2 w-fit">
      <Link
        href="/login"
        className="font-sans text-[11px] uppercase tracking-[0.24em]"
      >
        sign in
      </Link>
    </Button>
  </div>
);

// Quiet caption under the wordmark naming the look you're starting from. Shows
// only while on a deck; once you commit a prompt and go live it disappears (the
// deck picker's "live · generating" chip carries the live state). Replaces the
// old SceneHud telemetry; the audio-reactive 1px rule under "sonara"
// (`.wordmark::after` via `--amp`) carries live-presence more elegantly.
const LookChip = () => {
  const demoMode = useVisualizerStore((s) => s.demoMode);
  const demoDeck = useVisualizerStore((s) => s.demoDeck);
  if (!demoMode || !demoDeck) {
    return null;
  }
  return (
    <span className="font-mono pointer-events-none text-[10px] uppercase tracking-[0.22em] text-[color:var(--paper)]/85">
      {deckLabel(demoDeck)}
    </span>
  );
};

// Discreet link to the console (/control resolves to the owner view on /s).
// Opens in a new tab so the projector keeps playing; in practice you open it
// on a second device, but the link makes it discoverable from here too.
const RemoteLink = () => (
  <Link
    href="/control"
    target="_blank"
    rel="noopener"
    aria-label="open your console"
    title="drive the show from your phone"
    className="focus-ring flex items-center text-[color:var(--stone)] transition-colors hover:text-[color:var(--paper)]"
  >
    <Smartphone className="size-4" strokeWidth={1.5} />
  </Link>
);

const Logotype = () => {
  const ref = useRef<HTMLSpanElement | null>(null);
  // Subscribe to live RMS and write to a CSS variable on the wordmark span.
  // Done via a ref + RAF coalescer rather than React state so the underline
  // can react at frame rate without re-rendering the React subtree.
  useEffect(() => {
    const unsub = useVisualizerStore.subscribe((s, prev) => {
      if (s.audio.rms === prev.audio.rms) {
        return;
      }
      const el = ref.current;
      if (!el) {
        return;
      }
      const clamped = Math.max(0, Math.min(1, s.audio.rms));
      el.style.setProperty("--amp", clamped.toFixed(3));
    });
    return () => unsub();
  }, []);

  return (
    <span className="pointer-events-auto flex items-center gap-2.5 text-[color:var(--paper)]/85">
      <Mark reactive className="h-7 w-7 shrink-0" />
      <span
        ref={ref}
        className="wordmark font-serif block select-none italic tracking-tight"
        style={{ fontSize: "34px", fontWeight: 500, lineHeight: 0.9 }}
      >
        sonara.fm
      </span>
    </span>
  );
};

export default function Page() {
  const { send, startNewSession } = useWsSession();
  // Demo is client-native: the browser drives demo frames from a static
  // manifest, so it works on slow/no internet (the server never generates in
  // demo mode).
  useDemoFrameLoop();
  // Client-side set replay producer (inert until a ?set= param — or a legacy
  // param, retired in C5 — activates it via SetPlaybackConsumer).
  useSetPlaybackLoop();
  // /play is the producer: report the on-screen frame upward so /control (and
  // viewers) see it in every mode. Viewer surfaces must never mount this.
  useFrameReporter(send);
  useSourceReporter(send);
  const { data: sessionData } = useSession();
  const isSignedIn = !!sessionData?.session;
  const [audioSource, setAudioSource] = useState<AudioSource>({ type: "none" });

  const onAudioError = useCallback(
    (err: unknown) => {
      const name =
        err instanceof Error ? err.name || err.message : "unavailable";
      // NotAllowedError fires when the user cancels the share picker or
      // denies mic permission — silent reset is friendlier than a toast.
      if (name === "NotAllowedError") {
        setAudioSource({ type: "none" });
        return;
      }
      const label =
        audioSource.type === "display"
          ? "audio share failed"
          : "mic unavailable";
      toast.error(label, { description: name, duration: 3200 });
      setAudioSource({ type: "none" });
    },
    [audioSource.type]
  );

  const onAudioSourceLost = useCallback(() => {
    toast("audio share stopped", { duration: 2200 });
    setAudioSource({ type: "none" });
  }, []);

  useAudioFeatures(audioSource, send, onAudioError, onAudioSourceLost);
  // Song recognition (AudD) is signed-in only. The hook noops when disabled
  // so the audio-features subscription on the store doesn't even fire.
  useSongRecognition(send, isSignedIn);

  const uiVisible = useVisualizerStore((s) => s.uiVisible);
  const setUiVisible = useVisualizerStore((s) => s.setUiVisible);

  // Apply localStorage preference after mount so SSR and first client paint match.
  useEffect(() => {
    hydrateUiVisible();
    hydratePresetPrefs();
    hydrateDemoPrefs();
    hydrateAnchorPrefs();
    hydrateModelPrefs();
  }, []);

  // Anonymous visitors have no server session pinning them to demo mode, and
  // offline there's no connect snapshot either — default them into demo so the
  // client-native loop runs. Signed-in users control their own demo toggle.
  useEffect(() => {
    // session still resolving
    if (sessionData === undefined) {
      return;
    }
    if (isSignedIn) {
      return;
    }
    const st = useVisualizerStore.getState();
    if (!st.demoMode) {
      st.setDemoMode(true);
    }
    if (!st.demoDeck) {
      st.setDemoDeck("liquid");
    }
  }, [sessionData, isSignedIn]);

  // Clear the in-memory library on sign-out (signed-in → signed-out), so a
  // different account signing in on the same tab can't briefly see the
  // previous user's frames before bootstrap replaces them.
  const prevSignedInRef = useRef(isSignedIn);
  useEffect(() => {
    if (sessionData === undefined) {
      return;
    }
    if (prevSignedInRef.current && !isSignedIn) {
      useVisualizerStore.getState().libraryReset();
    }
    prevSignedInRef.current = isSignedIn;
  }, [isSignedIn, sessionData]);

  useHotkey(
    HOTKEYS.reset,
    useCallback(() => {
      setAudioSource({ type: "none" });
      send({ type: "session.reset" });
    }, [send])
  );

  const audioConnected = audioSource.type !== "none";

  return (
    <main className="fixed inset-0 overflow-hidden">
      <SonaraCanvas dimmed={!audioConnected} />
      <GhostOverlay />
      <ScanSweep />

      {/* Editorial paper grain — fixed, very faint, blended with overlay so it
         tints both the dark background and the generated image consistently. */}
      <div aria-hidden className="grain-overlay" />

      {/* Corner-reveal trigger: an invisible 200×48 div anchored top-right.
         While the UI is hidden, mousing into it brings the chrome back —
         cheaper than a global mousemove listener. */}
      {!uiVisible && (
        <div
          aria-hidden
          className="pointer-events-auto absolute right-0 top-0 z-40 h-12 w-[200px]"
          onMouseEnter={() => setUiVisible(true)}
        />
      )}

      {/* Top corner: wordmark (with micro-hud beneath) + tight right-side
         control cluster. Fades out with the rest of the chrome when the UI
         is hidden — restore via the z-40 corner-reveal trigger or `h`. */}
      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 z-30 flex items-start justify-between gap-3 px-4 pt-6 md:px-10 md:pt-8",
          uiVisible ? "ui-fade-in" : "ui-fade-out"
        )}
      >
        <div className="pointer-events-auto flex flex-col gap-3">
          <Logotype />
          <AppNavLinks current="play" />
          <LookChip />
        </div>
        <div className="pointer-events-auto flex items-center gap-3 pt-2 sm:gap-5">
          <NowPlaying />
          {/* Operator remote: drive this session from a phone so the projector
              stays a clean canvas (hide the HUD with the toggle beside this).
              Signed-in only — control needs an owned live session. */}
          {isSignedIn && <ShareLink />}
          {isSignedIn && <RemoteLink />}
          <UserControls />
          <FullscreenToggle />
          <HideToggle />
          <Sheet>
            <SheetTrigger asChild>
              <button
                type="button"
                aria-label="open controls"
                className="focus-ring flex items-center text-[color:var(--stone)] transition-colors hover:text-[color:var(--paper)] md:hidden"
              >
                <SlidersHorizontal className="size-4" strokeWidth={1.5} />
              </button>
            </SheetTrigger>
            <SheetContent
              side="right"
              className="w-[min(360px,90vw)] border-l border-[color:var(--hairline)]/30 bg-[color:var(--ink)]/95 p-5 backdrop-blur-md"
            >
              <span
                aria-hidden
                className="mx-auto -mt-2 mb-3 block h-1 w-10 rounded-full bg-[color:var(--stone)]/40"
              />
              <SheetTitle className="font-mono text-[10px] uppercase tracking-[0.22em] text-[color:var(--stone)]">
                controls
              </SheetTitle>
              <div className="mt-4 overflow-y-auto pr-1">
                <ControlsPanel send={send} />
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>

      {/* Collapsible rails — render for everyone. Unauthenticated visitors
         get the same chrome, but live-only affordances (PromptInput,
         VoiceListen, NowPlaying) gate themselves on
         useSession and hide / disable when there's no user. The server
         pins anon WS sessions to demo-library mode, so the controls that
         remain (deck picker, presets, audio source) behave correctly. */}
      <div
        className={cn(
          "absolute inset-0 z-20 flex flex-col",
          uiVisible ? "ui-fade-in" : "ui-fade-out"
        )}
      >
        {/* Scene rail — left-anchored, top third. */}
        <section className="pointer-events-auto mt-24 flex flex-1 gap-6 px-4 md:mt-28 md:gap-10 md:px-10">
          <div className="relative w-full md:w-[360px] md:shrink-0">
            <div aria-hidden className="paper-scrim absolute -inset-6 -z-10" />
            {isSignedIn ? (
              <PromptInput send={send} />
            ) : (
              <AnonPromptPlaceholder />
            )}
          </div>

          <div className="hidden flex-1 md:block" />

          {/* Controls rail — right-anchored on md+; folds into the mobile
             Sheet (see header) at narrower widths. */}
          <div className="relative hidden w-[260px] shrink-0 flex-col gap-10 md:flex">
            <div aria-hidden className="paper-scrim absolute -inset-6 -z-10" />
            <ControlsPanel send={send} />
          </div>
        </section>

        {/* Bottom strip — audio ribbon + one tight control row. The library
            timeline lives in /studio, not here. */}
        <section className="pointer-events-auto relative mb-4 px-4 pt-2 md:mb-6 md:px-10">
          <div
            aria-hidden
            className="paper-scrim absolute -inset-x-4 -inset-y-2 -z-10"
          />

          <AudioRibbon height={40} />

          {/* Bring-your-own-audio nudge. The deck cycles dimmed until the
             visitor connects a source (mic / track / tab); once they do, the
             canvas wakes up to full brightness + beat reactivity. */}
          {!audioConnected && (
            <p className="mt-2 font-sans text-[10px] uppercase tracking-[0.24em] text-[color:var(--signal)]">
              ▷ bring sound — open the mic, drop a track, or share a tab
            </p>
          )}

          <div className="mt-3 flex items-center justify-between gap-3 sm:gap-6">
            <div className="flex items-center gap-3 sm:gap-6">
              <MusicSource source={audioSource} setSource={setAudioSource} />
            </div>
            <div className="flex items-center gap-3 sm:gap-5">
              {/* Start a fresh logical performance: mints a new durable
                  liveSessionId and reconnects under it, so the next set is its
                  own /studio entry instead of appending to this one. Distinct
                  from reset (which only clears the current scene). */}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setAudioSource({ type: "none" });
                  startNewSession();
                }}
                className="font-sans text-[10px] uppercase tracking-[0.24em] text-[color:var(--stone)] hover:text-[color:var(--paper)]"
              >
                new session
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setAudioSource({ type: "none" });
                  send({ type: "session.reset" });
                }}
                className="font-sans text-[10px] uppercase tracking-[0.24em] text-[color:var(--stone)] hover:text-[color:var(--paper)]"
              >
                reset · ⌫
              </Button>
            </div>
          </div>
        </section>
      </div>

      {/* DemoRecorder reads `?record=` via useSearchParams, which Next 16
          requires inside a Suspense boundary so the rest of the page can
          prerender. */}
      <Suspense fallback={null}>
        <DemoRecorder />
      </Suspense>

      {/* Consumes ?anchor= / ?prompt= one-shot params left by /studio. */}
      <Suspense fallback={null}>
        <StudioActionConsumer send={send} />
      </Suspense>

      {/* Consumes ?set= replay params (+ legacy params, retired in C5); drives the playback loop. */}
      <Suspense fallback={null}>
        <SetPlaybackConsumer />
      </Suspense>

      {/* Replay overlay (exit control); only renders while a replay is active. */}
      <SetPlaybackHud />

      {/* Monad wire overlay; only renders while the crowd stage is open. */}
      <StageWire />
    </main>
  );
}
