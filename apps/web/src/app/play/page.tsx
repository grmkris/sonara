"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { SonaraCanvas } from "@/components/visualizer/canvas/sonara-canvas";
import { GhostOverlay } from "@/components/visualizer/canvas/ghost-overlay";
import { PromoOverlay } from "@/components/visualizer/promo-overlay";
import { PromptInput } from "@/components/visualizer/controls/prompt-input";
import { MusicSource } from "@/components/visualizer/controls/music-source";
import { AudioRibbon } from "@/components/visualizer/audio/audio-ribbon";
import { ControlsPanel } from "@/components/visualizer/controls/controls-panel";
import { HideToggle } from "@/components/visualizer/controls/hide-toggle";
import { FullscreenToggle } from "@/components/visualizer/controls/fullscreen-toggle";
import { RecordToggle } from "@/components/visualizer/controls/record-toggle";
import { UserControls } from "@/components/user-controls";
import { DemoRecorder } from "@/components/visualizer/controls/demo-recorder";
import { ScanSweep } from "@/components/visualizer/canvas/scan-sweep";
import { NowPlaying } from "@/components/visualizer/controls/now-playing";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import Link from "next/link";
import { useSession } from "@/lib/auth-client";
import { useWsSession } from "@/hooks/use-ws-session";
import { useDemoFrameLoop } from "@/hooks/use-demo-frame-loop";
import {
  useAudioFeatures,
  type AudioSource,
} from "@/hooks/use-audio-features";
import { useSongRecognition } from "@/hooks/use-song-recognition";
import { useHotkey } from "@/hooks/use-hotkey";
import { HOTKEYS } from "@/lib/hotkeys";
import {
  hydrateAnchorPrefs,
  hydrateConsoleTab,
  hydrateDemoPrefs,
  hydratePresetPrefs,
  hydrateUiVisible,
  useVisualizerStore,
} from "@/stores/visualizer";
import { cn } from "@/lib/utils";

export default function Page() {
  const send = useWsSession();
  // Demo is client-native: the browser drives demo frames from a static
  // manifest, so it works on slow/no internet (the server never generates in
  // demo mode).
  useDemoFrameLoop();
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
        audioSource.type === "display" ? "audio share failed" : "mic unavailable";
      toast.error(label, { description: name, duration: 3200 });
      setAudioSource({ type: "none" });
    },
    [audioSource.type],
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
    hydrateConsoleTab();
  }, []);

  // Anonymous visitors have no server session pinning them to demo mode, and
  // offline there's no connect snapshot either — default them into demo so the
  // client-native loop runs. Signed-in users control their own demo toggle.
  useEffect(() => {
    if (sessionData === undefined) return; // session still resolving
    if (isSignedIn) return;
    const st = useVisualizerStore.getState();
    if (!st.demoMode) st.setDemoMode(true);
    if (!st.demoDeck) st.setDemoDeck("cyborg");
  }, [sessionData, isSignedIn]);

  useHotkey(
    HOTKEYS.reset,
    useCallback(() => {
      setAudioSource({ type: "none" });
      send({ type: "session.reset" });
    }, [send]),
  );


  return (
    <main className="fixed inset-0 overflow-hidden">
      <SonaraCanvas />
      <GhostOverlay />
      <ScanSweep />

      {/* Editorial paper grain — fixed, very faint, blended with overlay so it
         tints both the dark background and the generated image consistently. */}
      <div aria-hidden className="grain-overlay" />

      {/* Promotion overlay — persists through the chrome hide toggle so the
         brand stays on screen during a clean fullscreen show. */}
      <PromoOverlay />

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
          uiVisible ? "ui-fade-in" : "ui-fade-out",
        )}
      >
        <div className="pointer-events-auto flex flex-col gap-3">
          <Logotype />
          <DemoChip />
        </div>
        <div className="pointer-events-auto flex items-center gap-3 pt-2 sm:gap-5">
          <NowPlaying />
          <UserControls />
          <RecordToggle />
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
         VoiceListen, RecordToggle, NowPlaying) gate themselves on
         useSession and hide / disable when there's no user. The server
         pins anon WS sessions to demo-library mode, so the controls that
         remain (deck picker, presets, audio source) behave correctly. */}
      <div
        className={cn(
          "absolute inset-0 z-20 flex flex-col",
          uiVisible ? "ui-fade-in" : "ui-fade-out",
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

        {/* Bottom strip — single audio ribbon + one tight control row. */}
        <section className="pointer-events-auto relative mb-4 px-4 pt-2 md:mb-6 md:px-10">
          <div aria-hidden className="paper-scrim absolute -inset-x-4 -inset-y-2 -z-10" />

          <AudioRibbon height={40} />

          <div className="mt-3 flex items-center justify-between gap-3 sm:gap-6">
            <div className="flex items-center gap-3 sm:gap-6">
              <MusicSource source={audioSource} setSource={setAudioSource} />
            </div>
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
        </section>
      </div>

      {/* DemoRecorder reads `?record=` via useSearchParams, which Next 16
          requires inside a Suspense boundary so the rest of the page can
          prerender. */}
      <Suspense fallback={null}>
        <DemoRecorder />
      </Suspense>
    </main>
  );
}

// Quieter rail-side hint for anonymous visitors who reached /play from the
// landing. The landing already sells the app and explains what demo mode
// is — here we just point at the upgrade. Typing into PromptInput would
// have no visual effect for anon (trigger() short-circuits to library
// regardless of subject), so we surface a sign-in nudge instead.
function AnonPromptPlaceholder() {
  return (
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
}

// Single chip under the wordmark, visible only in demo mode. Replaces the
// old SceneHud (ver/amp/fps/up/status), which was mission-control telemetry
// useless to first-time visitors. The audio-reactive 1px rule under "sonara"
// (`.wordmark::after` via `--amp`) carries the live-presence signal more
// elegantly than an FPS readout ever did.
function DemoChip() {
  const demoMode = useVisualizerStore((s) => s.demoMode);
  const demoDeck = useVisualizerStore((s) => s.demoDeck);
  if (!demoMode) return null;
  return (
    <span className="font-mono pointer-events-none flex items-baseline gap-1.5 text-[10px] uppercase tracking-[0.22em] text-[color:var(--stone)]">
      <span className="bg-[color:var(--paper)] text-[color:var(--ink)] px-1 tracking-[0.14em]">
        demo
      </span>
      {demoDeck && (
        <span className="text-[color:var(--paper)]">{demoDeck}</span>
      )}
    </span>
  );
}

function Logotype() {
  const ref = useRef<HTMLSpanElement | null>(null);
  // Subscribe to live RMS and write to a CSS variable on the wordmark span.
  // Done via a ref + RAF coalescer rather than React state so the underline
  // can react at frame rate without re-rendering the React subtree.
  useEffect(() => {
    const unsub = useVisualizerStore.subscribe((s, prev) => {
      if (s.audio.rms === prev.audio.rms) return;
      const el = ref.current;
      if (!el) return;
      const clamped = Math.max(0, Math.min(1, s.audio.rms));
      el.style.setProperty("--amp", clamped.toFixed(3));
    });
    return () => unsub();
  }, []);

  return (
    <span
      ref={ref}
      className="wordmark font-serif pointer-events-auto block select-none italic tracking-tight text-[color:var(--paper)]/85"
      style={{ fontSize: "34px", fontWeight: 500, lineHeight: 0.9 }}
    >
      sonara.fm
    </span>
  );
}

