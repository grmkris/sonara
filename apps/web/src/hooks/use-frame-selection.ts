"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

// Multi-select state for studio's frame surfaces (recording timeline + set
// editor grid). The selection is an ORDERED array treated as a set — order is
// click order, and it's the order frames land in the target set.
//
// v2 — selection is IMPLICIT: it exists whenever frames are selected (check
// click / cmd-click / marquee / long-press), with no mode gate. The header
// pill survives as an explicit PIN (`pinned`): while pinned, plain clicks
// toggle even with an empty selection, and the checks stay visible — the
// multi-recording sweep flow (select → add → hop recording → select) keeps
// working without re-entering anything, because the pin survives pool hops
// while the selection itself resets (`resetKey`).
export const useFrameSelection = (opts: {
  // Current display order of the visible frames — shift-click ranges and
  // selectAll resolve against this.
  displayOrder: string[];
  // Hopping pool (tab/recording/set) drops the selection, keeps the pin.
  resetKey: string;
}) => {
  const { displayOrder, resetKey } = opts;
  const [pinned, setPinned] = useState(false);
  const [selectedFrameIds, setSelectedFrameIds] = useState<string[]>([]);
  // Most recent plain-clicked frame; shift-click selects the contiguous range
  // between it and the target.
  const [anchorId, setAnchorId] = useState<string | null>(null);

  useEffect(() => {
    setSelectedFrameIds([]);
    setAnchorId(null);
  }, [resetKey]);

  const selectedSet = useMemo(
    () => new Set(selectedFrameIds),
    [selectedFrameIds]
  );
  const isSelected = useCallback(
    (id: string) => selectedSet.has(id),
    [selectedSet]
  );

  // "Are we in a selecting context" — drives check visibility, the click
  // matrix (plain click toggles vs inspects), and the SelectionBar gate.
  const isSelecting = pinned || selectedFrameIds.length > 0;

  const clear = useCallback(() => {
    setSelectedFrameIds([]);
    setAnchorId(null);
  }, []);

  const togglePinned = useCallback(() => {
    setPinned((prev) => {
      if (prev) {
        // Unpinning is an exit gesture — drop the selection too.
        setSelectedFrameIds([]);
        setAnchorId(null);
      }
      return !prev;
    });
  }, []);

  const toggle = useCallback((frameId: string) => {
    setSelectedFrameIds((prev) =>
      prev.includes(frameId)
        ? prev.filter((id) => id !== frameId)
        : [...prev, frameId]
    );
    setAnchorId(frameId);
  }, []);

  // Arm the anchor without changing the selection — so a plain inspect-click
  // becomes the pivot for the next shift-click range (the desktop idiom: click
  // A, shift-click B → select A…B).
  const setAnchor = useCallback((frameId: string) => {
    setAnchorId(frameId);
  }, []);

  // Shift behavior: extend the contiguous range from the anchor (which stays
  // put so successive shift-clicks keep extending). No anchor → plain toggle.
  const rangeTo = useCallback(
    (frameId: string) => {
      if (anchorId) {
        const a = displayOrder.indexOf(anchorId);
        const b = displayOrder.indexOf(frameId);
        if (a !== -1 && b !== -1) {
          const [lo, hi] = a < b ? [a, b] : [b, a];
          const range = displayOrder.slice(lo, hi + 1);
          setSelectedFrameIds((prev) => [
            ...prev,
            ...range.filter((id) => !prev.includes(id)),
          ]);
          return;
        }
      }
      toggle(frameId);
    },
    [anchorId, displayOrder, toggle]
  );

  // Marquee, non-additive: the box IS the selection.
  const replace = useCallback((ids: string[]) => {
    setSelectedFrameIds(ids);
    setAnchorId(ids.at(-1) ?? null);
  }, []);

  // Marquee, additive (shift held): union, preserving existing click order.
  const add = useCallback((ids: string[]) => {
    setSelectedFrameIds((prev) => [
      ...prev,
      ...ids.filter((id) => !prev.includes(id)),
    ]);
  }, []);

  const selectAll = useCallback(() => {
    setSelectedFrameIds(displayOrder);
    setAnchorId(displayOrder.at(-1) ?? null);
  }, [displayOrder]);

  return {
    add,
    clear,
    isSelected,
    isSelecting,
    pinned,
    rangeTo,
    replace,
    selectAll,
    selectedFrameIds,
    setAnchor,
    toggle,
    togglePinned,
  };
};

export type FrameSelection = ReturnType<typeof useFrameSelection>;
