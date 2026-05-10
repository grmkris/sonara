"use client";

import { useCallback, useEffect, useRef } from "react";
import type { SessionSend } from "@/lib/session-actions";
import { useVoiceRecognition } from "@/hooks/use-voice-recognition";
import { useVisualizerStore } from "@/stores/visualizer-store";
import { cn } from "@/lib/utils";

interface VoiceListenProps {
  send: SessionSend;
}

// Voice toggle. Uses the browser's Web Speech API — no server-side STT
// (Deepgram was removed; Web Speech is good enough for short scene-control
// phrases in Chrome/Edge/Safari, and the only path we still ship).
//
// Two modes, both purely client-side:
//   "live" — recognition runs continuously while toggled on. Browser emits
//            finals on natural pause; we forward them as voice.phrase.
//   "ptt"  — recognition starts on SPACE keydown, stops on keyup. The browser
//            emits a final on stop; same forwarding path. Holds the mic gate
//            tightly so ambient speech in multi-person rooms never reaches
//            the LLM.
export function VoiceListen({ send }: VoiceListenProps) {
  const onPhrase = useCallback(
    (text: string) => send({ type: "voice.phrase", text }),
    [send],
  );
  const onPartial = useCallback(
    (opts: { text: string; isFinal: boolean; confidence?: number }) =>
      send({
        type: "voice.partial",
        text: opts.text,
        isFinal: opts.isFinal,
        provider: "web-speech",
        ...(typeof opts.confidence === "number"
          ? { confidence: opts.confidence }
          : {}),
      }),
    [send],
  );
  const { supported, listening, error, start, stop } = useVoiceRecognition({
    onPhrase,
    onPartial,
  });

  const voiceMode = useVisualizerStore((s) => s.voiceMode);
  const setVoiceMode = useVisualizerStore((s) => s.setVoiceMode);
  const voicePtt = useVisualizerStore((s) => s.voicePtt);
  const setVoicePtt = useVisualizerStore((s) => s.setVoicePtt);

  // In Live mode the user toggles the mic with the button. In PTT mode the
  // button arms the path (so SPACE is wired up) but actual recognition only
  // runs while space is held — `armed` reflects the user's intent, `listening`
  // reflects whether the recogniser is currently active.
  const armed = voiceMode === "live" ? listening : listening || voicePtt;

  const onMicToggle = () => {
    if (!supported) return;
    if (listening) stop();
    else void start();
  };

  // PTT: when armed, SPACE keydown/keyup drive recognition.start/stop directly.
  // When unsupported recognition keeps "listening=false" so this is dormant.
  const pttArmed = voiceMode === "ptt" && (listening || voicePtt);
  usePushToTalk(
    pttArmed,
    () => {
      setVoicePtt(true);
      void start();
    },
    () => {
      setVoicePtt(false);
      stop();
    },
  );

  // Switching from live → ptt while listening drops the mic so the user has
  // to press space to resume. Switching ptt → live arms continuous listening.
  const cycleMode = () => {
    const next: "live" | "ptt" = voiceMode === "live" ? "ptt" : "live";
    if (listening) stop();
    setVoicePtt(false);
    setVoiceMode(next);
  };

  const disabled = !supported;

  return (
    <div className="flex flex-col gap-1 font-sans">
      <div className="flex items-baseline gap-3">
        <button
          type="button"
          onClick={onMicToggle}
          disabled={disabled}
          title={
            disabled
              ? "Speech recognition isn't supported in this browser (Chrome/Edge/Safari)."
              : listening
                ? "Stop listening"
                : "Start listening"
          }
          className={cn(
            "group flex items-baseline gap-2 rounded-sm px-2 py-1 transition-colors",
            disabled
              ? "text-[color:var(--stone)]/40 cursor-not-allowed"
              : armed
                ? "text-[color:var(--paper)]"
                : "text-[color:var(--stone)] hover:text-[color:var(--paper)]",
            voicePtt &&
              "outline outline-1 outline-[color:var(--signal)]/70 animate-pulse",
          )}
        >
          <span className="font-serif text-[13px] leading-none">
            {armed ? "●" : "○"}
          </span>
          <span className="font-serif text-[13px]">voice</span>
          {armed && (
            <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-[color:var(--stone)]">
              {voiceMode === "ptt"
                ? voicePtt
                  ? "held"
                  : "armed"
                : "listening"}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={cycleMode}
          title={
            voiceMode === "live"
              ? "Switch to push-to-talk (hold SPACE)"
              : "Switch to live listening"
          }
          className={cn(
            "font-mono text-[9px] uppercase tracking-[0.22em] transition-colors",
            "text-[color:var(--stone)] hover:text-[color:var(--paper)]",
          )}
        >
          mode · {voiceMode}
        </button>
      </div>

      {voiceMode === "ptt" && armed && !voicePtt && (
        <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-[color:var(--stone)]/70">
          hold space to speak
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

// Push-to-talk keyboard handler. SPACE keydown → fire onStart; keyup → onEnd.
// Guarded against input/textarea/contenteditable focus so the prompt input
// still takes spaces. `repeat` events from held keys are ignored. A safety
// timer forces release after MAX_PTT_MS in case keyup is lost (blur, focus
// loss, etc.).
const MAX_PTT_MS = 15_000;
function usePushToTalk(
  enabled: boolean,
  onStart: () => void,
  onEnd: () => void,
): void {
  const heldRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const release = useCallback(() => {
    if (!heldRef.current) return;
    heldRef.current = false;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    onEnd();
  }, [onEnd]);

  useEffect(() => {
    if (!enabled) {
      if (heldRef.current) release();
      return;
    }

    const isTypingTarget = (t: EventTarget | null): boolean => {
      if (!(t instanceof HTMLElement)) return false;
      const tag = t.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      if (t.isContentEditable) return true;
      return false;
    };

    const onDown = (ev: KeyboardEvent) => {
      if (ev.code !== "Space") return;
      if (ev.repeat) return;
      if (isTypingTarget(ev.target)) return;
      ev.preventDefault();
      if (heldRef.current) return;
      heldRef.current = true;
      timerRef.current = setTimeout(release, MAX_PTT_MS);
      onStart();
    };
    const onUp = (ev: KeyboardEvent) => {
      if (ev.code !== "Space") return;
      if (!heldRef.current) return;
      ev.preventDefault();
      release();
    };
    const onBlur = () => release();

    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [enabled, onStart, release]);
}
