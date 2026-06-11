// Pure types + list math for studio's drag-and-drop (no DOM — unit-tested).
// The payload travels between pragmatic adapters as a plain record; the
// `kind` discriminator keeps foreign drags (text, files) out.

export interface FrameDragPayload {
  kind: "sonara/frames";
  // Ordered by the SOURCE surface's display order (not click order) — what
  // you grabbed is what lands, in the order you saw it.
  frameIds: string[];
  source: { type: "recording" | "set"; setId: string };
  // Preview thumbnails (≤3) for the custom drag preview.
  previewUrls: string[];
}

export const makeFramePayload = (opts: {
  frameIds: string[];
  source: FrameDragPayload["source"];
  previewUrls: string[];
}): FrameDragPayload => ({
  frameIds: opts.frameIds,
  kind: "sonara/frames",
  previewUrls: opts.previewUrls.slice(0, 3),
  source: opts.source,
});

export const isFramePayload = (
  data: Record<string | symbol, unknown>
): data is FrameDragPayload & Record<string | symbol, unknown> =>
  data.kind === "sonara/frames";

// Drop-target discriminators (each target's getData mixes these in; the
// set-tile target additionally carries pragmatic's closest-edge symbol).
export type DropTargetData =
  | { kind: "set-tile"; setId: string; frameId: string; index: number }
  | { kind: "set-grid"; setId: string }
  | { kind: "sidebar-set"; setId: string; name: string }
  | { kind: "sidebar-new-set" };

export const isDropTargetData = (
  data: Record<string | symbol, unknown>
): data is DropTargetData & Record<string | symbol, unknown> =>
  data.kind === "set-tile" ||
  data.kind === "set-grid" ||
  data.kind === "sidebar-set" ||
  data.kind === "sidebar-new-set";

// Tile index + which edge the pointer favors → the insertion index in the
// CURRENT list (before any removal adjustments).
export const indexFromEdge = (
  tileIndex: number,
  edge: "left" | "right"
): number => (edge === "left" ? tileIndex : tileIndex + 1);

// Reorder: remove `draggedIds` from the list and re-insert them as one block
// at `targetIndex` (an index into the ORIGINAL list, e.g. from
// indexFromEdge). The block keeps the dragged items' relative order; the
// target index is adjusted for dragged items that sat before it.
export const spliceReorder = (
  currentIds: string[],
  draggedIds: string[],
  targetIndex: number
): string[] => {
  const dragged = new Set(draggedIds);
  const block = currentIds.filter((id) => dragged.has(id));
  const rest = currentIds.filter((id) => !dragged.has(id));
  let insertAt = 0;
  for (let i = 0; i < Math.min(targetIndex, currentIds.length); i += 1) {
    if (!dragged.has(currentIds[i] as string)) {
      insertAt += 1;
    }
  }
  return [...rest.slice(0, insertAt), ...block, ...rest.slice(insertAt)];
};
