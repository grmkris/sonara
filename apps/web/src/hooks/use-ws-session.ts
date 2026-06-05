"use client";

import type { ServerEvent } from "@sonara/shared";
import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";

import { createSessionConnection } from "@/lib/orpc-ws";
import { PRESET_NAMES } from "@/lib/render/presets";
import type { PresetName } from "@/lib/render/presets";
import { dispatchSessionAction } from "@/lib/session-actions";
import type { SessionAction, SessionSend } from "@/lib/session-actions";
import { useVisualizerStore } from "@/stores/visualizer";

const isKnownPreset = (name: string): name is PresetName =>
  (PRESET_NAMES as readonly string[]).includes(name);

export const useWsSession = (): SessionSend => {
  const sendRef = useRef<SessionSend>(() => {
    // noop
  });

  useEffect(() => {
    const store = useVisualizerStore;
    const sessionId =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID().slice(0, 12)
        : Math.random().toString(36).slice(2, 14);

    let cancelled = false;
    let conn: ReturnType<typeof createSessionConnection> | null = null;

    // oxlint-disable-next-line complexity -- flat per-event-type dispatch switch; splitting would obscure it
    const handleEvent = (event: ServerEvent): void => {
      const s = store.getState();
      switch (event.type) {
        case "scene.state": {
          s.setScene(event.state);
          break;
        }
        case "frame.preview": {
          s.pushFrame(event.imageUrl, event.version);
          break;
        }
        case "frame.final": {
          s.pushFrame(event.imageUrl, event.version);
          // Settled images go into the ghost callback ring; previews don't.
          s.pushHero(event.imageUrl);
          break;
        }
        case "job.status": {
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
        }
        case "preset.suggest": {
          // Server (LLM) suggests a visual preset. Only apply when the user
          // has opted into LLM mode — otherwise respect manual / cycle /
          // section selections.
          if (s.presetMode === "llm" && isKnownPreset(event.name)) {
            s.setPreset(event.name);
          }
          break;
        }
        case "now.playing": {
          s.setNowPlaying(event.track);
          // Clear the manual-trigger spinner on every manual response,
          // whether AudD matched or not. Auto triggers never set it.
          if (event.trigger === "manual") {
            s.setRecognizing(false);
          }
          if (event.track && event.trigger === "manual") {
            toast(`${event.track.artist} — ${event.track.title}`, {
              duration: 2800,
            });
          } else if (!event.track && event.trigger === "manual") {
            toast("couldn't identify the song", { duration: 2200 });
          }
          break;
        }
        case "generation.requested": {
          s.setInspectorRequested({
            driftSource: event.driftSource,
            nextKeyframeAt: event.nextKeyframeAt,
            promptString: event.promptString,
            reason: event.reason,
            requestedAt: event.requestedAt,
            resolvedScene: event.resolvedScene,
            version: event.version,
          });
          break;
        }
        case "generation.completed": {
          s.setInspectorCompleted(
            event.version,
            event.durationMs,
            event.success
          );
          break;
        }
        case "library.appended": {
          // Newly persisted frame — prepend to the timeline. Dedupes on id
          // so the brief race with library.bootstrap can't double-insert.
          s.libraryAppendFromEvent(event.frame);
          break;
        }
        default: {
          break;
        }
      }
    };

    // oxlint-disable-next-line require-await -- async signature kept; awaits live in the inner runEvents loop it spawns
    const connect = async (): Promise<void> => {
      // mintWsTicket is now public — signed-in callers get a uuid-bearing
      // ticket, anon callers get a userId:null ticket and the server pins
      // their session to demo-library mode. No upfront probe; partysocket
      // opens the WS directly.
      if (cancelled) {
        return;
      }

      conn = createSessionConnection(sessionId);
      const { socket, client } = conn;

      sendRef.current = (action: SessionAction) => {
        // oxlint-disable-next-line prefer-await-to-then, prefer-await-to-callbacks -- SessionSend is sync fire-and-forget; cannot await here
        dispatchSessionAction(client, action).catch((error) => {
          console.warn("[ws] dispatch failed", error);
        });
      };

      socket.addEventListener("open", () => {
        store.getState().setConnected(true);
        // Fire hello on every (re)connect so the server can re-init its
        // side idempotently. The state() pull below will hydrate demoMode
        // and demoDeck from server-authoritative state — anon sessions
        // come up demo-pinned with a random deck, signed-in sessions come
        // up with whatever they last set. The client no longer pushes its
        // localStorage demo prefs on connect.
        sendRef.current({ type: "hello" });
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
        // oxlint-disable-next-line no-unmodified-loop-condition -- `cancelled` is flipped by the effect cleanup closure
        while (!cancelled) {
          try {
            const iter = await client.events();
            try {
              const snap = await client.state();
              if (!cancelled) {
                const s = store.getState();
                s.setScene(snap.scene);
                // Hydrate demo state from the server snapshot. For anon
                // sessions the server picked demoMode=true + a random deck
                // at construction; for signed-in this matches whatever
                // setDemoMode last persisted. Flipping demoMode on here is
                // what triggers the auto-play effect in music-source.tsx
                // (so anon visitors actually hear the demo track).
                s.setDemoMode(snap.demoMode);
                s.setDemoDeck(snap.demoDeck);
                // Hydrate image-anchor too — if the user pinned an anchor
                // and the WS dropped (tab refresh, transient disconnect),
                // the live Session kept it in memory and we want the
                // client UI to reflect that on reconnect.
                if (snap.imageAnchor) {
                  s.setAnchorImageUrl(snap.imageAnchor.url);
                } else {
                  s.clearAnchor();
                }
              }
              // Bootstrap the timeline library on every (re)connect. The
              // RPC is protected so it errors with UNAUTHORIZED for anon
              // sessions — catch + ignore that case. The slice is idempotent
              // (libraryReset wipes it on signout; bootstrap dedupes).
              // fire-and-forget bootstrap; must not block the events loop
              void store
                .getState()
                .libraryBootstrap()
                // oxlint-disable-next-line prefer-await-to-then -- intentional fire-and-forget; cannot await without blocking the loop
                .catch(() => {
                  // anon or transient error — leave the slice empty
                });
            } catch (error) {
              const msg =
                error instanceof Error ? error.message : String(error);
              console.warn("[ws] state snapshot failed:", msg);
            }
            for await (const event of iter) {
              if (cancelled) {
                return;
              }
              handleEvent(event);
            }
          } catch (error) {
            if (cancelled) {
              return;
            }
            const msg = error instanceof Error ? error.message : String(error);
            console.warn("[ws] events iterator dropped, restarting:", msg);
          }
          // Backoff before reopening — covers reconnect windows.
          // oxlint-disable-next-line avoid-new -- delay primitive; there is no library-provided promise to await here
          await new Promise<void>((resolve) => {
            setTimeout(resolve, 500);
          });
        }
      };
      void runEvents();
    };

    void connect();
    return () => {
      cancelled = true;
      conn?.socket.close();
      sendRef.current = () => {
        // noop
      };
    };
  }, []);

  return useCallback((action: SessionAction) => {
    sendRef.current(action);
  }, []);
};
