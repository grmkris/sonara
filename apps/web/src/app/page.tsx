"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { DreamCanvas } from "@/components/visualizer/canvas/dream-canvas";
import { GhostOverlay } from "@/components/visualizer/canvas/ghost-overlay";
import { PromptInput } from "@/components/visualizer/controls/prompt-input";
import { MusicSource } from "@/components/visualizer/controls/music-source";
import { AudioRibbon } from "@/components/visualizer/audio/audio-ribbon";
import { SlitScanTrail } from "@/components/visualizer/canvas/slit-scan-trail";
import { ControlsPanel } from "@/components/visualizer/controls/controls-panel";
import { SceneHud } from "@/components/visualizer/controls/scene-hud";
import { HideToggle } from "@/components/visualizer/controls/hide-toggle";
import { FullscreenToggle } from "@/components/visualizer/controls/fullscreen-toggle";
import { RecordToggle } from "@/components/visualizer/controls/record-toggle";
import { UserControls } from "@/components/user-controls";
import { DemoRecorder } from "@/components/visualizer/controls/demo-recorder";
import { GenerationInspector } from "@/components/visualizer/controls/generation-inspector";
import { ScanSweep } from "@/components/visualizer/canvas/scan-sweep";
import { VoiceListen } from "@/components/visualizer/voice/voice-listen";
import { NowPlaying } from "@/components/visualizer/controls/now-playing";
import { Button } from "@/components/ui/button";
import { useWsSession } from "@/hooks/use-ws-session";
import {
  useAudioFeatures,
  type AudioSource,
} from "@/hooks/use-audio-features";
import { useSongRecognition } from "@/hooks/use-song-recognition";
import { useHotkey } from "@/hooks/use-hotkey";
import {
  hydratePresetPrefs,
  hydrateUiVisible,
  useVisualizerStore,
} from "@/stores/visualizer";
import { cn } from "@/lib/utils";

export default function Page() {
  const send = useWsSession();
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
  }, []);

  useHotkey(
    "Backspace",
    useCallback(() => {
      setAudioSource({ type: "none" });
      send({ type: "session.reset" });
    }, [send]),
  );

  // Reveal UI when pointer enters viewport top-right corner (where the toggle
  // lives) while UI is hidden, to give an escape hatch without exposing the
  // whole chrome.
  useEffect(() => {
    if (uiVisible) return;
    const onMove = (ev: MouseEvent) => {
      if (ev.clientY < 48 && ev.clientX > window.innerWidth - 200) {
        setUiVisible(true);
      }
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, [uiVisible, setUiVisible]);

  return (
    <main className="fixed inset-0 overflow-hidden">
      <DreamCanvas />
      <GhostOverlay />
      <ScanSweep />

      {/* Always-visible corner: wordmark + hide toggle. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-start justify-between px-10 pt-8">
        <Logotype />
        <div className="flex items-center gap-6 pt-2">
          <NowPlaying />
          <Timestamp />
          <UserControls />
          <RecordToggle />
          <FullscreenToggle />
          <HideToggle />
        </div>
      </div>

      {/* Collapsible rails. */}
      <div
        className={cn(
          "absolute inset-0 z-20 flex flex-col",
          uiVisible ? "ui-fade-in" : "ui-fade-out",
        )}
      >
        {/* Scene rail — left-anchored, top third. */}
        <section className="pointer-events-auto mt-28 flex flex-1 gap-10 px-10">
          <div className="relative w-[360px] shrink-0">
            <div aria-hidden className="paper-scrim absolute -inset-6 -z-10" />
            <PromptInput send={send} />
          </div>

          <div className="flex-1" />

          {/* Controls rail — right-anchored. */}
          <div className="relative flex w-[260px] shrink-0 flex-col gap-10">
            <div aria-hidden className="paper-scrim absolute -inset-6 -z-10" />
            <ControlsPanel send={send} />
            <GenerationInspector />
          </div>
        </section>

        {/* Bottom strip — audio meters + HUD + commit/reset. */}
        <section className="pointer-events-auto relative mb-6 px-10 pt-2">
          <div aria-hidden className="paper-scrim absolute -inset-x-4 -inset-y-2 -z-10" />

          {/* Row 0: time-compressed echo ribbon of the last ~8 seconds. */}
          <SlitScanTrail height={24} />

          {/* Row 1: merged waveform-over-spectrum ribbon. */}
          <AudioRibbon height={48} />

          {/* Row 2: sources + actions. */}
          <div className="mt-3 flex items-center justify-between gap-6">
            <div className="flex items-start gap-8">
              <MusicSource source={audioSource} setSource={setAudioSource} />
              <VoiceListen send={send} />
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setAudioSource({ type: "none" });
                send({ type: "session.reset" });
              }}
            >
              reset
            </Button>
          </div>
          <div className="mt-3 border-t border-[color:var(--hairline)]/30 pt-2">
            <SceneHud />
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

function Logotype() {
  return (
    <div className="pointer-events-auto flex flex-col leading-none">
      <span
        className="font-serif text-[color:var(--paper)]/85 select-none italic tracking-tight"
        style={{ fontSize: "34px", fontWeight: 500, lineHeight: 0.9 }}
      >
        dream
      </span>
      <span className="font-sans mt-2 text-[9px] uppercase tracking-[0.32em] text-[color:var(--stone)]">
        visualizer
      </span>
    </div>
  );
}

function Timestamp() {
  const [now, setNow] = useState<string>(() => formatNow());
  useEffect(() => {
    const t = setInterval(() => setNow(formatNow()), 30_000);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="font-mono nums text-[10px] uppercase tracking-[0.22em] text-[color:var(--stone)]">
      {now}
    </span>
  );
}

function formatNow(): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} · ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
