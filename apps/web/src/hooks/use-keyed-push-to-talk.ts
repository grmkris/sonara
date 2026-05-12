"use client";

import { useCallback, useEffect, useRef } from "react";

type KeyCode = string; // `KeyboardEvent.code` — e.g. "KeyS", "KeyE", "KeyR".

export interface KeyedPushToTalkOpts<F extends string> {
  /** Map of physical-key code → field name. Only these keys arm the mic. */
  keymap: Record<KeyCode, F>;
  /** Fires on keydown of a mapped key. */
  onHoldStart: (field: F) => void;
  /** Fires on keyup / blur / visibilitychange / safety-timer. Idempotent. */
  onHoldEnd: (field: F) => void;
  /** One-shot tap actions (KeyR → reset, etc.). Fire on keydown; ignored while a hold is active. */
  tapMap?: Record<KeyCode, () => void>;
  /** Safety release after this many ms in case keyup is lost. */
  maxHoldMs?: number;
  /** When false, the hook is dormant (e.g. recognition unsupported). */
  enabled?: boolean;
}

const DEFAULT_MAX_HOLD_MS = 15_000;

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return t.isContentEditable;
}

/**
 * Keyboard-keyed push-to-talk. Holding one of the mapped keys arms a single
 * field's PTT; releasing fires onHoldEnd. First-key-wins — additional PTT or
 * tap keypresses are ignored until the active hold releases. Tap actions only
 * fire when no PTT key is held. Modifier keys (Cmd / Ctrl / Alt) bypass the
 * hook so OS / browser shortcuts still work.
 */
export function useKeyedPushToTalk<F extends string>(
  opts: KeyedPushToTalkOpts<F>,
): void {
  const {
    keymap,
    onHoldStart,
    onHoldEnd,
    tapMap,
    maxHoldMs = DEFAULT_MAX_HOLD_MS,
    enabled = true,
  } = opts;

  // Ref-store callbacks so the effect doesn't re-bind on every render — the
  // caller's onHoldEnd typically closes over the live transcript.
  const onHoldStartRef = useRef(onHoldStart);
  const onHoldEndRef = useRef(onHoldEnd);
  const keymapRef = useRef(keymap);
  const tapMapRef = useRef(tapMap);
  useEffect(() => {
    onHoldStartRef.current = onHoldStart;
  }, [onHoldStart]);
  useEffect(() => {
    onHoldEndRef.current = onHoldEnd;
  }, [onHoldEnd]);
  useEffect(() => {
    keymapRef.current = keymap;
  }, [keymap]);
  useEffect(() => {
    tapMapRef.current = tapMap;
  }, [tapMap]);

  const heldCodeRef = useRef<KeyCode | null>(null);
  const heldFieldRef = useRef<F | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const release = useCallback(() => {
    if (heldCodeRef.current === null) return;
    const field = heldFieldRef.current;
    heldCodeRef.current = null;
    heldFieldRef.current = null;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (field !== null) onHoldEndRef.current(field);
  }, []);

  useEffect(() => {
    if (!enabled) {
      if (heldCodeRef.current !== null) release();
      return;
    }

    const onDown = (ev: KeyboardEvent) => {
      if (ev.repeat) return;
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
      if (isTypingTarget(ev.target)) return;

      // First-key-wins: any other key during a hold is ignored.
      if (heldCodeRef.current !== null) return;

      const field = keymapRef.current[ev.code];
      if (field !== undefined) {
        ev.preventDefault();
        heldCodeRef.current = ev.code;
        heldFieldRef.current = field;
        timerRef.current = setTimeout(release, maxHoldMs);
        onHoldStartRef.current(field);
        return;
      }
      const tap = tapMapRef.current?.[ev.code];
      if (tap) {
        ev.preventDefault();
        tap();
      }
    };

    const onUp = (ev: KeyboardEvent) => {
      if (ev.code !== heldCodeRef.current) return;
      ev.preventDefault();
      release();
    };

    const onBlur = () => release();
    const onVisibility = () => {
      if (document.hidden) release();
    };

    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibility);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [enabled, maxHoldMs, release]);
}
