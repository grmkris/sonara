"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AudioSource } from "@/hooks/use-audio-features";
import { cn } from "@/lib/utils";

interface MusicSourceProps {
  source: AudioSource;
  setSource: (s: AudioSource) => void;
  micError: string | null;
  clearMicError: () => void;
}

export function MusicSource({
  source,
  setSource,
  micError,
  clearMicError,
}: MusicSourceProps) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  // Revoke any dangling object URL on unmount.
  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  const pickFile = useCallback(() => {
    clearMicError();
    fileRef.current?.click();
  }, [clearMicError]);

  const onFile = (ev: React.ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    // Allow the user to re-pick the same filename.
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
    clearMicError();
    if (source.type === "mic") setSource({ type: "none" });
    else setSource({ type: "mic" });
  };

  const fileLabel = fileName
    ? truncate(fileName, 22)
    : "select file";

  const micOn = source.type === "mic";

  return (
    <div className="flex flex-col gap-2 font-kaku">
      <div className="flex items-center gap-5 text-[11px] tracking-[0.1em]">
        <button
          type="button"
          onClick={pickFile}
          className={cn(
            "group flex items-baseline gap-2 transition-colors",
            fileName
              ? "text-[color:var(--paper)]"
              : "text-[color:var(--stone)] hover:text-[color:var(--paper)]",
          )}
        >
          <span className="font-mincho text-[13px] leading-none">▷</span>
          <span className="font-mincho text-[13px] italic">{fileLabel}</span>
        </button>

        <button
          type="button"
          onClick={toggleMic}
          className={cn(
            "group flex items-baseline gap-2 transition-colors",
            micOn
              ? "text-[color:var(--paper)]"
              : "text-[color:var(--stone)] hover:text-[color:var(--paper)]",
          )}
        >
          <span className="font-mincho text-[13px] leading-none">
            {micOn ? "●" : "○"}
          </span>
          <span className="font-kaku text-[10px] uppercase tracking-[0.24em]">
            mic
          </span>
        </button>

        {micError && (
          <span className="font-plex text-[9px] uppercase tracking-[0.2em] text-[color:var(--hanko)]">
            denied · {micError}
          </span>
        )}
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
