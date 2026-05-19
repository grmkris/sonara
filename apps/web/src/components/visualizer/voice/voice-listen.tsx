"use client";

import { useCallback, useRef } from "react";
import type { SessionSend } from "@/lib/session-actions";
import { useSession } from "@/lib/auth-client";
import { useKeyedPushToTalk } from "@/hooks/use-keyed-push-to-talk";
import { useVoiceRecognition } from "@/hooks/use-voice-recognition";
import { useVisualizerStore } from "@/stores/visualizer";
import type { VoiceField } from "@/stores/visualizer/voice-slice";
import { PTT_KEYMAP } from "@/lib/scene-fields";
import { cn } from "@/lib/utils";

interface VoiceListenProps {
  send: SessionSend;
}

// Field-keyed push-to-talk. Hold one of S/E/M/P to set that scene field;
// speak; release to dispatch. Tap R to reset. Mic is on only while a key is
// held — no continuous listening, no LLM disambiguation. Key hints live
// inline in PromptInput labels; this strip just shows the live indicator.

export function VoiceListen({ send }: VoiceListenProps) {
  const { data: sessionData } = useSession();
  const isSignedIn = !!sessionData?.session;
  const activeField = useVisualizerStore((s) => s.activeField);
  const liveTranscript = useVisualizerStore((s) => s.liveTranscript);
  const setActiveField = useVisualizerStore((s) => s.setActiveField);
  const setLiveTranscript = useVisualizerStore((s) => s.setLiveTranscript);

  // Accumulator we trust during release — store state inside callbacks would
  // close over a stale value because the hook deps are kept stable on purpose.
  const transcriptRef = useRef<string>("");

  const onResult = useCallback(
    (text: string) => {
      transcriptRef.current = text;
      setLiveTranscript(text);
    },
    [setLiveTranscript],
  );

  const { supported, listening, error, start, stop } = useVoiceRecognition({
    onResult,
  });

  const onHoldStart = useCallback(
    (field: VoiceField) => {
      transcriptRef.current = "";
      setLiveTranscript("");
      setActiveField(field);
      start();
    },
    [setActiveField, setLiveTranscript, start],
  );

  const onHoldEnd = useCallback(
    (field: VoiceField) => {
      stop();
      const finalText = transcriptRef.current.trim();
      setActiveField(null);
      setLiveTranscript("");
      if (finalText) {
        send({ type: "voice.patch", patch: { [field]: finalText } });
      }
    },
    [send, setActiveField, setLiveTranscript, stop],
  );

  const onReset = useCallback(() => {
    send({ type: "session.reset" });
  }, [send]);

  useKeyedPushToTalk<VoiceField>({
    enabled: supported && isSignedIn,
    keymap: PTT_KEYMAP,
    onHoldStart,
    onHoldEnd,
    tapMap: { KeyR: onReset },
  });

  // Hide for anonymous visitors. The hold-to-talk hooks above are wired to
  // `isSignedIn`, so even if a key gets through nothing fires.
  if (!isSignedIn) return null;

  const armed = activeField !== null || listening;

  return (
    <div className="group relative flex items-center gap-3 font-sans">
      <span
        className={cn(
          "flex items-baseline gap-1.5",
          !supported && "text-[color:var(--stone)]/40",
          supported && armed && "text-[color:var(--paper)]",
          supported && !armed && "text-[color:var(--stone)]",
        )}
      >
        <span className="font-serif text-[13px] leading-none">
          {armed ? "●" : "○"}
        </span>
        <span className="font-sans text-[10px] uppercase tracking-[0.22em]">
          voice
        </span>
      </span>

      {!supported && (
        <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-[color:var(--stone)]/50">
          n/a
        </span>
      )}

      {/* In-flight transcript bubble — only when a key is held. Floats above
         the strip so it doesn't push other rows when it appears. */}
      {activeField && (
        <div
          className={cn(
            "font-mono pointer-events-none absolute -top-9 left-0 text-[10px] tracking-[0.04em]",
            "rounded-sm border border-[color:var(--signal)]/70 bg-[color:var(--ink)]/85 px-2 py-1 backdrop-blur-sm",
            "animate-pulse text-[color:var(--paper)] whitespace-nowrap",
          )}
        >
          <span className="uppercase text-[color:var(--signal)]">
            ▼ {activeField}:
          </span>{" "}
          <span>{liveTranscript || "…"}</span>
        </div>
      )}

      {error && supported && (
        <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-[color:var(--signal)]">
          err · {error}
        </span>
      )}
    </div>
  );
}
