"use client";

import { MAX_PROMPT_CHARS } from "@sonara/shared";
import { useCallback, useEffect, useRef, useState } from "react";

import { useVoiceRecognition } from "@/hooks/use-voice-recognition";
import { flashCommit } from "@/lib/commit-flash";
import type { SessionSend } from "@/lib/session-actions";
import { cn } from "@/lib/utils";
import { useVisualizerStore } from "@/stores/visualizer";

import { ImageAnchorZone } from "./image-anchor-zone";

interface PromptInputProps {
  send: SessionSend;
}

// Single textarea — the user's whole scene description as one sentence.
// Enter commits; Shift+Enter inserts a newline. Mic button toggles
// tap-to-dictate: spoken text streams into the textarea as draft so the
// user can review + edit before pressing Enter to commit.
//
// Typed commits go via `scene.patch`; voice-dictated commits go via
// `voice.patch` so the server's lower semantic-diff threshold for voice
// still applies. We track `lastDraftFromVoice` to decide which message
// type to send on commit.
export const PromptInput = ({ send }: PromptInputProps) => {
  const scene = useVisualizerStore((s) => s.scene);
  const status = useVisualizerStore((s) => s.status);
  const isListening = useVisualizerStore((s) => s.isListening);
  const setIsListening = useVisualizerStore((s) => s.setIsListening);
  const liveTranscript = useVisualizerStore((s) => s.liveTranscript);
  const setLiveTranscript = useVisualizerStore((s) => s.setLiveTranscript);
  const source = useVisualizerStore((s) => s.source);
  const setSource = useVisualizerStore((s) => s.setSource);
  const anchorImageUrl = useVisualizerStore((s) => s.anchorImageUrl);

  const [draft, setDraft] = useState<string | null>(null);
  const lastDraftFromVoiceRef = useRef(false);
  const lastSentRef = useRef<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Reconcile draft with server-echoed scene state. As soon as the server
  // echoes any prompt back after our send, clear the optimistic draft so
  // the textarea reads from `scene.prompt`. Compares against the exact
  // value we last sent (not strict equality with scene.prompt) so server
  // normalisation doesn't leave the draft stuck.
  useEffect(() => {
    if (draft === null) {
      return;
    }
    const sent = lastSentRef.current;
    if (sent !== null && scene.prompt !== undefined) {
      // Any echo with a defined prompt clears the draft.
      setDraft(null);
      lastSentRef.current = null;
    }
  }, [scene.prompt, draft]);

  // Voice recognition — interim transcript streams into the draft so the
  // user sees the words appear in the textarea. On stop, the final
  // transcript stays as a draft for the user to review.
  const handleVoiceResult = useCallback(
    (text: string) => {
      lastDraftFromVoiceRef.current = true;
      setDraft(text);
      setLiveTranscript(text);
    },
    [setLiveTranscript]
  );

  const { supported, start, stop } = useVoiceRecognition({
    onResult: handleVoiceResult,
  });

  const onMicToggle = useCallback(() => {
    if (!supported) {
      return;
    }
    if (isListening) {
      stop();
      setIsListening(false);
    } else {
      lastDraftFromVoiceRef.current = true;
      setDraft("");
      setLiveTranscript("");
      start();
      setIsListening(true);
      textareaRef.current?.focus();
    }
  }, [isListening, supported, start, stop, setIsListening, setLiveTranscript]);

  const commit = useCallback(
    (value: string) => {
      const next = value.trim();
      if (next.length === 0) {
        return;
      }
      // The dedupe guards only apply while already live — "same prompt" used
      // to mean "already showing it", but with switchable sources an
      // identical prompt must still leave a playing deck/set and go live
      // (the server remembers scene.prompt across reconnects).
      const leavingPlayback = source.kind === "deck" || source.kind === "set";
      if (!leavingPlayback && next === scene.prompt) {
        return;
      }
      if (!leavingPlayback && lastSentRef.current === next) {
        return;
      }
      lastSentRef.current = next;

      if (leavingPlayback) {
        // Leaving playback → go live. Seed the first generated frame off the
        // frame currently on screen so the visuals evolve out of it ("take
        // it from there"); flipping the source stops the playback loop (its
        // effect keys on the source).
        const frame = useVisualizerStore.getState().currentFrame;
        const seedFrameUrl = frame
          ? new URL(frame, window.location.origin).href
          : null;
        setSource({ kind: "live" });
        send({ prompt: next, seedFrameUrl, type: "session.goLive" });
      } else {
        const messageType: "voice.patch" | "scene.patch" =
          lastDraftFromVoiceRef.current ? "voice.patch" : "scene.patch";
        setSource({ kind: "live" });
        send({ patch: { prompt: next }, type: messageType });
      }
      lastDraftFromVoiceRef.current = false;
      flashCommit();
    },
    [scene.prompt, send, source.kind, setSource]
  );

  const onChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    lastDraftFromVoiceRef.current = false;
    setDraft(e.target.value);
  }, []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const value = draft ?? scene.prompt;
        commit(value);
      }
    },
    [draft, scene.prompt, commit]
  );

  const value = draft ?? scene.prompt ?? "";
  const isRunning = status === "running";

  // Collapsed by default — the composer is authoring chrome, and the canvas
  // is the product. One line summarizes the scene (+ anchor); a click expands
  // to the full textarea + anchor zone. Stays expanded while dictating.
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (expanded) {
      textareaRef.current?.focus();
    }
  }, [expanded]);

  if (!(expanded || isListening)) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        aria-label="describe the scene"
        className="focus-ring flex w-full items-center gap-2 border border-[color:var(--hairline)]/30 px-3 py-2 text-left transition-colors hover:border-[color:var(--paper)]/50"
      >
        <span aria-hidden className="text-[color:var(--stone)]">
          ✎
        </span>
        <span
          className={cn(
            "min-w-0 flex-1 truncate font-serif text-[13px]",
            value.trim()
              ? "text-[color:var(--paper)]/85"
              : "text-[color:var(--stone)]/60 italic"
          )}
        >
          {value.trim() || "describe the scene…"}
        </span>
        {anchorImageUrl && (
          <span
            aria-label="anchor image set"
            className="size-1.5 shrink-0 rounded-full bg-[color:var(--signal)]"
          />
        )}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setExpanded(false)}
          aria-label="collapse the scene composer"
          className="focus-ring font-sans text-[9px] uppercase tracking-[0.28em] text-[color:var(--stone)] transition-colors hover:text-[color:var(--paper)]"
        >
          scene · ▴
        </button>
        {supported && (
          <button
            type="button"
            onClick={onMicToggle}
            className={cn(
              "font-sans text-[10px] uppercase tracking-[0.18em] px-2 py-0.5 border-b transition-colors",
              isListening
                ? "text-[color:var(--signal)] border-[color:var(--signal)] animate-pulse"
                : "text-[color:var(--stone)] border-[color:var(--hairline)]/30 hover:text-[color:var(--paper)] hover:border-[color:var(--paper)]/60"
            )}
            aria-label={isListening ? "stop dictation" : "start dictation"}
          >
            {isListening ? "● mic" : "○ mic"}
          </button>
        )}
      </div>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={onChange}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setExpanded(false);
            return;
          }
          onKeyDown(e);
        }}
        rows={3}
        maxLength={MAX_PROMPT_CHARS}
        aria-label="scene prompt"
        placeholder="describe the scene… e.g. a deer at the edge of a clearing, hushed and reverent, moss green and gold"
        className={cn(
          "w-full resize-none bg-transparent border border-[color:var(--hairline)]/40 px-3 py-2",
          "font-serif text-[14px] leading-[1.4] text-[color:var(--paper)] placeholder:text-[color:var(--stone)]/50",
          "focus:outline-none focus:border-[color:var(--paper)]/60 transition-colors",
          isRunning && "opacity-90"
        )}
      />
      {isListening && (
        <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-[color:var(--signal)]">
          ▼ listening · {liveTranscript || "…"}
        </span>
      )}
      <ImageAnchorZone send={send} />
    </div>
  );
};
