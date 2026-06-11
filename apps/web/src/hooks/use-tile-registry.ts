"use client";

import { useCallback, useRef } from "react";

export interface TileRect {
  id: string;
  rect: { x: number; y: number; w: number; h: number };
}

// id → element map for studio's frame tiles. Feeds the marquee's hit-testing
// (measured rects in CONTAINER CONTENT coordinates, so scrolling during a
// drag never invalidates a snapshot) and, later, the keyboard cursor's
// focus/row math. Tiles register via a ref callback.
export const useTileRegistry = () => {
  const mapRef = useRef(new Map<string, HTMLElement>());

  const registerTile = useCallback(
    (id: string) =>
      (el: HTMLElement | null): void => {
        if (el) {
          mapRef.current.set(id, el);
        } else {
          mapRef.current.delete(id);
        }
      },
    []
  );

  // Rects in `container`'s content coordinate space (client rect adjusted by
  // the container's own rect + scroll offsets).
  const measure = useCallback((container: HTMLElement): TileRect[] => {
    const base = container.getBoundingClientRect();
    const out: TileRect[] = [];
    for (const [id, el] of mapRef.current) {
      if (!container.contains(el)) {
        continue;
      }
      const r = el.getBoundingClientRect();
      out.push({
        id,
        rect: {
          h: r.height,
          w: r.width,
          x: r.left - base.left + container.scrollLeft,
          y: r.top - base.top + container.scrollTop,
        },
      });
    }
    return out;
  }, []);

  const focusTile = useCallback((id: string): void => {
    const el = mapRef.current.get(id);
    const target = el?.querySelector("button") ?? el;
    (target as HTMLElement | null)?.focus();
  }, []);

  return { focusTile, measure, registerTile };
};

export type TileRegistry = ReturnType<typeof useTileRegistry>;
