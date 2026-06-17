"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Minimal Web Speech types — not in lib.dom.d.ts by default. Chrome / Safari
// expose the implementation as `webkitSpeechRecognition`.
interface SRAlternative {
  readonly transcript: string;
  readonly confidence?: number;
}
interface SRResult {
  readonly isFinal: boolean;
  readonly length: number;
  item: (index: number) => SRAlternative;
  readonly [index: number]: SRAlternative;
}
interface SRResultList {
  readonly length: number;
  item: (index: number) => SRResult;
  readonly [index: number]: SRResult;
}
interface SREvent {
  readonly resultIndex: number;
  readonly results: SRResultList;
}
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onresult: ((ev: SREvent) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}
type SRConstructor = new () => SpeechRecognitionLike;

const getSR = (): SRConstructor | null => {
  if (typeof window === "undefined") {
    return null;
  }
  const w = window as unknown as {
    SpeechRecognition?: SRConstructor;
    webkitSpeechRecognition?: SRConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

export interface UseVoiceRecognitionOpts {
  /**
   * Fires for every result (interim + final) with the accumulated transcript
   * for the current recognition session. Reset between start() calls — i.e.
   * each PTT burst starts at "". `confidence` is wildly unreliable on Web
   * Speech (often 0 for interim) and treated as advisory.
   */
  onResult: (text: string, isFinal: boolean, confidence?: number) => void;
  lang?: string;
}

export interface VoiceRecognitionState {
  supported: boolean;
  listening: boolean;
  error: string | null;
  start: () => void;
  stop: () => void;
}

/**
 * Web Speech wrapper for short push-to-talk bursts (≤ ~15s). No auto-restart
 * loop — caller invokes start() on keydown, stop() on keyup. `stop()` flushes
 * the pending final; the hook concatenates each `isFinal` chunk into a
 * session buffer so multi-utterance holds don't lose earlier chunks.
 */
export const useVoiceRecognition = (
  opts: UseVoiceRecognitionOpts
): VoiceRecognitionState => {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const onResultRef = useRef(opts.onResult);
  const bufferRef = useRef<string>("");
  useEffect(() => {
    onResultRef.current = opts.onResult;
  }, [opts.onResult]);

  const ensureRecognizer = useCallback((): SpeechRecognitionLike | null => {
    if (recRef.current) {
      return recRef.current;
    }
    const Ctor = getSR();
    if (!Ctor) {
      return null;
    }
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.lang = opts.lang ?? "en-US";

    rec.onstart = () => {
      bufferRef.current = "";
      setListening(true);
    };
    rec.onend = () => {
      setListening(false);
    };
    // oxlint-disable-next-line prefer-add-event-listener -- REVIEW: SpeechRecognitionLike exposes only on* handler props, no addEventListener
    rec.onerror = (ev: unknown) => {
      const code =
        typeof ev === "object" && ev && "error" in ev
          ? String((ev as { error: unknown }).error)
          : "error";
      // `no-speech` / `aborted` are routine PTT outcomes — don't surface.
      if (code !== "no-speech" && code !== "aborted") {
        setError(code);
      }
    };
    rec.onresult = (ev: SREvent) => {
      // Concatenate every result-list entry from the current event. Finalized
      // entries are flushed into the session buffer; the interim tail is
      // appended for display. Web Speech delivers cumulative results across
      // events, so this stays accurate across long bursts.
      let interim = "";
      for (let i = ev.resultIndex; i < ev.results.length; i += 1) {
        const r = ev.results.item(i);
        const alt = r.item(0);
        const text = alt?.transcript?.trim();
        if (!text) {
          continue;
        }
        if (r.isFinal) {
          bufferRef.current = bufferRef.current
            ? `${bufferRef.current} ${text}`
            : text;
        } else {
          interim = interim ? `${interim} ${text}` : text;
        }
      }
      const merged = [bufferRef.current, interim].filter(Boolean).join(" ");
      // Confidence comes from the last result entry — usually the final one
      // when present. Optional and only useful for the latest chunk.
      const last = ev.results.item(ev.results.length - 1);
      const lastAlt = last?.item(0);
      const confidence =
        typeof lastAlt?.confidence === "number"
          ? lastAlt.confidence
          : undefined;
      onResultRef.current(
        merged,
        last?.isFinal ?? false,
        ...(typeof confidence === "number" ? ([confidence] as const) : [])
      );
    };
    recRef.current = rec;
    return rec;
  }, [opts.lang]);

  useEffect(() => {
    setSupported(getSR() !== null);
    return () => {
      const rec = recRef.current;
      if (rec) {
        try {
          rec.abort();
        } catch {
          /* noop */
        }
      }
    };
  }, []);

  const start = useCallback(() => {
    const rec = ensureRecognizer();
    if (!rec) {
      setError("unsupported");
      return;
    }
    setError(null);
    try {
      rec.start();
    } catch {
      // Already running — treat as listening. Can happen on rapid hold-
      // release-hold within ~100ms before the previous session fully ends.
      setListening(true);
    }
  }, [ensureRecognizer]);

  const stop = useCallback(() => {
    const rec = recRef.current;
    if (!rec) {
      return;
    }
    try {
      // flushes pending final; `abort()` would discard it
      rec.stop();
    } catch {
      /* noop */
    }
  }, []);

  return { error, listening, start, stop, supported };
};
