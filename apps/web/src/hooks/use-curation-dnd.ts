"use client";

import { extractClosestEdge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge";
import { monitorForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { useEffect, useRef, useState } from "react";

import type { SetMutations } from "@/hooks/use-set-mutations";
import {
  indexFromEdge,
  isDropTargetData,
  isFramePayload,
  spliceReorder,
} from "@/lib/curation-dnd";

// ONE monitor dispatches every frame drop in studio; the components only
// attach adapters and render their own hover state. Mutations stay
// page-owned (use-set-mutations) — this is pure routing:
//
//   set-tile / set-grid, same set    → one optimistic full-list reorder
//   set-tile / set-grid, cross-set   → splice insert (addFrames atPosition)
//   sidebar-set                      → append (undoable)
//   sidebar-new-set                  → create from payload (undoable)
export const useCurationDnd = (opts: {
  // The OPEN curated set (drop destination for tile/grid targets).
  currentSetId: string | null;
  currentOrderedIds: string[];
  mutations: SetMutations;
}) => {
  const [dragActive, setDragActive] = useState(false);
  const [dragCount, setDragCount] = useState(0);
  const stateRef = useRef(opts);
  stateRef.current = opts;

  useEffect(
    () =>
      monitorForElements({
        canMonitor: ({ source }) => isFramePayload(source.data),
        onDragStart: ({ source }) => {
          setDragActive(true);
          setDragCount(
            isFramePayload(source.data) ? source.data.frameIds.length : 0
          );
        },
        onDrop: ({ location, source }) => {
          setDragActive(false);
          setDragCount(0);
          const payload = source.data;
          if (!isFramePayload(payload)) {
            return;
          }
          const [target] = location.current.dropTargets;
          if (!target || !isDropTargetData(target.data)) {
            return;
          }
          const { currentOrderedIds, currentSetId, mutations } =
            stateRef.current;
          const { data } = target;

          if (data.kind === "set-tile" || data.kind === "set-grid") {
            const sameSet =
              payload.source.type === "set" &&
              payload.source.setId === data.setId;
            let index = currentOrderedIds.length;
            if (data.kind === "set-tile") {
              const edge = extractClosestEdge(target.data);
              index = indexFromEdge(
                data.index,
                edge === "left" ? "left" : "right"
              );
            }
            if (sameSet) {
              const next = spliceReorder(
                currentOrderedIds,
                payload.frameIds,
                index
              );
              const changed = next.some((id, i) => id !== currentOrderedIds[i]);
              if (changed) {
                mutations.reorderTo(next);
              }
              return;
            }
            if (data.setId === currentSetId) {
              mutations.insertFramesAt(payload.frameIds, index);
            }
            return;
          }

          if (data.kind === "sidebar-set") {
            void mutations.addToSet(
              { id: data.setId, name: data.name },
              payload.frameIds
            );
            return;
          }

          // sidebar-new-set: auto-named; rename is one click away in the
          // editor the page navigates to via onCreatedFromSelection-style
          // handling inside createSetFrom's caller — here we just create.
          const date = new Date();
          const name = `cut · ${date.toLocaleDateString("en-US", {
            day: "numeric",
            month: "short",
          })}`;
          void mutations.createSetFrom(payload.frameIds, name);
        },
      }),
    []
  );

  return { dragActive, dragCount };
};
