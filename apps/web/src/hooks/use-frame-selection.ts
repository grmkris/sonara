"use client";

import { useCallback, useEffect, useState } from "react";

// Multi-select state for studio's frame surfaces (recording timeline + set
// editor grid). The selection is an ORDERED array treated as a set — order is
// click order, and it's the order frames land in the target set.
//
// Reset semantics serve the multi-recording curation flow: hopping to another
// recording/set (selectionResetKey) drops the selected frames but KEEPS select
// mode, so the user can sweep several recordings into one target without
// re-toggling. Switching tabs (modeResetKey) exits select mode entirely.
export const useFrameSelection = (opts: {
  // Current display order of the visible frames — shift-click ranges resolve
  // against this.
  displayOrder: string[];
  modeResetKey: string;
  selectionResetKey: string;
}) => {
  const { displayOrder, modeResetKey, selectionResetKey } = opts;
  const [selectMode, setSelectMode] = useState(false);
  const [selectedFrameIds, setSelectedFrameIds] = useState<string[]>([]);
  // Most recent plain-clicked frame; shift-click selects the contiguous range
  // between it and the target.
  const [anchorId, setAnchorId] = useState<string | null>(null);

  useEffect(() => {
    setSelectedFrameIds([]);
    setAnchorId(null);
  }, [selectionResetKey]);

  useEffect(() => {
    setSelectMode(false);
  }, [modeResetKey]);

  const clear = useCallback(() => {
    setSelectedFrameIds([]);
    setAnchorId(null);
  }, []);

  const toggleMode = useCallback(() => {
    if (selectMode) {
      clear();
    }
    setSelectMode(!selectMode);
  }, [selectMode, clear]);

  const toggleFrame = useCallback(
    (frameId: string, shiftKey: boolean) => {
      if (shiftKey && anchorId) {
        const a = displayOrder.indexOf(anchorId);
        const b = displayOrder.indexOf(frameId);
        if (a !== -1 && b !== -1) {
          const [lo, hi] = a < b ? [a, b] : [b, a];
          const range = displayOrder.slice(lo, hi + 1);
          setSelectedFrameIds((prev) => [
            ...prev,
            ...range.filter((id) => !prev.includes(id)),
          ]);
          // Anchor stays put so successive shift-clicks extend from it.
          return;
        }
      }
      setSelectedFrameIds((prev) =>
        prev.includes(frameId)
          ? prev.filter((id) => id !== frameId)
          : [...prev, frameId]
      );
      setAnchorId(frameId);
    },
    [anchorId, displayOrder]
  );

  return { clear, selectMode, selectedFrameIds, toggleFrame, toggleMode };
};
