"use client";

import type { FrameSet, FrameSetSummary, SetLook } from "@sonara/shared";
import type { FrameSetId, ImageLibraryId } from "@sonara/shared/typeid";
import type { useRouter } from "next/navigation";
import { useCallback, useMemo, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import { toast } from "sonner";

import { rpcClient } from "@/lib/orpc";
import { setsHref } from "@/lib/studio-hrefs";

// All of /studio's set mutations in one place: optimistic updates with
// rollback, a serialization queue (fast successive drags must not interleave
// reorder RPCs), and toast-with-undo for the destructive/bulk operations.
//
// Undo is inverse-RPC: the inverse payload is captured in a closure at
// mutation time (no server-side history). addFrames returns `addedIds` so an
// undo never removes frames that were already members before the add.

interface SetMutationDeps {
  recordingDetail: FrameSet | null;
  setRecordingDetail: Dispatch<SetStateAction<FrameSet | null>>;
  setDetail: FrameSet | null;
  setSetDetail: Dispatch<SetStateAction<FrameSet | null>>;
  selectedSetId: string | null;
  selectedFrameId: string | null;
  refreshSets: () => void;
  retrySetDetail: () => void;
  router: ReturnType<typeof useRouter>;
}

export interface SetMutations {
  createSet: (name: string) => void;
  // Seed a set from explicit frames (selection bar / drop on "new set").
  // Undoable (removes the created set).
  createSetFrom: (
    frameIds: string[],
    name: string
  ) => Promise<FrameSetSummary | null>;
  makeCut: () => void;
  renameSet: (name: string) => void;
  deleteSet: () => void;
  setCover: (frameId: string) => void;
  // Author or clear the open set's baked look (preset/intensity/cadence).
  // Optimistic with rollback, same shape as setVisibility.
  setLook: (look: SetLook | null) => void;
  setVisibility: (visibility: FrameSet["visibility"]) => void;
  recordingVisibility: (visibility: FrameSet["visibility"]) => void;
  // Full-order rewrite (drag reorder / move buttons). Optimistic + rollback;
  // serialized; deliberately NO undo toast (failures roll back loudly).
  reorderTo: (orderedFrameIds: string[]) => void;
  moveFrame: (frameId: string, dir: "prev" | "next") => void;
  // Splice frames into the OPEN set at a display index (cross-set drop).
  // Undoable.
  insertFramesAt: (frameIds: string[], index: number) => void;
  // Append frames to ANY owned curated set (selection bar / sidebar drop).
  // Undoable. Resolves with the number actually added (null = failed).
  addToSet: (
    target: { id: string; name: string },
    frameIds: string[]
  ) => Promise<number | null>;
  // Remove one or many frames from the open set. Undoable (restores the
  // exact previous order).
  removeFrames: (frameIds: string[]) => void;
}

// Undo actions must fire at most once (toast buttons can be mashed).
const once = (fn: () => void): (() => void) => {
  let used = false;
  return () => {
    if (!used) {
      used = true;
      fn();
    }
  };
};

export const useSetMutations = (deps: SetMutationDeps): SetMutations => {
  // The deps object changes per render; keep the latest in a ref so the
  // stable callbacks always read current state (same pattern as sendRef).
  const d = useRef(deps);
  d.current = deps;

  // Serialize order-touching RPCs: a second drag while the first reorder is
  // in flight must wait, or the full-list payloads race and the multiset
  // validation rejects one of them confusingly.
  const queueRef = useRef<Promise<unknown>>(Promise.resolve());
  const enqueue = useCallback(<T>(op: () => Promise<T>): Promise<T> => {
    const run = async (): Promise<T> => {
      try {
        await queueRef.current;
      } catch {
        // The previous op handled (and toasted) its own failure.
      }
      return await op();
    };
    const next = run();
    queueRef.current = next;
    return next;
  }, []);

  const undoToast = useCallback(
    (label: string, inverse: () => Promise<void>) => {
      toast(label, {
        action: {
          label: "undo",
          onClick: once(() => {
            void (async () => {
              try {
                await inverse();
                d.current.retrySetDetail();
                d.current.refreshSets();
              } catch {
                toast.error("undo failed");
              }
            })();
          }),
        },
        duration: 6000,
      });
    },
    []
  );

  const createSet = useCallback((name: string) => {
    void (async () => {
      try {
        const { set: created } = await rpcClient.sets.create({ name });
        d.current.refreshSets();
        d.current.router.push(setsHref(created.id));
        toast(`created “${created.name}”`, { duration: 1600 });
      } catch {
        toast.error("couldn't create set");
      }
    })();
  }, []);

  const createSetFrom = useCallback(
    async (
      frameIds: string[],
      name: string
    ): Promise<FrameSetSummary | null> => {
      try {
        const { set: created } = await rpcClient.sets.create({
          frameIds: frameIds as ImageLibraryId[],
          name,
        });
        d.current.refreshSets();
        undoToast(`created “${created.name}”`, async () => {
          await rpcClient.sets.remove({ setId: created.id });
          d.current.router.replace("/studio?tab=sets");
        });
        return created;
      } catch {
        toast.error("couldn't create set");
        return null;
      }
    },
    [undoToast]
  );

  const makeCut = useCallback(() => {
    const { recordingDetail, refreshSets, router } = d.current;
    if (!recordingDetail) {
      return;
    }
    const name = `cut of ${recordingDetail.name}`;
    const fromSetId = recordingDetail.id;
    void (async () => {
      try {
        const { set: created } = await rpcClient.sets.create({
          fromSetId,
          name,
        });
        refreshSets();
        router.push(setsHref(created.id));
        toast(`created “${created.name}”`, { duration: 1600 });
      } catch {
        toast.error("couldn't make a cut");
      }
    })();
  }, []);

  const renameSet = useCallback((name: string) => {
    const { setDetail, selectedSetId, setSetDetail, refreshSets } = d.current;
    if (!(setDetail && selectedSetId)) {
      return;
    }
    const prev = setDetail.name;
    setSetDetail((s) => (s ? { ...s, name } : s));
    void (async () => {
      try {
        await rpcClient.sets.rename({
          name,
          setId: selectedSetId as FrameSetId,
        });
        refreshSets();
      } catch {
        setSetDetail((s) => (s ? { ...s, name: prev } : s));
        toast.error("rename failed");
      }
    })();
  }, []);

  const deleteSet = useCallback(() => {
    const { selectedSetId, refreshSets, router } = d.current;
    if (!selectedSetId) {
      return;
    }
    void (async () => {
      try {
        await rpcClient.sets.remove({ setId: selectedSetId as FrameSetId });
        refreshSets();
        router.replace("/studio?tab=sets");
        toast("set deleted", { duration: 1600 });
      } catch {
        toast.error("couldn't delete set");
      }
    })();
  }, []);

  const setCover = useCallback((frameId: string) => {
    const { setDetail, selectedSetId, setSetDetail, refreshSets } = d.current;
    if (!(setDetail && selectedSetId)) {
      return;
    }
    const prev = setDetail.coverFrameId;
    setSetDetail((s) =>
      s ? { ...s, coverFrameId: frameId as ImageLibraryId } : s
    );
    void (async () => {
      try {
        await rpcClient.sets.setCover({
          frameId: frameId as ImageLibraryId,
          setId: selectedSetId as FrameSetId,
        });
        refreshSets();
        toast("cover set", { duration: 1400 });
      } catch {
        setSetDetail((s) => (s ? { ...s, coverFrameId: prev } : s));
        toast.error("couldn't set cover");
      }
    })();
  }, []);

  const setLook = useCallback((look: SetLook | null) => {
    const { setDetail, setSetDetail } = d.current;
    if (!setDetail) {
      return;
    }
    const prev = setDetail.look;
    const setId = setDetail.id;
    setSetDetail((s) => (s ? { ...s, look } : s));
    void (async () => {
      try {
        await rpcClient.sets.setLook({
          look: look as Parameters<typeof rpcClient.sets.setLook>[0]["look"],
          setId,
        });
        toast(look ? "look saved" : "look cleared");
      } catch {
        setSetDetail((s) => (s ? { ...s, look: prev } : s));
        toast.error("couldn't save the look");
      }
    })();
  }, []);

  const setVisibility = useCallback((visibility: FrameSet["visibility"]) => {
    const { setDetail, setSetDetail } = d.current;
    if (!setDetail) {
      return;
    }
    const prev = setDetail.visibility;
    const setId = setDetail.id;
    setSetDetail((s) => (s ? { ...s, visibility } : s));
    void (async () => {
      try {
        await rpcClient.sets.setVisibility({ setId, visibility });
      } catch {
        setSetDetail((s) => (s ? { ...s, visibility: prev } : s));
        toast.error("couldn't change visibility");
      }
    })();
  }, []);

  const recordingVisibility = useCallback(
    (visibility: FrameSet["visibility"]) => {
      const { recordingDetail, setRecordingDetail } = d.current;
      if (!recordingDetail) {
        return;
      }
      const prev = recordingDetail.visibility;
      const setId = recordingDetail.id;
      setRecordingDetail((s) => (s ? { ...s, visibility } : s));
      void (async () => {
        try {
          await rpcClient.sets.setVisibility({ setId, visibility });
        } catch {
          setRecordingDetail((s) => (s ? { ...s, visibility: prev } : s));
          toast.error("couldn't change visibility");
        }
      })();
    },
    []
  );

  const reorderTo = useCallback(
    (orderedFrameIds: string[]) => {
      const { setDetail, selectedSetId, setSetDetail, refreshSets } = d.current;
      if (!(setDetail && selectedSetId)) {
        return;
      }
      const prevFrames = setDetail.frames;
      const byId = new Map(prevFrames.map((f) => [f.id as string, f]));
      const reordered = orderedFrameIds
        .map((id) => byId.get(id))
        .filter((f): f is NonNullable<typeof f> => f !== undefined);
      if (reordered.length !== prevFrames.length) {
        return;
      }
      setSetDetail((s) => (s ? { ...s, frames: reordered } : s));
      void enqueue(async () => {
        try {
          await rpcClient.sets.reorder({
            orderedFrameIds: orderedFrameIds as ImageLibraryId[],
            setId: selectedSetId as FrameSetId,
          });
          refreshSets();
        } catch {
          setSetDetail((s) => (s ? { ...s, frames: prevFrames } : s));
          // A stale full list fails the server's multiset validation loudly —
          // refetch so the next drag starts from truth.
          d.current.retrySetDetail();
          toast.error("reorder failed");
        }
      });
    },
    [enqueue]
  );

  const moveFrame = useCallback(
    (frameId: string, dir: "prev" | "next") => {
      const { setDetail } = d.current;
      if (!setDetail) {
        return;
      }
      const ids = setDetail.frames.map((f) => f.id as string);
      const i = ids.indexOf(frameId);
      const j = dir === "prev" ? i - 1 : i + 1;
      if (i === -1 || j < 0 || j >= ids.length) {
        return;
      }
      const next = [...ids];
      next.splice(i, 1);
      next.splice(j, 0, frameId);
      reorderTo(next);
    },
    [reorderTo]
  );

  const insertFramesAt = useCallback(
    (frameIds: string[], index: number) => {
      const { selectedSetId } = d.current;
      if (!selectedSetId) {
        return;
      }
      const setId = selectedSetId as FrameSetId;
      void enqueue(async () => {
        try {
          const { added, addedIds } = await rpcClient.sets.addFrames({
            atPosition: index,
            frameIds: frameIds as ImageLibraryId[],
            setId,
          });
          d.current.retrySetDetail();
          d.current.refreshSets();
          if (added > 0) {
            undoToast(
              `${added} frame${added === 1 ? "" : "s"} added`,
              async () => {
                await rpcClient.sets.removeFrames({
                  frameIds: addedIds,
                  setId,
                });
              }
            );
          } else {
            toast("already in this set", { duration: 1600 });
          }
        } catch {
          toast.error("couldn't add frames");
        }
      });
    },
    [enqueue, undoToast]
  );

  const addToSet = useCallback(
    async (
      target: { id: string; name: string },
      frameIds: string[]
    ): Promise<number | null> => {
      try {
        const { added, addedIds } = await rpcClient.sets.addFrames({
          frameIds: frameIds as ImageLibraryId[],
          setId: target.id as FrameSetId,
        });
        d.current.refreshSets();
        if (d.current.selectedSetId === target.id) {
          d.current.retrySetDetail();
        }
        if (added > 0) {
          undoToast(
            `${added} frame${added === 1 ? "" : "s"} → “${target.name}”`,
            async () => {
              await rpcClient.sets.removeFrames({
                frameIds: addedIds,
                setId: target.id as FrameSetId,
              });
            }
          );
        } else {
          toast(`already in “${target.name}”`, { duration: 1600 });
        }
        return added;
      } catch {
        toast.error("couldn't add to set");
        return null;
      }
    },
    [undoToast]
  );

  const removeFrames = useCallback(
    (frameIds: string[]) => {
      const {
        setDetail,
        selectedSetId,
        setSetDetail,
        selectedFrameId,
        router,
      } = d.current;
      if (!(setDetail && selectedSetId) || frameIds.length === 0) {
        return;
      }
      const setId = selectedSetId as FrameSetId;
      const removeSet = new Set(frameIds);
      const prevOrderedIds = setDetail.frames.map((f) => f.id as string);
      const prevFrames = setDetail.frames;
      // Contiguous removals restore with one splice; scattered ones need the
      // full previous order re-asserted after the re-add.
      const removedIndices = prevOrderedIds
        .map((id, i) => (removeSet.has(id) ? i : -1))
        .filter((i) => i !== -1);
      const firstIdx = removedIndices[0] ?? 0;
      const lastIdx = removedIndices.at(-1) ?? 0;
      const contiguous =
        removedIndices.length > 0 &&
        lastIdx - firstIdx === removedIndices.length - 1;
      const removedIds = prevOrderedIds.filter((id) => removeSet.has(id));

      setSetDetail((s) =>
        s ? { ...s, frames: s.frames.filter((f) => !removeSet.has(f.id)) } : s
      );
      if (selectedFrameId && removeSet.has(selectedFrameId)) {
        router.replace(setsHref(selectedSetId));
      }
      void enqueue(async () => {
        try {
          await rpcClient.sets.removeFrames({
            frameIds: removedIds as ImageLibraryId[],
            setId,
          });
          d.current.refreshSets();
          undoToast(
            `${removedIds.length} frame${removedIds.length === 1 ? "" : "s"} removed`,
            async () => {
              if (contiguous) {
                await rpcClient.sets.addFrames({
                  atPosition: firstIdx,
                  frameIds: removedIds as ImageLibraryId[],
                  setId,
                });
                return;
              }
              await rpcClient.sets.addFrames({
                frameIds: removedIds as ImageLibraryId[],
                setId,
              });
              await rpcClient.sets.reorder({
                orderedFrameIds: prevOrderedIds as ImageLibraryId[],
                setId,
              });
            }
          );
        } catch {
          setSetDetail((s) => (s ? { ...s, frames: prevFrames } : s));
          toast.error("couldn't remove frames");
        }
      });
    },
    [enqueue, undoToast]
  );

  return useMemo(
    () => ({
      addToSet,
      createSet,
      createSetFrom,
      deleteSet,
      insertFramesAt,
      makeCut,
      moveFrame,
      recordingVisibility,
      removeFrames,
      renameSet,
      reorderTo,
      setCover,
      setLook,
      setVisibility,
    }),
    [
      addToSet,
      createSet,
      createSetFrom,
      deleteSet,
      insertFramesAt,
      makeCut,
      moveFrame,
      recordingVisibility,
      removeFrames,
      renameSet,
      reorderTo,
      setCover,
      setLook,
      setVisibility,
    ]
  );
};
