"use client";

import { useCallback, useRef } from "react";
import type { SessionSend } from "@/lib/session-actions";
import { useKeyedPushToTalk } from "@/hooks/use-keyed-push-to-talk";
import { useVoiceRecognition } from "@/hooks/use-voice-recognition";
import { useVisualizerStore } from "@/stores/visualizer-store";
import type { VoiceField } from "@/stores/visualizer/voice-slice";
import { cn } from "@/lib/utils";

interface VoiceListenProps {
  send: SessionSend;
}

// Field-keyed push-to-talk. Hold one of S/E/M/P to set that scene field;
// speak; release to dispatch. Tap R to reset. Mic is on only while a key is
// held — no continuous listening, no LLM disambiguation.
//
// Each held key routes the captured transcript to a specific
// `ClientScenePatch` field, so the patch is unambiguous and fires immediately
// via the `voice` origin (SEMANTIC_THRESHOLD_VOICE = 0.1).
const KEYMAP = {
  KeyS: "subject",
  KeyE: "environment",
  KeyM: "mood",
  KeyP: "palette",
} as const satisfies Record<string, VoiceField>;

const LEGEND: Array<{ key: string; label: string }> = [
  { key: "S", label: "subject" },
  { key: "E", label: "env" },
  { key: "M", label: "mood" },
  { key: "P", label: "palette" },
  { key: "R", label: "reset" },
];

export function VoiceListen({ send }: VoiceListenProps) {
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
    enabled: supported,
    keymap: KEYMAP,
    onHoldStart,
    onHoldEnd,
    tapMap: { KeyR: onReset },
  });

  const armed = activeField !== null || listening;

  return (
    <div className="flex flex-col gap-1 font-sans">
      <div className="flex items-baseline gap-3">
        <span
          className={cn(
            "flex items-baseline gap-2",
            !supported && "text-[color:var(--stone)]/40",
            supported && armed && "text-[color:var(--paper)]",
            supported && !armed && "text-[color:var(--stone)]",
          )}
        >
          <span className="font-serif text-[13px] leading-none">
            {armed ? "●" : "○"}
          </span>
          <span className="font-serif text-[13px]">voice</span>
        </span>
      </div>

      {supported ? (
        <div className="font-mono flex flex-wrap gap-x-2 gap-y-1 text-[9px] uppercase tracking-[0.22em] text-[color:var(--stone)]/80">
          {LEGEND.map((item) => (
            <span key={item.key}>
              <span className="text-[color:var(--paper)]">{item.key}</span>{" "}
              {item.label}
            </span>
          ))}
        </div>
      ) : (
        <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-[color:var(--stone)]">
          not supported
        </div>
      )}

      {activeField && (
        <div
          className={cn(
            "font-mono text-[10px] tracking-[0.04em]",
            "rounded-sm border border-[color:var(--signal)]/70 px-2 py-1",
            "animate-pulse text-[color:var(--paper)]",
          )}
        >
          <span className="uppercase text-[color:var(--signal)]">
            ▼ {activeField}:
          </span>{" "}
          <span>{liveTranscript || "…"}</span>
        </div>
      )}

      {error && supported && (
        <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-[color:var(--signal)]">
          error · {error}
        </div>
      )}
    </div>
  );
}
