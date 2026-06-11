"use client";

import { useCallback, useRef } from "react";

const LONG_PRESS_MS = 400;
const MOVE_TOLERANCE_PX = 8;

// Google-Photos-style touch entry into selection: hold a tile ~400ms to
// toggle it. Pointer-events based; cancels on movement (scrolling) or
// release. Returns handlers to spread onto the tile, plus a "did fire" check
// so the subsequent click event can be swallowed.
export const useLongPress = (onLongPress: () => void) => {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const originRef = useRef<{ x: number; y: number } | null>(null);
  const firedRef = useRef(false);

  const cancel = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    originRef.current = null;
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.pointerType !== "touch") {
        return;
      }
      firedRef.current = false;
      originRef.current = { x: e.clientX, y: e.clientY };
      timerRef.current = setTimeout(() => {
        firedRef.current = true;
        timerRef.current = null;
        onLongPress();
      }, LONG_PRESS_MS);
    },
    [onLongPress]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const origin = originRef.current;
      if (!origin) {
        return;
      }
      const dx = e.clientX - origin.x;
      const dy = e.clientY - origin.y;
      if (Math.hypot(dx, dy) > MOVE_TOLERANCE_PX) {
        cancel();
      }
    },
    [cancel]
  );

  // The click that follows a fired long-press must not ALSO toggle/inspect.
  const consumeFired = useCallback(() => {
    const fired = firedRef.current;
    firedRef.current = false;
    return fired;
  }, []);

  return {
    consumeFired,
    handlers: {
      onPointerCancel: cancel,
      onPointerDown,
      onPointerMove,
      onPointerUp: cancel,
    },
  };
};
