"use client";

import { useEffect, useState } from "react";

import { useVisualizerStore } from "@/stores/visualizer";

// Periodic low-opacity overlay of a past "hero" image from the recent-frames
// ring buffer. Fires every 45-90s when at least 2 entries exist. Reads as a
// déjà-vu / callback — the session remembers itself.
//
// Pure CSS opacity transition over the main canvas. Deliberately not
// composited through the shader pipeline — the ghost should feel like a
// separate photographic layer peeking through, not a shader-filtered echo.
//
// Schedule: min 45s + up to 45s jitter between fires. Envelope: 800ms fade in,
// 1500ms hold at peak, 800ms fade out, peak opacity 0.22.
const INTERVAL_MIN_MS = 45_000;
const INTERVAL_JITTER_MS = 45_000;
const FADE_IN_MS = 800;
const HOLD_MS = 1500;
const FADE_OUT_MS = 800;
const PEAK_OPACITY = 0.22;

export const GhostOverlay = () => {
  const bank = useVisualizerStore((s) => s.heroBank);
  const [ghostUrl, setGhostUrl] = useState<string | null>(null);
  const [opacity, setOpacity] = useState(0);

  useEffect(() => {
    // Don't schedule until we have at least two hero frames: the first one is
    // always identical to what's on screen, and ghosting the current frame is
    // pointless.
    if (bank.length < 2) {
      return;
    }

    let fadeInTimer: ReturnType<typeof setTimeout> | null = null;
    let holdTimer: ReturnType<typeof setTimeout> | null = null;
    let fadeOutTimer: ReturnType<typeof setTimeout> | null = null;
    let clearTimer: ReturnType<typeof setTimeout> | null = null;
    let scheduleTimer: ReturnType<typeof setTimeout> | null = null;

    const scheduleNext = () => {
      const delay = INTERVAL_MIN_MS + Math.random() * INTERVAL_JITTER_MS;
      // oxlint-disable-next-line no-use-before-define -- REVIEW: fire and scheduleNext are mutually recursive; reference is deferred inside setTimeout
      scheduleTimer = setTimeout(fire, delay);
    };

    const fire = () => {
      // Age-weighted pick: prefer older entries (index 1..N-1; skip index 0
      // which is the current frame). Weight by index so ancient entries
      // surface too.
      const candidates = useVisualizerStore.getState().heroBank.slice(1);
      if (candidates.length === 0) {
        scheduleNext();
        return;
      }
      const weights = candidates.map((_, i) => i + 1);
      const total = weights.reduce((s, w) => s + w, 0);
      let r = Math.random() * total;
      let [pick] = candidates;
      for (let i = 0; i < candidates.length; i += 1) {
        r -= weights[i] ?? 0;
        if (r <= 0) {
          pick = candidates[i];
          break;
        }
      }
      if (!pick) {
        scheduleNext();
        return;
      }

      setGhostUrl(pick);
      setOpacity(0);
      // Kick off fade-in on next tick so the opacity transition fires.
      fadeInTimer = setTimeout(() => setOpacity(PEAK_OPACITY), 20);
      holdTimer = setTimeout(() => {
        // Hold at peak is implicit — no opacity change needed here.
      }, FADE_IN_MS);
      fadeOutTimer = setTimeout(() => setOpacity(0), FADE_IN_MS + HOLD_MS);
      clearTimer = setTimeout(
        () => {
          setGhostUrl(null);
          scheduleNext();
        },
        FADE_IN_MS + HOLD_MS + FADE_OUT_MS + 100
      );
    };

    scheduleNext();

    return () => {
      if (fadeInTimer) {
        clearTimeout(fadeInTimer);
      }
      if (holdTimer) {
        clearTimeout(holdTimer);
      }
      if (fadeOutTimer) {
        clearTimeout(fadeOutTimer);
      }
      if (clearTimer) {
        clearTimeout(clearTimer);
      }
      if (scheduleTimer) {
        clearTimeout(scheduleTimer);
      }
    };
  }, [bank.length >= 2]);

  if (!ghostUrl) {
    return null;
  }

  // Soft-light blend so the ghost tints rather than covers the current image.
  // z-index just above canvas but below UI.
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-[1]"
      style={{
        mixBlendMode: "soft-light",
        opacity,
        transition: `opacity ${FADE_IN_MS}ms ease-in-out`,
      }}
    >
      <img
        src={ghostUrl}
        alt=""
        className="h-full w-full object-cover"
        crossOrigin="anonymous"
      />
    </div>
  );
};
