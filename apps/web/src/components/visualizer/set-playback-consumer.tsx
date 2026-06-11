"use client";

import type { FrameSetId } from "@sonara/shared/typeid";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

import { startSetReplayById } from "@/lib/apply-source";

// Consumes the one-shot replay params left on /play after navigating from
// /studio, then clears them via router.replace so a refresh doesn't restart.
//
//   ?set=<setId>         → a frame set; recordings replay on their original
//                          timing, curated/builtin sets per their look
//   ?reel=<reelId>       → legacy param (pre-C5 /studio links), remapped
//   ?session=<sessionId> → legacy param (pre-C5 /studio links), remapped
//
// Playback is purely client-side (no WS action, no generation):
// startSetReplayById hands the set to the source slice and usePlaybackLoop
// pushes the frames through the same crossfade pipeline. Lives in its own
// Suspense boundary so useSearchParams doesn't gate the rest of the page.

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

    const run = async () => {
      try {
        await startSetReplayById(replaySetId);
      } finally {
        // Clear so a refresh doesn't restart playback.
        snapshotRef.current = null;
        router.replace(pathname);
      }
    };
    void run();
  }, [pathname, router]);

  return null;
};
