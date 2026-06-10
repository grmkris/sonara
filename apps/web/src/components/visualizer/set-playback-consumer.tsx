"use client";

import type { FrameSetId } from "@sonara/shared/typeid";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { rpcClient } from "@/lib/orpc";
import { useVisualizerStore } from "@/stores/visualizer";

// Consumes the one-shot replay params left on /play after navigating from
// /studio, then clears them via router.replace so a refresh doesn't restart.
//
//   ?set=<setId>         → a frame set; recordings replay on their original
//                          timing, curated/builtin sets on a fixed cadence
//   ?reel=<reelId>       → legacy param (pre-C5 /studio links), remapped
//   ?session=<sessionId> → legacy param (pre-C5 /studio links), remapped
//
// Playback is purely client-side (no WS action, no generation): we fetch the
// ordered frames and hand them to the set-playback slice; useSetPlaybackLoop
// pushes them through the same crossfade pipeline. Lives in its own Suspense
// boundary so useSearchParams doesn't gate the rest of the page.

// Old /studio links keep resolving forever: typeid suffixes are
// prefix-independent encodings of the uuid, and the 0006 migration (and the
// boot converger before it) preserved uuid identity — curated set uuid = reel
// uuid, recording set uuid = lse uuid. So rel_ABC / lse_ABC remap to set_ABC
// with a literal prefix swap; no decode round-trip, no reel types.
const remapToSetId = (value: string): FrameSetId =>
  `set_${value.slice(value.indexOf("_") + 1)}` as FrameSetId;

export const SetPlaybackConsumer = () => {
  const params = useSearchParams();
  const router = useRouter();
  // Clear params on WHATEVER screen route mounted us (/play or /stage/<code>/screen).
  const pathname = usePathname();
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
    // One effective set id: ?set= wins, then the remapped legacy params.
    const replaySetId =
      (setId as FrameSetId | null) ??
      (reel ? remapToSetId(reel) : null) ??
      (session ? remapToSetId(session) : null);
    if (!replaySetId) {
      return;
    }

    let cancelled = false;
    const run = async () => {
      try {
        const data = await rpcClient.sets.get({ setId: replaySetId });
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
      } catch {
        if (!cancelled) {
          toast.error("couldn't load that for replay");
        }
      } finally {
        // Clear so a refresh doesn't restart playback.
        if (!cancelled) {
          snapshotRef.current = null;
          router.replace(pathname);
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [pathname, router, startSetPlayback]);

  return null;
};
