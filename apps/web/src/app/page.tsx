"use client";

import { useCallback, useEffect, useState } from "react";
import { DreamCanvas } from "@/components/visualizer/dream-canvas";
import { PromptInput } from "@/components/visualizer/prompt-input";
import { MusicSource } from "@/components/visualizer/music-source";
import { AudioMeter } from "@/components/visualizer/audio-meter";
import { ControlsPanel } from "@/components/visualizer/controls-panel";
import { SceneHud } from "@/components/visualizer/scene-hud";
import { HideToggle } from "@/components/visualizer/hide-toggle";
import { Hanko } from "@/components/visualizer/hanko";
import { ScanSweep } from "@/components/visualizer/scan-sweep";
import { TriggerLog } from "@/components/visualizer/trigger-log";
import { IntensityDial } from "@/components/visualizer/intensity-dial";
import { WaveformRibbon } from "@/components/visualizer/waveform-ribbon";
import { SpectrumCurve } from "@/components/visualizer/spectrum-curve";
import { VoiceListen } from "@/components/visualizer/voice-listen";
import { Button } from "@/components/ui/button";
import { useWsSession } from "@/hooks/use-ws-session";
import {
  useAudioFeatures,
  type AudioSource,
} from "@/hooks/use-audio-features";
import { useHotkey } from "@/hooks/use-hotkey";
import {
  hydrateUiVisible,
  useVisualizerStore,
} from "@/stores/visualizer-store";
import { cn } from "@/lib/utils";

export default function Page() {
  const send = useWsSession();
  const [audioSource, setAudioSource] = useState<AudioSource>({ type: "none" });
  const [micError, setMicError] = useState<string | null>(null);

  const onAudioError = useCallback((err: unknown) => {
    if (err instanceof Error) setMicError(err.name || err.message);
    else setMicError("unavailable");
    setAudioSource({ type: "none" });
  }, []);
  const clearMicError = useCallback(() => setMicError(null), []);

  useAudioFeatures(audioSource, send, onAudioError);

  const uiVisible = useVisualizerStore((s) => s.uiVisible);
  const setUiVisible = useVisualizerStore((s) => s.setUiVisible);

  // Apply localStorage preference after mount so SSR and first client paint match.
  useEffect(() => {
    hydrateUiVisible();
  }, []);

  // Clear mic-denied banner after a short window.
  useEffect(() => {
    if (!micError) return;
    const t = setTimeout(() => setMicError(null), 3200);
    return () => clearTimeout(t);
  }, [micError]);

  useHotkey(
    "Enter",
    useCallback(() => send({ type: "generate.commit" }), [send]),
  );
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
      <ScanSweep />

      {/* Always-visible corner: 夢 wordmark + hide toggle. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-start justify-between px-10 pt-8">
        <Logotype />
        <div className="flex items-baseline gap-6 pt-1">
          <Timestamp />
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
            <TriggerLog />
          </div>
        </section>

        {/* Bottom strip — audio meters + HUD + commit/reset. */}
        <section className="pointer-events-auto relative mb-6 px-10 pt-2">
          <div aria-hidden className="paper-scrim absolute -inset-x-4 -inset-y-2 -z-10" />
          <div className="flex items-baseline gap-3">
            <span className="font-mincho text-[15px] text-[color:var(--paper)]">音</span>
            <span className="font-kaku text-[9px] uppercase tracking-[0.3em] text-[color:var(--stone)]">
              audio
            </span>
          </div>
          <div className="mt-1.5">
            <WaveformRibbon height={32} />
          </div>
          <div className="-mt-1">
            <SpectrumCurve height={22} />
          </div>
          <div className="mt-2 flex items-center gap-8">
            <div className="flex-1">
              <AudioMeter />
            </div>
            <IntensityDial send={send} />
          </div>
          <div className="mt-3 flex items-center justify-between gap-6">
            <div className="flex items-start gap-8">
              <MusicSource
                source={audioSource}
                setSource={setAudioSource}
                micError={micError}
                clearMicError={clearMicError}
              />
              <VoiceListen send={send} />
            </div>
            <div className="flex items-center gap-3">
              <Button
                variant="hanko"
                size="sm"
                onClick={() => send({ type: "generate.commit" })}
              >
                <span className="font-mincho text-[12px] leading-none">印</span>
                commit
              </Button>
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
          </div>
          <div className="mt-3 border-t border-[color:var(--hairline)]/30 pt-2">
            <SceneHud />
          </div>
        </section>
      </div>

      <Hanko />
    </main>
  );
}

function Logotype() {
  return (
    <div className="pointer-events-auto flex flex-col leading-none">
      <span
        className="font-mincho text-[color:var(--paper)]/85 select-none"
        style={{ fontSize: "42px", fontWeight: 600, lineHeight: 0.9 }}
      >
        夢
      </span>
      <span className="font-kaku mt-2 text-[9px] uppercase tracking-[0.32em] text-[color:var(--stone)]">
        dream · visualizer
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
    <span className="font-plex nums text-[10px] uppercase tracking-[0.22em] text-[color:var(--stone)]">
      {now}
    </span>
  );
}

function formatNow(): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} · ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
