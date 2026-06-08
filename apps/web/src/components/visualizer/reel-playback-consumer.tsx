"use client";

import type { LiveSessionId, ReelId } from "@sonara/shared/typeid";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { rpcClient } from "@/lib/orpc";
import { useVisualizerStore } from "@/stores/visualizer";

// Consumes the one-shot replay params left on /play after navigating from
// /studio, then clears them via router.replace so a refresh doesn't restart.
//
//   ?reel=<reelId>      → curated reel, played on a fixed cadence
//   ?session=<sessionId> → a past live session, replayed on its original timing
//
// Playback is purely client-side (no WS action, no generation): we fetch the
// ordered frames and hand them to the reel-playback slice; useReelPlaybackLoop
// pushes them through the same crossfade pipeline. Lives in its own Suspense
// boundary so useSearchParams doesn't gate the rest of the page.
export const ReelPlaybackConsumer = () => {
  const params = useSearchParams();
  const router = useRouter();
  const startReelPlayback = useVisualizerStore((s) => s.startReelPlayback);

  // Snapshot the params on first mount so we don't react to the clear we make
  // ourselves below.
  const snapshotRef = useRef<{ reel: string | null; session: string | null } | null>(
    null
  );
  if (snapshotRef.current === null) {
    snapshotRef.current = {
      reel: params.get("reel"),
      session: params.get("session"),
    };
  }

  useEffect(() => {
    const snap = snapshotRef.current;
    if (!snap) {
      return;
    }
    const { reel, session } = snap;
    if (!(reel || session)) {
      return;
    }

    let cancelled = false;
    const run = async () => {
      try {
        if (reel) {
          const data = await rpcClient.reels.get({ reelId: reel as ReelId });
          if (cancelled) {
            return;
          }
          if (data.frames.length === 0) {
            toast("that reel is empty");
            return;
          }
          startReelPlayback({
            cadence: "fixed",
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
          startReelPlayback({
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
  }, [router, startReelPlayback]);

  return null;
};
