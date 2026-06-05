"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { getCurrentAudioEngine } from "@/hooks/use-audio-features";
import { blobToBase64 } from "@/lib/audio/recorder";
import type { SessionSend } from "@/lib/session-actions";
import { useVisualizerStore } from "@/stores/visualizer";

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
const REQUIRED_ACTIVE_MS = 3000;
const SILENCE_CLEAR_MS = 10_000;
const RMS_ACTIVE = 0.05;
const RMS_SILENT = 0.02;

export const useSongRecognition = (
  send: SessionSend,
  // Anonymous visitors never call AudD — the server rejects `recognize` for
  // null-userId sessions anyway. Skipping the subscription on this side
  // means we also don't burn the per-tick store work and the `now playing`
  // UI never lights up for anon.
  enabled: boolean
): void => {
  const lastAutoAtRef = useRef(0);
  const activeSinceRef = useRef<number | null>(null);
  const silentSinceRef = useRef<number | null>(null);
  const inFlightRef = useRef(false);
  const lastManualTickRef = useRef(0);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const fire = async (trigger: "auto" | "manual") => {
      const engine = getCurrentAudioEngine();
      if (!engine) {
        if (trigger === "manual") {
          toast("attach an audio source first", { duration: 2400 });
        }
        return;
      }
      // Manual trigger pre-check: if no clip recorder yet (MediaRecorder not
      // ready / no source attached / still warming the ring), surface a toast
      // instead of silently no-op'ing. Auto trigger stays silent — it already
      // has its own active-audio gate upstream.
      if (!engine.hasClipRecorder()) {
        if (trigger === "manual") {
          toast("attach an audio source and wait a sec", { duration: 2400 });
        }
        return;
      }
      if (inFlightRef.current) {
        return;
      }
      inFlightRef.current = true;
      const { setRecognizing } = useVisualizerStore.getState();
      // Only flip the spinner for manual triggers — auto ones shouldn't
      // distract. The flag is cleared when the server's `now.playing` event
      // lands (see use-ws-session.ts), NOT in this try/finally, because the
      // `send()` above is fire-and-forget and resolves before AudD does.
      if (trigger === "manual") {
        setRecognizing(true);
      }
      try {
        const clip = await engine.grabClip();
        if (!clip) {
          if (trigger === "manual") {
            toast("mic is warming up — try again in a second", {
              duration: 2400,
            });
            setRecognizing(false);
          }
          return;
        }
        const clipBase64 = await blobToBase64(clip.blob);
        send({
          clipBase64,
          durationMs: 6000,
          mimeType: clip.mimeType,
          trigger,
          type: "audio.recognize",
        });
      } catch (error) {
        console.warn("[song-recognition] grab/send failed", error);
        if (trigger === "manual") {
          setRecognizing(false);
        }
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
      if (s.audio === prev.audio) {
        return;
      }

      const now = Date.now();
      const { rms } = s.audio;

      // Silence tracking → clear nowPlaying when the song has clearly ended.
      if (rms < RMS_SILENT) {
        if (silentSinceRef.current === null) {
          silentSinceRef.current = now;
        }
        if (s.nowPlaying && now - silentSinceRef.current > SILENCE_CLEAR_MS) {
          s.setNowPlaying(null);
          silentSinceRef.current = null;
        }
      } else {
        silentSinceRef.current = null;
      }

      // Active-audio tracking → auto-fire once conditions hold.
      if (rms >= RMS_ACTIVE) {
        if (activeSinceRef.current === null) {
          activeSinceRef.current = now;
        }
      } else {
        activeSinceRef.current = null;
        return;
      }

      if (s.nowPlaying !== null) {
        return;
      }
      if (now - lastAutoAtRef.current < AUTO_FLOOR_MS) {
        return;
      }
      if (now - (activeSinceRef.current ?? now) < REQUIRED_ACTIVE_MS) {
        return;
      }

      lastAutoAtRef.current = now;
      void fire("auto");
    });

    return () => unsubscribe();
  }, [send, enabled]);
};
