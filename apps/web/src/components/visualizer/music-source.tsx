"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { FileAudio, Mic, MicOff, MonitorSpeaker } from "lucide-react";
import type { AudioSource } from "@/hooks/use-audio-features";
import { cn } from "@/lib/utils";

interface MusicSourceProps {
  source: AudioSource;
  setSource: (s: AudioSource) => void;
}

// Safari supports getDisplayMedia for video but silently drops audio tracks.
// Detect via UA — the usual "Safari but not Chrome/Edge/Android" pattern.
function isSafariLike(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /^((?!chrome|android|edg|crios|fxios).)*safari/i.test(ua);
}

// getDisplayMedia exists at all (older Firefox / some webviews lack it).
function displayMediaSupported(): boolean {
  if (typeof navigator === "undefined") return false;
  return typeof navigator.mediaDevices?.getDisplayMedia === "function";
}

const COMPUTER_AUDIO_HINT_KEY = "dream.computerAudioHintSeen";

export function MusicSource({ source, setSource }: MusicSourceProps) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  // Display-audio support detection lives in state so SSR renders the
  // optimistic "enabled" path and we correct it post-mount. Running the
  // feature probes during SSR would return `false` (navigator is undefined)
  // and freeze the button in a disabled state in the hydrated DOM.
  const [displaySupported, setDisplaySupported] = useState(true);
  const [displayDisabledReason, setDisplayDisabledReason] = useState<
    string | null
  >(null);

  useEffect(() => {
    if (!displayMediaSupported()) {
      setDisplaySupported(false);
      setDisplayDisabledReason("not supported in this browser");
      return;
    }
    if (isSafariLike()) {
      setDisplaySupported(false);
      setDisplayDisabledReason(
        "safari can't share tab audio — try chrome or edge",
      );
    }
  }, []);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  const pickFile = useCallback(() => {
    fileRef.current?.click();
  }, []);

  const onFile = (ev: React.ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    if (fileRef.current) fileRef.current.value = "";
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;
    setFileName(file.name);
    const el = audioRef.current;
    if (!el) return;
    el.src = url;
    el.loop = true;
    el.crossOrigin = "anonymous";
    void el.play().catch(() => undefined);
    setSource({ type: "element", element: el });
  };

  const toggleMic = () => {
    if (source.type === "mic") setSource({ type: "none" });
    else setSource({ type: "mic" });
  };

  const toggleDisplay = () => {
    if (source.type === "display") {
      setSource({ type: "none" });
      return;
    }
    // First-time hint: explain the picker flow once. Chrome's share dialog
    // looks intimidating if you've never used it.
    try {
      if (window.localStorage.getItem(COMPUTER_AUDIO_HINT_KEY) !== "1") {
        toast("pick a browser tab and tick 'share tab audio'", {
          description:
            "screen/window sharing often has no audio; a specific tab works best.",
          duration: 5000,
        });
        window.localStorage.setItem(COMPUTER_AUDIO_HINT_KEY, "1");
      }
    } catch {
      // localStorage blocked — skip the hint.
    }
    setSource({ type: "display" });
  };

  const fileLabel = fileName ? truncate(fileName, 22) : "select file";
  const micOn = source.type === "mic";
  const displayOn = source.type === "display";

  return (
    <div className="flex flex-col gap-2 font-sans">
      <div className="flex items-center gap-5 text-[11px] tracking-[0.1em]">
        <button
          type="button"
          onClick={pickFile}
          className={cn(
            "group flex items-center gap-2 transition-colors",
            fileName
              ? "text-[color:var(--paper)]"
              : "text-[color:var(--stone)] hover:text-[color:var(--paper)]",
          )}
        >
          <FileAudio className="size-3.5" strokeWidth={1.5} />
          <span className="font-serif text-[13px] italic">{fileLabel}</span>
        </button>

        <button
          type="button"
          onClick={toggleMic}
          className={cn(
            "group flex items-center gap-2 transition-colors",
            micOn
              ? "text-[color:var(--paper)]"
              : "text-[color:var(--stone)] hover:text-[color:var(--paper)]",
          )}
        >
          {micOn ? (
            <Mic className="size-3.5" strokeWidth={1.5} />
          ) : (
            <MicOff className="size-3.5" strokeWidth={1.5} />
          )}
          <span className="font-sans text-[10px] uppercase tracking-[0.24em]">
            mic
          </span>
        </button>

        <button
          type="button"
          onClick={toggleDisplay}
          disabled={!displaySupported}
          title={displayDisabledReason ?? "share a browser tab's audio"}
          className={cn(
            "group flex items-center gap-2 transition-colors",
            !displaySupported
              ? "cursor-not-allowed text-[color:var(--stone)]/40"
              : displayOn
                ? "text-[color:var(--paper)]"
                : "text-[color:var(--stone)] hover:text-[color:var(--paper)]",
          )}
        >
          <MonitorSpeaker className="size-3.5" strokeWidth={1.5} />
          <span className="font-sans text-[10px] uppercase tracking-[0.24em]">
            computer audio
          </span>
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={onFile}
      />
      <audio
        ref={audioRef}
        controls
        className={cn(
          "h-6 w-full max-w-[280px] opacity-60",
          fileName ? "block" : "hidden",
        )}
      />
    </div>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
