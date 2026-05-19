"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Circle, Volume2, VolumeX } from "lucide-react";
import { toast } from "sonner";
import { useSession } from "@/lib/auth-client";
import { useHotkey } from "@/hooks/use-hotkey";
import { HOTKEYS } from "@/lib/hotkeys";
import { cn } from "@/lib/utils";
import {
  buildFilename,
  downloadBlob,
  isMp4Mime,
  isRecordingSupported,
  startRecording,
  type VideoRecorderHandle,
} from "@/lib/recording/video-recorder";

const AUDIO_PREF_KEY = "mv:record-audio";
const MAX_DURATION_MS = 10 * 60_000;

type Phase = "idle" | "recording" | "exporting";

function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000);
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

export function RecordToggle() {
  const { data: sessionData } = useSession();
  const isSignedIn = !!sessionData?.session;
  const [supported, setSupported] = useState(true);
  const [phase, setPhase] = useState<Phase>("idle");
  const [withAudio, setWithAudio] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const [exportPct, setExportPct] = useState(0);
  const handleRef = useRef<VideoRecorderHandle | null>(null);
  const tickRef = useRef<number | null>(null);

  useEffect(() => {
    setSupported(isRecordingSupported());
    const stored = window.localStorage.getItem(AUDIO_PREF_KEY);
    if (stored === "0") setWithAudio(false);
  }, []);

  useEffect(() => {
    return () => {
      if (tickRef.current !== null) {
        cancelAnimationFrame(tickRef.current);
        tickRef.current = null;
      }
      if (handleRef.current) {
        handleRef.current.stop().catch(() => undefined);
        handleRef.current = null;
      }
    };
  }, []);

  const persistAudioPref = useCallback((value: boolean) => {
    setWithAudio(value);
    try {
      window.localStorage.setItem(AUDIO_PREF_KEY, value ? "1" : "0");
    } catch {
      // noop
    }
  }, []);

  const stop = useCallback(async () => {
    const handle = handleRef.current;
    if (!handle) return;
    handleRef.current = null;
    if (tickRef.current !== null) {
      cancelAnimationFrame(tickRef.current);
      tickRef.current = null;
    }
    setPhase("exporting");
    setExportPct(0);
    try {
      const { blob, mimeType } = await handle.stop();
      if (isMp4Mime(mimeType)) {
        downloadBlob(blob, buildFilename("mp4"));
        toast.success("recording saved");
      } else {
        try {
          const { transcodeToMp4 } = await import(
            "@/lib/recording/transcode-to-mp4"
          );
          const mp4 = await transcodeToMp4(blob, {
            hasAudio: handle.hasAudio,
            onProgress: (r) => setExportPct(Math.round(r * 100)),
          });
          downloadBlob(mp4, buildFilename("mp4"));
          toast.success("recording saved as mp4");
        } catch (err) {
          console.warn("[RecordToggle] transcode failed, saving webm", err);
          downloadBlob(blob, buildFilename("webm"));
          toast.warning("mp4 conversion failed — saved as webm");
        }
      }
    } catch (err) {
      console.error("[RecordToggle] stop failed", err);
      toast.error("recording failed");
    } finally {
      setPhase("idle");
      setElapsed(0);
      setExportPct(0);
    }
  }, []);

  const start = useCallback(() => {
    try {
      const handle = startRecording({ withAudio });
      handleRef.current = handle;
      setPhase("recording");
      setElapsed(0);
      const loop = () => {
        const h = handleRef.current;
        if (!h) return;
        const ms = h.getDuration();
        setElapsed(ms);
        if (ms >= MAX_DURATION_MS) {
          toast.message("10 minute cap reached — stopping recording");
          void stop();
          return;
        }
        tickRef.current = requestAnimationFrame(loop);
      };
      tickRef.current = requestAnimationFrame(loop);
      if (!handle.hasAudio && withAudio) {
        toast.message("no audio source — recording video only");
      }
    } catch (err) {
      console.error("[RecordToggle] start failed", err);
      toast.error(
        err instanceof Error ? err.message : "could not start recording",
      );
      handleRef.current = null;
      setPhase("idle");
    }
  }, [stop, withAudio]);

  const toggle = useCallback(() => {
    if (phase === "idle") start();
    else if (phase === "recording") void stop();
  }, [phase, start, stop]);

  useHotkey(HOTKEYS.record, toggle);

  // Anonymous visitors don't get recording — it's a power-user affordance
  // for signed-in sessions only. Hiding (rather than disabling) keeps the
  // chrome cluster tight on the anon landing experience.
  if (!isSignedIn) return null;
  if (!supported) return null;

  const isRecording = phase === "recording";
  const isExporting = phase === "exporting";

  return (
    <div className="pointer-events-auto flex items-center gap-3">
      <button
        type="button"
        onClick={() => persistAudioPref(!withAudio)}
        disabled={phase !== "idle"}
        aria-label={withAudio ? "Disable audio in recording" : "Enable audio in recording"}
        className={cn(
          "flex items-center font-sans text-[10px] uppercase tracking-[0.28em] transition-colors disabled:opacity-40",
          withAudio
            ? "text-[color:var(--stone)] hover:text-[color:var(--paper)]"
            : "text-[color:var(--stone)]/50 hover:text-[color:var(--paper)]",
        )}
      >
        {withAudio ? (
          <Volume2 className="size-3" strokeWidth={1.5} />
        ) : (
          <VolumeX className="size-3" strokeWidth={1.5} />
        )}
      </button>
      <button
        type="button"
        onClick={toggle}
        disabled={isExporting}
        aria-label={isRecording ? "Stop recording" : "Start recording"}
        className={cn(
          "flex items-center gap-1.5 font-sans text-[10px] uppercase tracking-[0.28em] transition-colors disabled:cursor-wait",
          isRecording
            ? "text-[color:var(--signal)] hover:text-[color:var(--paper)]"
            : "text-[color:var(--stone)] hover:text-[color:var(--paper)]",
          isExporting && "text-[color:var(--stone)]/60",
        )}
      >
        <Circle
          className={cn("size-3", isRecording && "animate-pulse")}
          strokeWidth={1.5}
          fill={isRecording ? "currentColor" : "none"}
        />
        <span
          className={cn(
            // Always show the saving / elapsed counter; hide the resting
            // "rec · r" label on narrow screens to keep the top bar tight.
            (!isExporting && !isRecording) && "hidden sm:inline",
          )}
        >
          {isExporting
            ? `saving ${exportPct}%`
            : isRecording
              ? formatDuration(elapsed)
              : "rec · r"}
        </span>
      </button>
    </div>
  );
}
