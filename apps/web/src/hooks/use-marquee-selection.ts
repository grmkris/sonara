"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

import type { TileRect } from "@/hooks/use-tile-registry";

// Rubber-band selection over a scrollable tile surface. Hand-rolled: the
// interesting part is hit-testing against measured tile rects, which we need
// anyway — a library would only draw the box.
//
// Coexistence with native-HTML5 drag (pragmatic, C5): pointer-down BAILS when
// it lands on a tile/control (`[data-frame-tile], button, a, input`), so a
// tile drag never arms the marquee; whitespace can't start an element drag
// because nothing draggable is under it. Different event families — no
// listener fights. `enabled=false` while a pragmatic drag is in flight is the
// belt-and-braces.

const DRAG_THRESHOLD_PX = 4;
const EDGE_SCROLL_ZONE_PX = 28;
const EDGE_SCROLL_MAX_PX_PER_FRAME = 14;

export interface MarqueeRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const intersects = (a: MarqueeRect, b: TileRect["rect"]): boolean =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

export const useMarqueeSelection = (opts: {
  containerRef: RefObject<HTMLElement | null>;
  // Snapshot of tile rects in container CONTENT coords (registry.measure),
  // taken once at activation — scroll-stable by construction.
  measureItems: () => TileRect[];
  // Live selection while sweeping. `additive` = shift held at pointer-down.
  onChange: (ids: string[], additive: boolean) => void;
  // Sub-threshold release on whitespace — the "click empty space" gesture.
  onWhitespaceClick: () => void;
  enabled: boolean;
}) => {
  const { containerRef, measureItems, onChange, onWhitespaceClick, enabled } =
    opts;
  const [marqueeRect, setMarqueeRect] = useState<MarqueeRect | null>(null);

  // Everything mutable for the in-flight gesture lives in one ref.
  const gestureRef = useRef<{
    active: boolean;
    additive: boolean;
    items: TileRect[];
    pointerId: number;
    // Content-coord origin.
    startX: number;
    startY: number;
    // Latest pointer position in VIEWPORT coords (for edge auto-scroll).
    clientY: number;
    raf: number | null;
  } | null>(null);

  const stateRef = useRef({
    enabled,
    measureItems,
    onChange,
    onWhitespaceClick,
  });
  stateRef.current = { enabled, measureItems, onChange, onWhitespaceClick };

  const contentPoint = useCallback(
    (clientX: number, clientY: number) => {
      const el = containerRef.current;
      if (!el) {
        return { x: clientX, y: clientY };
      }
      const base = el.getBoundingClientRect();
      return {
        x: clientX - base.left + el.scrollLeft,
        y: clientY - base.top + el.scrollTop,
      };
    },
    [containerRef]
  );

  const stop = useCallback(() => {
    const g = gestureRef.current;
    if (g?.raf) {
      cancelAnimationFrame(g.raf);
    }
    gestureRef.current = null;
    setMarqueeRect(null);
    containerRef.current?.classList.remove("select-none");
  }, [containerRef]);

  const update = useCallback(
    (clientX: number, clientY: number, shiftKey: boolean) => {
      const g = gestureRef.current;
      const el = containerRef.current;
      if (!(g && el)) {
        return;
      }
      const p = contentPoint(clientX, clientY);
      const rect: MarqueeRect = {
        h: Math.abs(p.y - g.startY),
        w: Math.abs(p.x - g.startX),
        x: Math.min(p.x, g.startX),
        y: Math.min(p.y, g.startY),
      };
      if (!g.active) {
        if (Math.max(rect.w, rect.h) < DRAG_THRESHOLD_PX) {
          return;
        }
        g.active = true;
        g.items = stateRef.current.measureItems();
        el.classList.add("select-none");
      }
      g.additive ||= shiftKey;
      setMarqueeRect(rect);
      const hits = g.items
        .filter((item) => intersects(rect, item.rect))
        .map((item) => item.id);
      stateRef.current.onChange(hits, g.additive);
    },
    [containerRef, contentPoint]
  );

  // rAF edge auto-scroll while the pointer rides the container's top/bottom.
  const edgeScrollLoop = useCallback(() => {
    const g = gestureRef.current;
    const el = containerRef.current;
    if (!(g?.active && el)) {
      return;
    }
    const base = el.getBoundingClientRect();
    const topGap = g.clientY - base.top;
    const bottomGap = base.bottom - g.clientY;
    let dy = 0;
    if (topGap < EDGE_SCROLL_ZONE_PX) {
      dy = -Math.ceil(
        ((EDGE_SCROLL_ZONE_PX - topGap) / EDGE_SCROLL_ZONE_PX) *
          EDGE_SCROLL_MAX_PX_PER_FRAME
      );
    } else if (bottomGap < EDGE_SCROLL_ZONE_PX) {
      dy = Math.ceil(
        ((EDGE_SCROLL_ZONE_PX - bottomGap) / EDGE_SCROLL_ZONE_PX) *
          EDGE_SCROLL_MAX_PX_PER_FRAME
      );
    }
    if (dy !== 0) {
      el.scrollTop += dy;
    }
    g.raf = requestAnimationFrame(edgeScrollLoop);
  }, [containerRef]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (
        !stateRef.current.enabled ||
        e.button !== 0 ||
        e.pointerType === "touch"
      ) {
        return;
      }
      const target = e.target as HTMLElement;
      if (target.closest("[data-frame-tile], button, a, input, textarea")) {
        return;
      }
      const p = contentPoint(e.clientX, e.clientY);
      gestureRef.current = {
        active: false,
        additive: e.shiftKey,
        clientY: e.clientY,
        items: [],
        pointerId: e.pointerId,
        raf: null,
        startX: p.x,
        startY: p.y,
      };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      gestureRef.current.raf = requestAnimationFrame(edgeScrollLoop);
    },
    [contentPoint, edgeScrollLoop]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const g = gestureRef.current;
      if (!g || g.pointerId !== e.pointerId) {
        return;
      }
      g.clientY = e.clientY;
      update(e.clientX, e.clientY, e.shiftKey);
    },
    [update]
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const g = gestureRef.current;
      if (!g || g.pointerId !== e.pointerId) {
        return;
      }
      const wasActive = g.active;
      stop();
      if (!wasActive) {
        stateRef.current.onWhitespaceClick();
      }
    },
    [stop]
  );

  // A drag (pragmatic) starting mid-gesture, or unmount, must clean up.
  useEffect(() => {
    if (!enabled) {
      stop();
    }
  }, [enabled, stop]);
  useEffect(() => stop, [stop]);

  return {
    marqueeProps: {
      onPointerCancel: onPointerUp,
      onPointerDown,
      onPointerMove,
      onPointerUp,
    },
    marqueeRect,
  };
};
