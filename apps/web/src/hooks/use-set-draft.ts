"use client";

import type { FrameSet, LibraryFrame } from "@sonara/shared";
import type { FrameSetId, ImageLibraryId } from "@sonara/shared/typeid";
import type { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { toast } from "sonner";

import type { SetMutations } from "@/hooks/use-set-mutations";
import { rpcClient } from "@/lib/orpc";
import { setsHref } from "@/lib/studio-hrefs";

// A CLIENT-SIDE draft of a frozen set (a built-in deck or a recording). The
// originals can't be edited in place — built-ins are system-owned and
// recordings are the frozen performance take — so the timeline editor instead
// edits this draft entirely in memory (reorder / trim / remove, no RPC), and
// "Save as set" clones the result into the user's library.
//
// Save reuses only existing, tested endpoints (no new server work):
//   create({ fromSetId })  → clones the source's frames (read-gated, so it
//                            works on built-ins and recordings)
//   removeFrames           → the frames the draft dropped
//   reorder                → the draft order
//   setFrameDuration × n   → each pinned trim
// The result is an origin='curated', user-owned set that plays ordered with
// the draft's durations.
//
// The draft lives in the SAME state the page already holds for the open source
// (setDetail / recordingDetail) — edits patch `frames` in place via setSource,
// so the existing selection / drag monitor / timeline read it with no special
// casing. Navigating away reloads the source from the server, discarding the
// draft (ephemeral, exactly as intended).

export interface SetDraft {
  active: boolean;
  dirty: boolean;
  saving: boolean;
  // Local edit handlers — patch the in-memory frame list, never the server.
  reorderTo: (orderedFrameIds: string[]) => void;
  moveFrame: (frameId: string, dir: "prev" | "next") => void;
  removeFrame: (frameId: string) => void;
  removeFrames: (frameIds: string[]) => void;
  setFrameDuration: (frameId: string, durationMs: number | null) => void;
  // No-op stand-in for the drop monitor's cross-set insert (a draft has no
  // frame objects for foreign ids to splice in). Dropping external frames into
  // a draft does nothing in v1.
  insertFramesAt: (frameIds: string[], index: number) => void;
  // Persist the draft as a new curated set and navigate to it.
  save: () => void;
  // Restore the draft to the originally-loaded source.
  reset: () => void;
}

const durationOf = (f: LibraryFrame): number | null =>
  typeof f.durationMs === "number" ? f.durationMs : null;

export const useSetDraft = (deps: {
  source: FrameSet | null;
  setSource: Dispatch<SetStateAction<FrameSet | null>>;
  refreshSets: () => void;
  router: ReturnType<typeof useRouter>;
}): SetDraft => {
  const d = useRef(deps);
  d.current = deps;
  const { source } = deps;
  const [saving, setSaving] = useState(false);

  // Snapshot the original frame list when the source identity changes; `dirty`
  // and `save` diff the live draft against it.
  const originalRef = useRef<{ id: string; frames: LibraryFrame[] } | null>(
    null
  );
  useEffect(() => {
    if (!source) {
      originalRef.current = null;
      return;
    }
    if (originalRef.current?.id !== source.id) {
      originalRef.current = { frames: source.frames, id: source.id };
    }
  }, [source]);

  const patchFrames = useCallback(
    (fn: (frames: LibraryFrame[]) => LibraryFrame[]) => {
      d.current.setSource((s) => (s ? { ...s, frames: fn(s.frames) } : s));
    },
    []
  );

  const reorderTo = useCallback(
    (orderedFrameIds: string[]) => {
      patchFrames((frames) => {
        const byId = new Map(frames.map((f) => [f.id as string, f]));
        const next = orderedFrameIds
          .map((id) => byId.get(id))
          .filter((f): f is LibraryFrame => f !== undefined);
        return next.length === frames.length ? next : frames;
      });
    },
    [patchFrames]
  );

  const moveFrame = useCallback(
    (frameId: string, dir: "prev" | "next") => {
      patchFrames((frames) => {
        const i = frames.findIndex((f) => f.id === frameId);
        const j = dir === "prev" ? i - 1 : i + 1;
        if (i === -1 || j < 0 || j >= frames.length) {
          return frames;
        }
        const next = [...frames];
        const [moved] = next.splice(i, 1);
        if (moved) {
          next.splice(j, 0, moved);
        }
        return next;
      });
    },
    [patchFrames]
  );

  const removeFrames = useCallback(
    (frameIds: string[]) => {
      const rm = new Set(frameIds);
      patchFrames((frames) => frames.filter((f) => !rm.has(f.id as string)));
    },
    [patchFrames]
  );
  const removeFrame = useCallback(
    (frameId: string) => removeFrames([frameId]),
    [removeFrames]
  );

  const setFrameDuration = useCallback(
    (frameId: string, durationMs: number | null) => {
      patchFrames((frames) =>
        frames.map((f) => (f.id === frameId ? { ...f, durationMs } : f))
      );
    },
    [patchFrames]
  );

  const insertFramesAt = useCallback(() => {
    // No-op: a draft can't splice in foreign frames it has no data for.
  }, []);

  const reset = useCallback(() => {
    const orig = originalRef.current;
    if (orig) {
      d.current.setSource((s) => (s ? { ...s, frames: orig.frames } : s));
    }
  }, []);

  const dirty = useMemo(() => {
    const orig = originalRef.current;
    if (!(source && orig)) {
      return false;
    }
    const a = source.frames;
    const b = orig.frames;
    if (a.length !== b.length) {
      return true;
    }
    return a.some(
      (f, i) =>
        f.id !== b[i]?.id || durationOf(f) !== durationOf(b[i] as LibraryFrame)
    );
  }, [source]);

  const save = useCallback(() => {
    const orig = originalRef.current;
    const cur = d.current.source;
    if (!(orig && cur)) {
      return;
    }
    if (cur.frames.length === 0) {
      toast("nothing to save");
      return;
    }
    const fromSetId = cur.id as FrameSetId;
    const draftOrder = cur.frames.map((f) => f.id as string);
    const draftIds = new Set(draftOrder);
    const removed = orig.frames
      .map((f) => f.id as string)
      .filter((id) => !draftIds.has(id));
    const durations = cur.frames
      .map((f) => ({ id: f.id as string, ms: durationOf(f) }))
      .filter((x): x is { id: string; ms: number } => x.ms !== null);
    const name = `cut of ${cur.name}`;

    setSaving(true);
    void (async () => {
      try {
        const { set: created } = await rpcClient.sets.create({
          fromSetId,
          name,
        });
        const setId = created.id;
        if (removed.length > 0) {
          await rpcClient.sets.removeFrames({
            frameIds: removed as ImageLibraryId[],
            setId,
          });
        }
        await rpcClient.sets.reorder({
          orderedFrameIds: draftOrder as ImageLibraryId[],
          setId,
        });
        await Promise.all(
          durations.map((dn) =>
            rpcClient.sets.setFrameDuration({
              durationMs: dn.ms,
              frameId: dn.id as ImageLibraryId,
              setId,
            })
          )
        );
        d.current.refreshSets();
        toast(`saved “${created.name}”`, { duration: 1600 });
        d.current.router.push(setsHref(setId));
      } catch {
        toast.error("couldn't save set");
      } finally {
        setSaving(false);
      }
    })();
  }, []);

  return useMemo(
    () => ({
      active: !!source,
      dirty,
      insertFramesAt,
      moveFrame,
      removeFrame,
      removeFrames,
      reorderTo,
      reset,
      save,
      saving,
      setFrameDuration,
    }),
    [
      source,
      dirty,
      insertFramesAt,
      moveFrame,
      removeFrame,
      removeFrames,
      reorderTo,
      reset,
      save,
      saving,
      setFrameDuration,
    ]
  );
};

// Which frozen source (if any) is the open one, and the setter that patches it.
const pickSource = (d: {
  tab: "recordings" | "sets";
  setDetail: FrameSet | null;
  recordingDetail: FrameSet | null;
  setSetDetail: Dispatch<SetStateAction<FrameSet | null>>;
  setRecordingDetail: Dispatch<SetStateAction<FrameSet | null>>;
}): {
  source: FrameSet | null;
  setSource: Dispatch<SetStateAction<FrameSet | null>>;
} => {
  if (d.tab === "sets" && d.setDetail?.origin === "builtin") {
    return { setSource: d.setSetDetail, source: d.setDetail };
  }
  if (d.tab === "recordings" && d.recordingDetail) {
    return { setSource: d.setRecordingDetail, source: d.recordingDetail };
  }
  return { setSource: d.setRecordingDetail, source: null };
};

// Studio wrapper: resolves the open frozen source (built-in deck or recording),
// drives its client draft, and produces the drop-monitor routing (draft-local
// reorder while a draft is open, else the real server-backed mutations). Keeps
// all of this out of the studio page's render body.
export const useFrozenDraft = (deps: {
  tab: "recordings" | "sets";
  setDetail: FrameSet | null;
  recordingDetail: FrameSet | null;
  setSetDetail: Dispatch<SetStateAction<FrameSet | null>>;
  setRecordingDetail: Dispatch<SetStateAction<FrameSet | null>>;
  mutations: SetMutations;
  setOrderedIds: string[];
  selectedSetId: string | null;
  refreshSets: () => void;
  router: ReturnType<typeof useRouter>;
}): {
  draft: SetDraft;
  dndMutations: SetMutations;
  dndOrderedIds: string[];
  dndSetId: string | null;
} => {
  const { source, setSource } = pickSource(deps);
  const draft = useSetDraft({
    refreshSets: deps.refreshSets,
    router: deps.router,
    setSource,
    source,
  });

  const dndMutations = useMemo(
    () =>
      draft.active
        ? {
            ...deps.mutations,
            insertFramesAt: draft.insertFramesAt,
            moveFrame: draft.moveFrame,
            removeFrames: draft.removeFrames,
            reorderTo: draft.reorderTo,
          }
        : deps.mutations,
    [draft, deps.mutations]
  );
  const dndOrderedIds = draft.active
    ? (source?.frames ?? []).map((f) => f.id as string)
    : deps.setOrderedIds;
  const dndSetId = draft.active ? (source?.id ?? null) : deps.selectedSetId;

  return { dndMutations, dndOrderedIds, dndSetId, draft };
};
