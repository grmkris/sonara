"use client";

import { useEffect, useRef } from "react";
import type { SessionSend } from "@/lib/session-actions";
import { getCurrentAudioEngine } from "@/hooks/use-audio-features";
import { useVisualizerStore } from "@/stores/visualizer-store";
import { blobToBase64 } from "@/lib/audio/recorder";

// Fires a song-recognition request based on the hybrid policy defined in the
// plan:
//   - Auto: when no song is known, audio has been loud enough for ~3s, and
//     at least 15s has passed since the last auto attempt.
//   - Silence resets: 10s below a low-rms floor clears nowPlaying so the next
//     track identifies fresh.
//   - Manual: store.identifyTick bumps to force one call past all gates.
//
// Guards stay lightweight — we don't duplicate the server's section-delta
// detector; the server also caches so an accidental re-fire won't waste an
// AudD call.
const AUTO_FLOOR_MS = 15_000;
const REQUIRED_ACTIVE_MS = 3_000;
const SILENCE_CLEAR_MS = 10_000;
const RMS_ACTIVE = 0.05;
const RMS_SILENT = 0.02;

export function useSongRecognition(send: SessionSend): void {
  const lastAutoAtRef = useRef(0);
  const activeSinceRef = useRef<number | null>(null);
  const silentSinceRef = useRef<number | null>(null);
  const inFlightRef = useRef(false);
  const lastManualTickRef = useRef(0);

  useEffect(() => {
    const fire = async (trigger: "auto" | "manual") => {
      const engine = getCurrentAudioEngine();
      if (!engine) return;
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        const clip = await engine.grabClip();
        if (!clip) return;
        const clipBase64 = await blobToBase64(clip.blob);
        send({
          type: "audio.recognize",
          clipBase64,
          mimeType: clip.mimeType,
          durationMs: 6000,
          trigger,
        });
      } catch (err) {
        console.warn("[song-recognition] grab/send failed", err);
      } finally {
        inFlightRef.current = false;
      }
    };

    const unsubscribe = useVisualizerStore.subscribe((s, prev) => {
      // Manual trigger: store.requestIdentify() was called.
      if (s.identifyTick !== lastManualTickRef.current) {
        lastManualTickRef.current = s.identifyTick;
        lastAutoAtRef.current = Date.now();
        void fire("manual");
        return;
      }

      // Audio-driven auto path: react to each audio-features update.
      if (s.audio === prev.audio) return;

      const now = Date.now();
      const rms = s.audio.rms;

      // Silence tracking → clear nowPlaying when the song has clearly ended.
      if (rms < RMS_SILENT) {
        if (silentSinceRef.current === null) silentSinceRef.current = now;
        if (
          s.nowPlaying &&
          now - silentSinceRef.current > SILENCE_CLEAR_MS
        ) {
          s.setNowPlaying(null);
          silentSinceRef.current = null;
        }
      } else {
        silentSinceRef.current = null;
      }

      // Active-audio tracking → auto-fire once conditions hold.
      if (rms >= RMS_ACTIVE) {
        if (activeSinceRef.current === null) activeSinceRef.current = now;
      } else {
        activeSinceRef.current = null;
        return;
      }

      if (s.nowPlaying !== null) return;
      if (now - lastAutoAtRef.current < AUTO_FLOOR_MS) return;
      if (now - (activeSinceRef.current ?? now) < REQUIRED_ACTIVE_MS) return;

      lastAutoAtRef.current = now;
      void fire("auto");
    });

    return () => unsubscribe();
  }, [send]);
}
