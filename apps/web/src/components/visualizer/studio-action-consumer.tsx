"use client";

import { useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { SessionSend } from "@/lib/session-actions";
import { useVisualizerStore } from "@/stores/visualizer";

interface StudioActionConsumerProps {
  send: SessionSend;
}

// Consumes one-shot query params left on /play after navigating from
// /studio (or any other page). Fires the matching WS action once the
// socket is connected, then clears the params via router.replace so a
// refresh doesn't repeat the action.
//
// Handled params:
//   ?anchor=<url>&strength=<0..1>  → image.anchor.set
//   ?prompt=<text>                  → session.goLive (transitions out of
//                                     deck/demo mode + fires a trigger)
//
// Lives in its own component (wrapped in Suspense at the call site) so
// useSearchParams doesn't gate the rest of the page on the boundary.
export function StudioActionConsumer({ send }: StudioActionConsumerProps) {
  const params = useSearchParams();
  const router = useRouter();
  const connected = useVisualizerStore((s) => s.connected);
  // Snapshot the params on first mount so we don't react to clears we
  // make ourselves below.
  const snapshotRef = useRef<{
    anchor: string | null;
    strength: string | null;
    prompt: string | null;
  } | null>(null);

  if (snapshotRef.current === null) {
    snapshotRef.current = {
      anchor: params.get("anchor"),
      strength: params.get("strength"),
      prompt: params.get("prompt"),
    };
  }

  useEffect(() => {
    if (!connected) return;
    const snap = snapshotRef.current;
    if (!snap) return;
    const { anchor, strength, prompt } = snap;
    if (!anchor && !prompt) return;

    // Anchor first — independent of prompt; both can be set at once.
    if (anchor) {
      const strengthNum = strength ? Number(strength) : 0.55;
      send({
        type: "image.anchor.set",
        url: anchor,
        strength: Number.isFinite(strengthNum) ? strengthNum : 0.55,
      });
    }

    // Prompt fires goLive — transitions out of demo mode + triggers a
    // generation. Use scene.patch + commit would also work but goLive
    // is the canonical "set scene then run" action.
    if (prompt) {
      send({
        type: "session.goLive",
        prompt,
        seedFrameUrl: null,
      });
    }

    // Clear so refresh doesn't repeat. router.replace keeps the user on
    // /play, drops the query string.
    snapshotRef.current = null;
    router.replace("/play");
  }, [connected, send, router]);

  return null;
}
