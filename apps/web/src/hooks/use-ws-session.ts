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
          s.pushFrame(event.imageUrl, event.version);
          // Settled images go into the ghost callback ring; previews don't.
          s.pushHero(event.imageUrl);
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
          // Clear the manual-trigger spinner on every manual response,
          // whether AudD matched or not. Auto triggers never set it.
          if (event.trigger === "manual") s.setRecognizing(false);
          if (event.track && event.trigger === "manual") {
            toast(`${event.track.artist} — ${event.track.title}`, {
              duration: 2800,
            });
          } else if (!event.track && event.trigger === "manual") {
            toast("couldn't identify the song", { duration: 2200 });
          }
          break;
        case "generation.requested":
          s.setInspectorRequested({
            reason: event.reason,
            version: event.version,
            promptString: event.promptString,
            driftSource: event.driftSource,
            resolvedScene: event.resolvedScene,
            requestedAt: event.requestedAt,
            nextKeyframeAt: event.nextKeyframeAt,
          });
          break;
        case "generation.completed":
          s.setInspectorCompleted(
            event.version,
            event.durationMs,
            event.success,
          );
          break;
        case "voice.partial":
          console.debug(
            `[voice] partial#${event.phraseId} ${event.isFinal ? "final" : "interim"} (${event.provider}): ${event.text}`,
          );
          s.voicePartial({
            phraseId: event.phraseId,
            text: event.text,
            isFinal: event.isFinal,
            ...(typeof event.confidence === "number"
              ? { confidence: event.confidence }
              : {}),
            provider: event.provider,
          });
          break;
        case "voice.parsed":
          console.debug(
            `[voice] parsed#${event.phraseId} in ${event.latencyMs}ms`,
            event.intent,
          );
          s.voiceParsed({
            phraseId: event.phraseId,
            intent: event.intent,
            latencyMs: event.latencyMs,
          });
          break;
        case "voice.applied":
          console.debug(
            `[voice] applied#${event.phraseId} triggered=${event.triggered}${
              typeof event.triggeredVersion === "number"
                ? ` v${event.triggeredVersion}`
                : ""
            }`,
            event.patch,
          );
          s.voiceApplied({
            phraseId: event.phraseId,
            patch: event.patch,
            triggered: event.triggered,
            ...(typeof event.triggeredVersion === "number"
              ? { triggeredVersion: event.triggeredVersion }
              : {}),
          });
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
      // After each subscribe, pull session.state() to cover the race where
      // init()'s initial publishes land before our subscribe attached — and to
      // re-hydrate scene after reconnect.
      const runEvents = async (): Promise<void> => {
        while (!cancelled) {
          try {
            const iter = await client.events();
            try {
              const snap = await client.state();
              if (!cancelled) {
                console.info(
                  `[voice] sttProvider=${snap.sttProvider} (from server snapshot)`,
                );
                store.getState().setScene(snap.scene);
                store.getState().setSttProvider(snap.sttProvider);
              }
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              console.warn("[ws] state snapshot failed:", msg);
            }
            for await (const event of iter) {
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
