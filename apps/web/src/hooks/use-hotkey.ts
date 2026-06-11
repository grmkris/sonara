"use client";

import { useEffect } from "react";

type Handler = (ev: KeyboardEvent) => void;

/**
 * Single-key hotkey binding. Skips the callback when a modifier (ctrl/meta/alt)
 * is held and when focus is inside an editable element.
 */
export const useHotkey = (key: string, handler: Handler): void => {
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.ctrlKey || ev.metaKey || ev.altKey) {
        return;
      }
      if (ev.key.toLowerCase() !== key.toLowerCase()) {
        return;
      }
      const target = ev.target as HTMLElement | null;
      // Allow Esc to bubble out of inputs, swallow everything else.
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable) &&
        ev.key !== "Escape"
      ) {
        return;
      }
      handler(ev);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [key, handler]);
};
