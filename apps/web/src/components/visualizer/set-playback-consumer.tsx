"use client";

import type { FrameSetId, LiveSessionId, ReelId } from "@sonara/shared/typeid";
import { typeIdFromUuid, typeIdToUuid } from "@sonara/shared/typeid";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { rpcClient } from "@/lib/orpc";
import { useVisualizerStore } from "@/stores/visualizer";

// Consumes the one-shot replay params left on /play after navigating from
// /studio, then clears them via router.replace so a refresh doesn't restart.
//
//   ?set=<setId>         → a frame set; recordings replay on their original
//                          timing, curated/builtin sets on a fixed cadence
//   ?reel=<reelId>       → legacy param, retired in C5 (reel ids live on as
//                          set ids — same uuid), fixed cadence
//   ?session=<sessionId> → legacy param, retired in C5 (live-session link),
//                          original timing
//
// Playback is purely client-side (no WS action, no generation): we fetch the
// ordered frames and hand them to the set-playback slice; useSetPlaybackLoop
// pushes them through the same crossfade pipeline. Lives in its own Suspense
// boundary so useSearchParams doesn't gate the rest of the page.
export const SetPlaybackConsumer = () => {
  const params = useSearchParams();
  const router = useRouter();
  const startSetPlayback = useVisualizerStore((s) => s.startSetPlayback);

  // Snapshot the params on first mount so we don't react to the clear we make
  // ourselves below.
  const snapshotRef = useRef<{
    reel: string | null;
    session: string | null;
    setId: string | null;
  } | null>(null);
  if (snapshotRef.current === null) {
    snapshotRef.current = {
      reel: params.get("reel"),
      session: params.get("session"),
      setId: params.get("set"),
    };
  }

  useEffect(() => {
    const snap = snapshotRef.current;
    if (!snap) {
      return;
    }
    const { reel, session, setId } = snap;
    if (!(reel || session || setId)) {
      return;
    }

    let cancelled = false;
    const run = async () => {
      try {
        // Legacy ?reel= links keep working until C5 retires them: the
        // migration kept each reel's uuid as its set id, so a rel_ id converts
        // to the set_ id of the same row and both params resolve through
        // sets.get.
        const replaySetId: FrameSetId | null =
          (setId as FrameSetId | null) ??
          (reel
            ? typeIdFromUuid("frameSet", typeIdToUuid(reel as ReelId).uuid)
            : null);
        if (replaySetId) {
          const data = await rpcClient.sets.get({
            setId: replaySetId,
          });
          if (cancelled) {
            return;
          }
          if (data.frames.length === 0) {
            toast("that set is empty");
            return;
          }
          startSetPlayback({
            cadence: data.origin === "recording" ? "original" : "fixed",
            frames: data.frames,
            id: data.id,
            name: data.name,
          });
        } else if (session) {
          const { frames } = await rpcClient.library.bySession({
            sessionId: session as LiveSessionId,
          });
          if (cancelled) {
            return;
          }
          if (frames.length === 0) {
            toast("that session has no frames");
            return;
          }
          startSetPlayback({
            cadence: "original",
            frames,
            id: session,
            name: "session replay",
          });
        }
      } catch {
        if (!cancelled) {
          toast.error("couldn't load that for replay");
        }
      } finally {
        // Clear so a refresh doesn't restart playback.
        if (!cancelled) {
          snapshotRef.current = null;
          router.replace("/play");
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [router, startSetPlayback]);

  return null;
};
