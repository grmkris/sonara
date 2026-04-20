"use client";

import { useCallback } from "react";
import type { ClientEvent } from "@music-visualizer/shared";
import { useVoiceRecognition } from "@/hooks/use-voice-recognition";
import { cn } from "@/lib/utils";

interface VoiceListenProps {
  send: (event: ClientEvent) => void;
}

// Toggle for continuous speech recognition. Streams final transcripts up to
// the server as voice.phrase events. Visually matches the mic/file buttons in
// MusicSource: one glyph + small English caption + optional last-heard text
// beneath.
export function VoiceListen({ send }: VoiceListenProps) {
  const onPhrase = useCallback(
    (text: string) => send({ type: "voice.phrase", text }),
    [send],
  );
  const { supported, listening, lastPhrase, error, start, stop } =
    useVoiceRecognition({ onPhrase });

  const toggle = () => {
    if (!supported) return;
    if (listening) stop();
    else start();
  };

  const disabled = !supported;

  return (
    <div className="flex flex-col gap-1 font-sans">
      <button
        type="button"
        onClick={toggle}
        disabled={disabled}
        title={
          disabled
            ? "Speech recognition isn't supported in this browser (Chrome/Safari only)."
            : listening
              ? "Stop listening"
              : "Start listening"
        }
        className={cn(
          "group flex items-baseline gap-2 transition-colors",
          disabled
            ? "text-[color:var(--stone)]/40 cursor-not-allowed"
            : listening
              ? "text-[color:var(--paper)]"
              : "text-[color:var(--stone)] hover:text-[color:var(--paper)]",
        )}
      >
        <span className="font-serif text-[13px] leading-none">
          {listening ? "●" : "○"}
        </span>
        <span className="font-serif text-[13px]">voice</span>
        {listening && (
          <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-[color:var(--stone)]">
            listening
          </span>
        )}
      </button>
      {lastPhrase && (
        <div className="font-mono nums max-w-[280px] truncate text-[10px] italic text-[color:var(--stone)]/80">
          &ldquo;{lastPhrase}&rdquo;
        </div>
      )}
      {error && (
        <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-[color:var(--stone)]">
          {error === "unsupported" ? "not supported" : `error · ${error}`}
        </div>
      )}
    </div>
  );
}
