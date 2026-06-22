"use client";

import { useCallback, useEffect, useState } from "react";

import type { TileRect } from "@/hooks/use-tile-registry";

// Keyboard cursor for a tile surface (set grid / timeline). Roving tabindex:
// exactly one tile is tab-reachable; DOM focus IS the cursor (the existing
// `focus-ring` style draws it — no second visual system). The keydown
// listener lives on the surface CONTAINER, so it's active only while focus
// is inside that surface — the two studio surfaces can't fight, and inputs
// elsewhere are untouched.
//
//   arrows        move (column-aware: rows derived from measured rects)
//   shift+arrows  move + extend the selection range
//   space         toggle selection on the cursor
//   enter         open the inspector
//   delete        remove (curated sets only; bulk when a selection exists)
//   cmd/ctrl+←/→  reorder the cursor tile (a11y twin of drag)
export const useGridCursor = (opts: {
  displayOrder: string[];
  measure: () => TileRect[];
  focusTile: (id: string) => void;
  selection: {
    toggle: (id: string) => void;
    rangeTo: (id: string) => void;
    selectedFrameIds: string[];
  };
  onOpen: (id: string) => void;
  onRemove?: (ids: string[]) => void;
  onMove?: (id: string, dir: "prev" | "next") => void;
}) => {
  const {
    displayOrder,
    measure,
    focusTile,
    selection,
    onOpen,
    onRemove,
    onMove,
  } = opts;
  const [focusedId, setFocusedId] = useState<string | null>(null);

  // Cursor follows real DOM focus (click, tab) via onTileFocus; stale ids
  // (frame removed) fall back to nothing until the next focus.
  useEffect(() => {
    if (focusedId && !displayOrder.includes(focusedId)) {
      setFocusedId(null);
    }
  }, [displayOrder, focusedId]);

  const moveCursor = useCallback(
    (dir: "left" | "right" | "up" | "down", extend: boolean) => {
      const current = focusedId ?? displayOrder[0];
      if (!current) {
        return;
      }
      const idx = displayOrder.indexOf(current);
      let nextId: string | undefined;
      if (dir === "left" || dir === "right") {
        nextId = displayOrder[dir === "left" ? idx - 1 : idx + 1];
      } else {
        // Column-aware vertical move: find the tile on the adjacent row whose
        // horizontal center is nearest — works on the responsive grid AND the
        // timeline's stacks, because rows come from real rects.
        const rects = measure();
        const byId = new Map(rects.map((r) => [r.id, r.rect]));
        const cur = byId.get(current);
        if (!cur) {
          return;
        }
        const cx = cur.x + cur.w / 2;
        const candidates = rects.filter((r) =>
          dir === "down"
            ? r.rect.y > cur.y + cur.h / 2
            : r.rect.y + r.rect.h < cur.y + cur.h / 2
        );
        if (candidates.length === 0) {
          return;
        }
        const nextRowY =
          dir === "down"
            ? Math.min(...candidates.map((r) => r.rect.y))
            : Math.max(...candidates.map((r) => r.rect.y));
        const row = candidates.filter(
          (r) => Math.abs(r.rect.y - nextRowY) < r.rect.h / 2
        );
        let best: { id: string; d: number } | null = null;
        for (const r of row) {
          const d = Math.abs(r.rect.x + r.rect.w / 2 - cx);
          if (!best || d < best.d) {
            best = { d, id: r.id };
          }
        }
        nextId = best?.id;
      }
      if (!nextId) {
        return;
      }
      setFocusedId(nextId);
      focusTile(nextId);
      if (extend) {
        selection.rangeTo(nextId);
      }
    },
    [displayOrder, focusedId, focusTile, measure, selection]
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }
      const metaOrCtrl = e.metaKey || e.ctrlKey;
      const arrows: Record<string, "left" | "right" | "up" | "down"> = {
        ArrowDown: "down",
        ArrowLeft: "left",
        ArrowRight: "right",
        ArrowUp: "up",
      };
      const dir = arrows[e.key];
      if (dir) {
        if (metaOrCtrl && onMove && focusedId) {
          if (dir === "left" || dir === "right") {
            e.preventDefault();
            onMove(focusedId, dir === "left" ? "prev" : "next");
          }
          return;
        }
        e.preventDefault();
        moveCursor(dir, e.shiftKey);
        return;
      }
      if (!focusedId) {
        return;
      }
      if (e.key === " ") {
        e.preventDefault();
        selection.toggle(focusedId);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        onOpen(focusedId);
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && onRemove) {
        e.preventDefault();
        const ids =
          selection.selectedFrameIds.length > 0
            ? selection.selectedFrameIds
            : [focusedId];
        onRemove(ids);
      }
    },
    [focusedId, moveCursor, onMove, onOpen, onRemove, selection]
  );

  const tileTabIndex = useCallback(
    (id: string): 0 | -1 => {
      const anchor = focusedId ?? displayOrder[0];
      return id === anchor ? 0 : -1;
    },
    [focusedId, displayOrder]
  );

  const onTileFocus = useCallback((id: string) => setFocusedId(id), []);

  return { focusedId, onKeyDown, onTileFocus, tileTabIndex };
};
