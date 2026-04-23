"use client";

import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import type { ServerEvent } from "@music-visualizer/shared";
import { rpcClient } from "@/lib/orpc";
import { createSessionConnection } from "@/lib/orpc-ws";
import {
  dispatchSessionAction,
  type SessionAction,
  type SessionSend,
} from "@/lib/session-actions";
import { useVisualizerStore } from "@/stores/visualizer-store";
import { PRESET_NAMES, type PresetName } from "@/lib/render/presets";
import { getByokFalKey } from "@/components/settings-panel";

function isKnownPreset(name: string): name is PresetName {
  return (PRESET_NAMES as readonly string[]).includes(name);
}

export function useWsSession(): SessionSend {
  const sendRef = useRef<SessionSend>(() => {});

  useEffect(() => {
    const store = useVisualizerStore;
    const sessionId =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID().slice(0, 12)
        : Math.random().toString(36).slice(2, 14);

    let cancelled = false;
    let conn: ReturnType<typeof createSessionConnection> | null = null;

    const handleEvent = (event: ServerEvent): void => {
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
            // Morph-chain frame. Enqueue for beat-gated release; only the
            // last step gets banked as a hero so the ghost overlay doesn't
            // flood with in-between frames.
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
          // Voice said "start over" / "reset". Show a toast with a Confirm
          // action; user click fires session.reset. Mishears are a real
          // risk, so never auto-reset.
          toast("Reset the scene?", {
            description: event.reason,
            duration: event.ttlMs,
            action: {
              label: "Reset",
              onClick: () => sendRef.current({ type: "session.reset" }),
            },
          });
          break;
        case "preset.suggest":
          // Server (LLM) suggests a visual preset. Only apply when the user
          // has opted into LLM mode — otherwise respect manual / cycle /
          // section selections.
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
    };

    const connect = async (): Promise<void> => {
      // Probe auth once up front — if not signed in, stay offline quietly
      // instead of letting partysocket retry-storm against a 401 ticket mint.
      try {
        await rpcClient.auth.mintWsTicket();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!/unauthorized/i.test(msg)) {
          console.warn("[ws] ticket probe failed:", msg);
        }
        return;
      }
      if (cancelled) return;

      conn = createSessionConnection(sessionId);
      const { socket, client } = conn;

      sendRef.current = (action: SessionAction) => {
        dispatchSessionAction(client, action).catch((err) => {
          console.warn("[ws] dispatch failed", err);
        });
        if (action.type === "generate.commit") {
          useVisualizerStore.getState().pulseCommit();
        }
      };

      socket.addEventListener("open", () => {
        store.getState().setConnected(true);
        // Fire hello on every (re)connect so BYOK propagates after settings
        // changes + the server can re-init its side idempotently.
        const falKey = getByokFalKey();
        sendRef.current({
          type: "hello",
          ...(falKey ? { falKey } : {}),
        });
      });
      socket.addEventListener("close", () => {
        store.getState().setConnected(false);
      });

      // Events iterator: restart whenever it drops (socket reconnect, transient
      // error). orpc's iterator throws on socket close; the outer loop retries.
      const runEvents = async (): Promise<void> => {
        while (!cancelled) {
          try {
            for await (const event of await client.events()) {
              if (cancelled) return;
              handleEvent(event);
            }
          } catch (err) {
            if (cancelled) return;
            const msg = err instanceof Error ? err.message : String(err);
            console.warn("[ws] events iterator dropped, restarting:", msg);
          }
          // Backoff before reopening — covers reconnect windows.
          await new Promise((r) => setTimeout(r, 500));
        }
      };
      void runEvents();
    };

    void connect();
    return () => {
      cancelled = true;
      conn?.socket.close();
      sendRef.current = () => {};
    };
  }, []);

  return useCallback((action: SessionAction) => {
    sendRef.current(action);
  }, []);
}
