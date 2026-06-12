"use client";

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
import { StageChip } from "@/components/stage-screen/stage-chip";
import { StageConsole } from "@/components/stage-console/stage-console";
import { DemoRecorder } from "@/components/visualizer/controls/demo-recorder";
import { FullscreenToggle } from "@/components/visualizer/controls/fullscreen-toggle";
import { HideToggle } from "@/components/visualizer/controls/hide-toggle";
import { MusicSource } from "@/components/visualizer/controls/music-source";
import { NowPlaying } from "@/components/visualizer/controls/now-playing";
import { PromptInput } from "@/components/visualizer/controls/prompt-input";
import { ShareLink } from "@/components/visualizer/controls/share-link";
import { SetPlaybackConsumer } from "@/components/visualizer/set-playback-consumer";
import { StudioActionConsumer } from "@/components/visualizer/studio-action-consumer";
import { useAudioFeatures } from "@/hooks/use-audio-features";
import type { AudioSource } from "@/hooks/use-audio-features";
import { useFrameReporter } from "@/hooks/use-frame-reporter";
import { useHotkey } from "@/hooks/use-hotkey";
import { useOwnStage } from "@/hooks/use-own-stage";
import { usePlaybackLoop } from "@/hooks/use-playback-loop";
import { useSongRecognition } from "@/hooks/use-song-recognition";
import { useSourceReporter } from "@/hooks/use-source-reporter";
import { useWsSession } from "@/hooks/use-ws-session";
import { applyBuiltinSetLocally } from "@/lib/apply-source";
import { useSession } from "@/lib/auth-client";
import { HOTKEYS } from "@/lib/hotkeys";
import { cn } from "@/lib/utils";
import {
  hydrateAnchorPrefs,
  hydrateModelPrefs,
  hydratePresetPrefs,
  hydrateSourcePref,
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

// Discreet link to THIS stage's console (permanent URL). Opens in a new tab
// so the projector keeps playing; in practice you open it on a second device,
// but the link makes it discoverable from here too.
const RemoteLink = ({ code }: { code: string }) => (
  <Link
    href={`/stage/${code}/console`}
    target="_blank"
    rel="noopener"
    aria-label="open this stage's console"
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

// The SCREEN face of a stage — the projector/producer surface. /play mounts
// it with code=null (your default stage; anon = the demo instrument);
// /stage/<code>/screen mounts it pinned to a named stage. Run identity is
// server-owned (use-ws-session); the frame/source producers
// (useFrameReporter etc.) live ONLY here — console and crowd faces must
// never mount them.
export const StageScreen = ({ code }: { code: string | null }) => {
  const { send, newSet, takenOver, reclaim } = useWsSession({ code });
  // THE client-side producer for decks and set replays — one loop, one
  // version guard. Deck/builtin playback runs from static manifests, so it
  // works on slow/no internet (the server never generates during playback).
  usePlaybackLoop();
  // /play is the producer: report the on-screen frame upward so /control (and
  // viewers) see it in every mode. Viewer surfaces must never mount this.
  useFrameReporter(send);
  useSourceReporter(send);
  const { data: sessionData } = useSession();
  const isSignedIn = !!sessionData?.session;
  // Which of MY stages this screen performs on — binds the host panel
  // (crowd open/close under the permanent code) and the crowd-first share.
  const ownStage = useOwnStage(code, isSignedIn);
  const hostTarget = ownStage ? { stageId: ownStage.stageId } : null;
  const [audioSource, setAudioSource] = useState<AudioSource>({ type: "none" });

  // Console footer actions. "New set" closes the current recording segment
  // and starts the next one (own /studio entry) — no reconnect; "reset" only
  // clears the current scene. Both drop the local audio source so the next
  // take re-arms deliberately.
  const onNewSet = useCallback(() => {
    setAudioSource({ type: "none" });
    newSet();
  }, [newSet]);
  const onReset = useCallback(() => {
    setAudioSource({ type: "none" });
    send({ type: "session.reset" });
  }, [send]);

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
    hydrateSourcePref();
    hydrateAnchorPrefs();
    hydrateModelPrefs();
  }, []);

  // Anonymous visitors normally get a builtin-set source from the server
  // snapshot (constructor-pinned) — but offline there's no connect snapshot,
  // so default them onto a builtin locally to keep the client-native loop
  // running.
  useEffect(() => {
    // session still resolving
    if (sessionData === undefined) {
      return;
    }
    if (isSignedIn) {
      return;
    }
    const st = useVisualizerStore.getState();
    if (st.source.kind === "idle" || st.source.kind === "live") {
      applyBuiltinSetLocally({ deckKey: "liquid" });
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

      {/* Another device attached as this stage's screen — this tab demoted
          to a passive notice (producers are silenced in use-ws-session).
          Reclaiming kicks the other device in turn. */}
      {takenOver && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-5 bg-[color:var(--ink)]/85 backdrop-blur-sm">
          <p className="font-serif text-[17px] italic text-[color:var(--paper)]/90">
            this stage&apos;s screen moved to another device.
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={reclaim}
            className="font-sans text-[11px] uppercase tracking-[0.24em] text-[color:var(--stone)] hover:text-[color:var(--paper)]"
          >
            reclaim the screen here
          </Button>
        </div>
      )}

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
        </div>
        <div className="pointer-events-auto flex items-center gap-3 pt-2 sm:gap-5">
          {/* Operator remote: drive this session from a phone so the projector
              stays a clean canvas (hide the HUD with the toggle beside this).
              Signed-in only — control needs an owned live session. */}
          {isSignedIn && <ShareLink stageCode={ownStage?.code ?? null} />}
          {isSignedIn && ownStage && <RemoteLink code={ownStage.code} />}
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
                <StageConsole
                  variant="attached"
                  send={send}
                  hostTarget={hostTarget}
                  onNewSet={onNewSet}
                  onReset={onReset}
                />
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
        {/* Scene rail — left-anchored, top third. The scene card carries the
            stage identity as its eyebrow ("on this stage, this scene") so the
            chip no longer crowds the header stack; bordered like the console
            card across the canvas (scrims alone stopped being the rule when
            the right rail grew its frame). */}
        <section className="pointer-events-auto mt-24 flex flex-1 gap-6 px-4 md:mt-28 md:gap-10 md:px-10">
          <div className="relative w-full md:w-[360px] md:shrink-0">
            <div aria-hidden className="paper-scrim absolute -inset-4 -z-10" />
            <div className="flex flex-col rounded-sm border border-[color:var(--hairline)]/25 p-3">
              <div className="mb-3 flex items-center justify-between gap-2 border-b border-[color:var(--hairline)]/25 pb-2">
                <span className="font-sans text-[9px] uppercase tracking-[0.28em] text-[color:var(--stone)]">
                  scene
                </span>
                <StageChip current={ownStage} />
              </div>
              {isSignedIn ? (
                <PromptInput send={send} variant="card" />
              ) : (
                <AnonPromptPlaceholder />
              )}
            </div>
          </div>

          <div className="hidden flex-1 md:block" />

          {/* Controls rail — right-anchored on md+; folds into the mobile
             Sheet (see header) at narrower widths. */}
          <div className="relative hidden w-[260px] shrink-0 flex-col gap-10 md:flex">
            <div aria-hidden className="paper-scrim absolute -inset-6 -z-10" />
            <StageConsole
              variant="attached"
              send={send}
              hostTarget={hostTarget}
              onNewSet={onNewSet}
              onReset={onReset}
            />
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

          {/* One audio row: the source pill, the bring-sound nudge folded
             inline (only while silent), and the identified track. */}
          <div className="mt-3 flex items-center justify-between gap-3 sm:gap-6">
            <div className="flex min-w-0 items-center gap-3 sm:gap-6">
              <MusicSource source={audioSource} setSource={setAudioSource} />
              {!audioConnected && (
                <p className="hidden font-sans text-[10px] uppercase tracking-[0.24em] text-[color:var(--signal)] sm:block">
                  ▷ bring sound — mic, track, or tab
                </p>
              )}
            </div>
            <NowPlaying />
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

      {/* Monad wire overlay; only renders while the crowd stage is open. */}
      <StageWire />
    </main>
  );
};
