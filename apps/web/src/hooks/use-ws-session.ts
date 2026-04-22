"use client";

import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import type { ClientEvent } from "@music-visualizer/shared";
import { publicEnv } from "@/env";
import { WsClient } from "@/lib/ws/ws-client";
import { useVisualizerStore } from "@/stores/visualizer-store";
import { PRESET_NAMES, type PresetName } from "@/lib/render/presets";
import { getByokFalKey } from "@/components/settings-panel";

function isKnownPreset(name: string): name is PresetName {
  return (PRESET_NAMES as readonly string[]).includes(name);
}

const WS_URL = publicEnv.NEXT_PUBLIC_WS_URL;

export function useWsSession(): (event: ClientEvent) => void {
  const clientRef = useRef<WsClient | null>(null);

  useEffect(() => {
    const store = useVisualizerStore;
    const sessionId =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID().slice(0, 12)
        : Math.random().toString(36).slice(2, 14);

    // The WS server rejects upgrades without a valid short-lived ticket.
    // Demo-mode visitors (no session) never connect; live-mode visitors get
    // a ticket minted after SIWE.
    let cancelled = false;
    let client: WsClient | null = null;

    const connect = async (): Promise<void> => {
      let token: string | null = null;
      try {
        const res = await fetch("/api/auth/ws-ticket", {
          method: "POST",
          credentials: "include",
        });
        if (res.status === 401) return; // not signed in — stay offline
        if (!res.ok) {
          console.warn("[ws] ticket fetch failed:", res.status);
          return;
        }
        const data = (await res.json()) as { token?: string };
        token = data.token ?? null;
      } catch (err) {
        console.warn("[ws] ticket fetch threw:", err);
        return;
      }
      if (!token || cancelled) return;

      const url = `${WS_URL}?token=${encodeURIComponent(token)}`;
      client = new WsClient({
        url,
        sessionId,
        getFalKey: () => getByokFalKey(),
        onOpen: () => store.getState().setConnected(true),
        onClose: () => store.getState().setConnected(false),
        onEvent: (event) => {
          const s = store.getState();
          switch (event.type) {
            case "scene.state":
              s.setScene(event.state);
              break;
            case "frame.preview":
              s.pushFrame(event.imageUrl, event.version);
              break;
            case "frame.final":
              if (
                typeof event.chainIndex === "number" &&
                typeof event.chainLength === "number"
              ) {
                // Morph-chain frame. Enqueue for beat-gated release; only
                // the last step gets banked as a hero so the ghost overlay
                // doesn't flood with in-between frames.
                s.enqueueChainFrame({
                  url: event.imageUrl,
                  version: event.version,
                  index: event.chainIndex,
                  total: event.chainLength,
                });
                if (event.chainIndex === event.chainLength - 1) {
                  s.pushHero(event.imageUrl);
                }
              } else {
                s.pushFrame(event.imageUrl, event.version);
                // Settled images go into the ghost callback ring; previews don't.
                s.pushHero(event.imageUrl);
              }
              break;
            case "job.status":
              s.setStatus(event.status, event.message);
              if (event.status === "running" && event.reason) {
                s.pushTrigger(event.reason, s.scene.version);
              }
              if (event.status === "error") {
                toast.error("generation failed", {
                  description: event.message ?? "unknown error",
                  duration: 4000,
                });
              }
              break;
            case "confirm.reset":
              // Voice said "start over" / "reset". Show a toast with a
              // Confirm action; user click fires session.reset. Mishears are
              // a real risk, so never auto-reset.
              toast("Reset the scene?", {
                description: event.reason,
                duration: event.ttlMs,
                action: {
                  label: "Reset",
                  onClick: () =>
                    clientRef.current?.send({ type: "session.reset" }),
                },
              });
              break;
            case "preset.suggest":
              // Server (LLM) suggests a visual preset. Only apply when the
              // user has opted into LLM mode — otherwise respect manual /
              // cycle / section selections.
              if (s.presetMode === "llm" && isKnownPreset(event.name)) {
                s.setPreset(event.name);
              }
              break;
            case "now.playing":
              s.setNowPlaying(event.track);
              if (event.track && event.trigger === "manual") {
                toast(`${event.track.artist} — ${event.track.title}`, {
                  duration: 2800,
                });
              } else if (!event.track && event.trigger === "manual") {
                toast("couldn't identify the song", { duration: 2200 });
              }
              break;
          }
        },
      });
      clientRef.current = client;
      client.connect();
    };

    void connect();
    return () => {
      cancelled = true;
      client?.close();
      clientRef.current = null;
    };
  }, []);

  return useCallback((event: ClientEvent) => {
    clientRef.current?.send(event);
    if (event.type === "generate.commit") {
      useVisualizerStore.getState().pulseCommit();
    }
  }, []);
}
