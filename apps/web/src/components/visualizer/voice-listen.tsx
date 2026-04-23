"use client";

import { useCallback, useEffect, useState } from "react";
import type { SessionSend } from "@/lib/session-actions";
import { useVoiceRecognition } from "@/hooks/use-voice-recognition";
import { cn } from "@/lib/utils";

interface VoiceListenProps {
  send: SessionSend;
}

// Rotating "try: …" hints shown beneath the listening indicator. Rotate every
// 4 s. Seed of examples that exercise every voice path: subject change,
// mood change, palette, intensity, commit, scene template, reset.
const HINTS: readonly string[] = [
  "try: \u201Ca heron over grey water\u201D",
  "try: \u201Cmake it colder\u201D",
  "try: \u201Cpalette of rust and bone\u201D",
  "try: \u201Cpull the intensity back\u201D",
  "try: \u201Ccommit this\u201D",
  "try: \u201Cpreset forest\u201D",
  "try: \u201Ctry the cathedral one\u201D",
  "try: \u201Cstart over\u201D",
];
const HINT_INTERVAL_MS = 4000;

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

  const [hintIdx, setHintIdx] = useState(0);
  useEffect(() => {
    if (!listening) return;
    const id = setInterval(() => {
      setHintIdx((i) => (i + 1) % HINTS.length);
    }, HINT_INTERVAL_MS);
    return () => clearInterval(id);
  }, [listening]);

  const hint = HINTS[hintIdx] ?? HINTS[0]!;

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
          {listening ? "\u25CF" : "\u25CB"}
        </span>
        <span className="font-serif text-[13px]">voice</span>
        {listening && (
          <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-[color:var(--stone)]">
            listening
          </span>
        )}
      </button>
      {listening && !lastPhrase && (
        <div
          key={hintIdx}
          className="font-mono max-w-[280px] truncate text-[10px] italic text-[color:var(--stone)]/60"
          style={{ animation: "log-fade 600ms ease forwards" }}
        >
          {hint}
        </div>
      )}
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
