"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { SonaraCanvas } from "@/components/visualizer/canvas/sonara-canvas";
import { GhostOverlay } from "@/components/visualizer/canvas/ghost-overlay";
import { PromptInput } from "@/components/visualizer/controls/prompt-input";
import { MusicSource } from "@/components/visualizer/controls/music-source";
import { AudioRibbon } from "@/components/visualizer/audio/audio-ribbon";
import { ControlsPanel } from "@/components/visualizer/controls/controls-panel";
import { SceneHud } from "@/components/visualizer/controls/scene-hud";
import { HideToggle } from "@/components/visualizer/controls/hide-toggle";
import { FullscreenToggle } from "@/components/visualizer/controls/fullscreen-toggle";
import { RecordToggle } from "@/components/visualizer/controls/record-toggle";
import { UserControls } from "@/components/user-controls";
import { DemoRecorder } from "@/components/visualizer/controls/demo-recorder";
import { ScanSweep } from "@/components/visualizer/canvas/scan-sweep";
import { VoiceListen } from "@/components/visualizer/voice/voice-listen";
import { NowPlaying } from "@/components/visualizer/controls/now-playing";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useSession } from "@/lib/auth-client";
import { useWsSession } from "@/hooks/use-ws-session";
import Link from "next/link";
import {
  useAudioFeatures,
  type AudioSource,
} from "@/hooks/use-audio-features";
import { useSongRecognition } from "@/hooks/use-song-recognition";
import { useHotkey } from "@/hooks/use-hotkey";
import { HOTKEYS } from "@/lib/hotkeys";
import {
  hydrateConsoleTab,
  hydrateDemoPrefs,
  hydratePresetPrefs,
  hydrateUiVisible,
  useVisualizerStore,
} from "@/stores/visualizer";
import { cn } from "@/lib/utils";

export default function Page() {
  const send = useWsSession();
  const { data: sessionData, isPending: sessionPending } = useSession();
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
  useSongRecognition(send);

  const uiVisible = useVisualizerStore((s) => s.uiVisible);
  const setUiVisible = useVisualizerStore((s) => s.setUiVisible);

  // Apply localStorage preference after mount so SSR and first client paint match.
  useEffect(() => {
    hydrateUiVisible();
    hydratePresetPrefs();
    hydrateDemoPrefs();
    hydrateConsoleTab();
  }, []);

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

      {/* Always-visible corner: wordmark (with micro-hud beneath) +
         tight right-side control cluster. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-start justify-between gap-3 px-4 pt-6 md:px-10 md:pt-8">
        <div className="pointer-events-auto flex flex-col gap-3">
          <Logotype />
          <SceneHud />
        </div>
        <div className="pointer-events-auto flex items-center gap-3 pt-2 sm:gap-5">
          <NowPlaying />
          <UserControls />
          <RecordToggle />
          <FullscreenToggle />
          <HideToggle />
          {isSignedIn && (
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
                <SheetTitle className="font-mono text-[10px] uppercase tracking-[0.22em] text-[color:var(--stone)]">
                  controls
                </SheetTitle>
                <div className="mt-4 overflow-y-auto pr-1">
                  <ControlsPanel send={send} />
                </div>
              </SheetContent>
            </Sheet>
          )}
        </div>
      </div>

      {/* Auth gate — the whole interactive surface (WS session, prompt, demo
         picker, audio source) requires sign-in. Show a centred CTA in place
         of the rails when not authenticated. `sessionPending` covers the
         brief window before better-auth resolves the cookie; we render
         nothing rather than flashing the wrong state. */}
      {!sessionPending && !isSignedIn && (
        <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none">
          <div className="pointer-events-auto relative px-10 py-8">
            <div aria-hidden className="paper-scrim absolute -inset-4 -z-10" />
            <div className="flex flex-col items-center gap-4 text-center">
              <span className="font-serif italic text-[color:var(--paper)] text-2xl">
                sign in to start
              </span>
              <span className="font-sans text-[10px] uppercase tracking-[0.24em] text-[color:var(--stone)] max-w-[280px]">
                the visualiser needs a session — demo and live generation both
                run through your signed-in account.
              </span>
              <Button asChild variant="ghost" size="sm" className="mt-2">
                <Link
                  href="/login"
                  className="font-sans text-[11px] uppercase tracking-[0.24em]"
                >
                  sign in
                </Link>
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Collapsible rails. Only mounted when signed in — keeps the unauth
         overlay clean and stops the controls from dispatching dead WS
         actions. */}
      {isSignedIn && (
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
            <PromptInput send={send} />
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
              <span aria-hidden className="hairline h-3 w-px opacity-30" />
              <VoiceListen send={send} />
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
      )}

      {/* DemoRecorder reads `?record=` via useSearchParams, which Next 16
          requires inside a Suspense boundary so the rest of the page can
          prerender. */}
      <Suspense fallback={null}>
        <DemoRecorder />
      </Suspense>
    </main>
  );
}

function Logotype() {
  return (
    <span
      className="font-serif pointer-events-auto block select-none italic tracking-tight text-[color:var(--paper)]/85"
      style={{ fontSize: "34px", fontWeight: 500, lineHeight: 0.9 }}
    >
      sonara
    </span>
  );
}

