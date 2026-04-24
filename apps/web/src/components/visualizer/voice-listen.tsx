"use client";

import { useCallback, useEffect, useRef } from "react";
import type { SessionSend } from "@/lib/session-actions";
import { useAudioCapture } from "@/hooks/use-audio-capture";
import { useVoiceRecognition } from "@/hooks/use-voice-recognition";
import { useVisualizerStore } from "@/stores/visualizer-store";
import { cn } from "@/lib/utils";

interface VoiceListenProps {
  send: SessionSend;
}

// Voice toggle button. Picks the STT path based on what the server reports
// at handshake (state.sttProvider):
//
//   "web-speech"  → browser-native SpeechRecognition; partials sent through
//                   voice.partial procedure, finals through voice.phrase.
//   "deepgram"    → AudioWorklet captures mic at 16k PCM16, base64-encoded
//                   chunks streamed via audio.chunk; server relays to
//                   Deepgram Flux (listen v2) and emits voice.partial events
//                   back. Flux's EndOfTurn events flush the voice debounce
//                   server-side for low-latency commits.
//
// Either way the trail UI sees the same store updates because both paths
// converge on the unified VoiceController on the server.
//
// Voice mode (stored in voiceMode) gates when audio actually reaches the STT:
//   "live" — always forwarding (once the button is on).
//   "ptt"  — hold SPACE to forward; release to flush + commit.
export function VoiceListen({ send }: VoiceListenProps) {
  const sttProvider = useVisualizerStore((s) => s.sttProvider);
  if (sttProvider === "deepgram") return <DeepgramListen send={send} />;
  return <WebSpeechListen send={send} />;
}

// Push-to-talk keyboard handler. SPACE keydown → armed; keyup → release.
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

function WebSpeechListen({ send }: VoiceListenProps) {
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

  return (
    <ModeAwareListen
      providerBadge={null}
      supported={supported}
      listening={listening}
      error={error}
      send={send}
      start={() => {
        if (!supported) return;
        void start();
      }}
      stop={stop}
    />
  );
}

function DeepgramListen({ send }: VoiceListenProps) {
  const onChunk = useCallback(
    (base64: string) => send({ type: "audio.chunk", base64 }),
    [send],
  );
  const onStart = useCallback(
    (opts: { targetSampleRate: 16000 }) =>
      send({ type: "audio.start", sampleRate: opts.targetSampleRate }),
    [send],
  );
  const onStop = useCallback(() => send({ type: "audio.stop" }), [send]);
  const { active, error, start, stop } = useAudioCapture({
    onChunk,
    onStart,
    onStop,
  });

  return (
    <ModeAwareListen
      providerBadge="dg"
      supported={true}
      listening={active}
      error={error}
      send={send}
      start={() => void start()}
      stop={stop}
    />
  );
}

interface ModeAwareListenProps {
  providerBadge: string | null;
  supported: boolean;
  listening: boolean;
  error: string | null;
  send: SessionSend;
  start: () => void;
  stop: () => void;
}

// Renders the mic toggle + Live/PTT mode switch, and owns the PTT keyboard
// hotkey. Shared between WebSpeech and Deepgram paths so mode selection is
// provider-agnostic.
function ModeAwareListen({
  providerBadge,
  supported,
  listening,
  error,
  send,
  start,
  stop,
}: ModeAwareListenProps) {
  const voiceMode = useVisualizerStore((s) => s.voiceMode);
  const setVoiceMode = useVisualizerStore((s) => s.setVoiceMode);
  const voicePtt = useVisualizerStore((s) => s.voicePtt);
  const setVoicePtt = useVisualizerStore((s) => s.setVoicePtt);

  // Notify the server of the current mode on mount and on change. The server
  // adjusts its audio-forward gate to match.
  useEffect(() => {
    send({ type: "voice.mode", mode: voiceMode });
  }, [send, voiceMode]);

  const pttEnabled = voiceMode === "ptt" && listening;
  const pttStart = useCallback(() => {
    setVoicePtt(true);
    send({ type: "voice.ptt.start" });
  }, [send, setVoicePtt]);
  const pttEnd = useCallback(() => {
    setVoicePtt(false);
    send({ type: "voice.ptt.end" });
  }, [send, setVoicePtt]);
  usePushToTalk(pttEnabled, pttStart, pttEnd);

  const cycleMode = () => setVoiceMode(voiceMode === "live" ? "ptt" : "live");

  const disabled = !supported;
  const armed = voiceMode === "live" ? listening : voicePtt;

  return (
    <div className="flex flex-col gap-1 font-sans">
      <div className="flex items-baseline gap-3">
        <button
          type="button"
          onClick={() => {
            if (!supported) return;
            if (listening) stop();
            else start();
          }}
          disabled={disabled}
          title={
            disabled
              ? "Speech recognition isn't supported in this browser (Chrome/Safari only)."
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
            // PTT-held: pulsing accent outline so the user can't miss that the
            // mic is actively forwarding audio to Flux right now.
            voicePtt &&
              "outline outline-1 outline-[color:var(--signal)]/70 animate-pulse",
          )}
        >
          <span className="font-serif text-[13px] leading-none">
            {armed ? "●" : "○"}
          </span>
          <span className="font-serif text-[13px]">voice</span>
          {providerBadge && (
            <span className="font-mono text-[8px] uppercase tracking-[0.22em] text-[color:var(--stone)]/60">
              {providerBadge}
            </span>
          )}
          {armed && (
            <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-[color:var(--stone)]">
              {voiceMode === "ptt" ? "held" : "listening"}
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

      {voiceMode === "ptt" && listening && !voicePtt && (
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
