"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Minimal types for the Web Speech API — not in lib.dom.d.ts by default, and
// the Chrome/Safari implementation is exposed as `webkitSpeechRecognition`.
// We only touch the handful of fields this hook uses.
interface SRAlternative {
  readonly transcript: string;
}
interface SRResult {
  readonly isFinal: boolean;
  readonly length: number;
  item(index: number): SRAlternative;
  readonly [index: number]: SRAlternative;
}
interface SRResultList {
  readonly length: number;
  item(index: number): SRResult;
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
  start(): void;
  stop(): void;
  abort(): void;
}
interface SRConstructor {
  new (): SpeechRecognitionLike;
}

function getSR(): SRConstructor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SRConstructor;
    webkitSpeechRecognition?: SRConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface VoiceRecognitionState {
  supported: boolean;
  listening: boolean;
  lastPhrase: string | null;
  error: string | null;
  start: () => void;
  stop: () => void;
}

export interface UseVoiceRecognitionOpts {
  onPhrase: (text: string) => void;
  lang?: string;
}

// Continuous SpeechRecognition. Chrome drops the recognizer every ~60s on its
// own, so we auto-restart in `onend` while still enabled. Only final results
// are propagated upward — interim results are ignored to keep downstream
// processing simple.
export function useVoiceRecognition(
  opts: UseVoiceRecognitionOpts,
): VoiceRecognitionState {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [lastPhrase, setLastPhrase] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const wantsListenRef = useRef(false);
  const onPhraseRef = useRef(opts.onPhrase);
  useEffect(() => {
    onPhraseRef.current = opts.onPhrase;
  }, [opts.onPhrase]);

  // Lazy-init recognition object on first use (requires window).
  const ensureRecognizer = useCallback((): SpeechRecognitionLike | null => {
    if (recRef.current) return recRef.current;
    const Ctor = getSR();
    if (!Ctor) return null;
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.lang = opts.lang ?? "en-US";
    rec.onstart = () => setListening(true);
    rec.onend = () => {
      setListening(false);
      // Auto-restart if still wanted (Chrome drops recognition ~60s).
      if (wantsListenRef.current) {
        try {
          rec.start();
        } catch {
          // start() may throw if called too quickly — schedule next tick.
          setTimeout(() => {
            if (wantsListenRef.current) {
              try {
                rec.start();
              } catch {
                /* noop */
              }
            }
          }, 250);
        }
      }
    };
    rec.onerror = (ev: unknown) => {
      const code =
        typeof ev === "object" && ev && "error" in ev
          ? String((ev as { error: unknown }).error)
          : "error";
      // `no-speech` and `aborted` are routine — don't surface.
      if (code !== "no-speech" && code !== "aborted") setError(code);
    };
    rec.onresult = (ev: SREvent) => {
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results.item(i);
        if (!r.isFinal) continue;
        const alt = r.item(0);
        const text = alt?.transcript?.trim();
        if (!text) continue;
        setLastPhrase(text);
        setError(null);
        onPhraseRef.current(text);
      }
    };
    recRef.current = rec;
    return rec;
  }, [opts.lang]);

  useEffect(() => {
    setSupported(getSR() !== null);
    return () => {
      wantsListenRef.current = false;
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
    wantsListenRef.current = true;
    try {
      rec.start();
    } catch {
      // Already running — treat as listening.
      setListening(true);
    }
  }, [ensureRecognizer]);

  const stop = useCallback(() => {
    wantsListenRef.current = false;
    const rec = recRef.current;
    if (!rec) return;
    try {
      rec.stop();
    } catch {
      /* noop */
    }
    setListening(false);
  }, []);

  return { supported, listening, lastPhrase, error, start, stop };
}
