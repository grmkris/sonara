"use client";

import type { ServerEvent } from "@sonara/shared";
import { LiveSessionIdSchema, typeIdGenerator } from "@sonara/shared/typeid";
import type { LiveSessionId } from "@sonara/shared/typeid";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { createSessionConnection } from "@/lib/orpc-ws";
import { PRESET_NAMES } from "@/lib/render/presets";
import type { PresetName } from "@/lib/render/presets";
import { dispatchSessionAction } from "@/lib/session-actions";
import type { SessionAction, SessionSend } from "@/lib/session-actions";
import { useVisualizerStore } from "@/stores/visualizer";

const isKnownPreset = (name: string): name is PresetName =>
  (PRESET_NAMES as readonly string[]).includes(name);

// The durable liveSessionId lives in sessionStorage: one id per browser tab =
// one logical performance. It survives reload + WS reconnect (so a Wi-Fi drop
// mid-set doesn't fragment /studio history), and a new tab / explicit
// startNewSession() begins a fresh session. The server adopts it on the /ws
// upgrade; absent → the server mints its own.
const LIVE_SESSION_STORAGE_KEY = "sonara.liveSessionId";

const readOrMintLiveSessionId = (): LiveSessionId => {
  if (typeof window === "undefined") {
    return typeIdGenerator("liveSession");
  }
  const existing = window.sessionStorage.getItem(LIVE_SESSION_STORAGE_KEY);
  // Validate on read: a corrupted/garbage value would be rejected server-side,
  // which silently re-mints per reconnect and re-fragments history (the exact
  // thing this feature fixes). Re-mint here so the client only ever sends a
  // well-formed id the server will adopt.
  const parsed = existing ? LiveSessionIdSchema.safeParse(existing) : null;
  if (parsed?.success) {
    return parsed.data;
  }
  const minted = typeIdGenerator("liveSession");
  window.sessionStorage.setItem(LIVE_SESSION_STORAGE_KEY, minted);
  return minted;
};

export interface WsSession {
  send: SessionSend;
  // Mint a fresh durable liveSessionId and reconnect under it — begins a new
  // logical performance (its own /studio entry + reel target). Distinct from
  // session.reset, which clears the scene but keeps the session id.
  startNewSession: () => void;
}

export const useWsSession = (): WsSession => {
  const sendRef = useRef<SessionSend>(() => {
    // noop
  });
  // Durable id held in state so startNewSession() can re-mint and force a
  // clean reconnect under the new id (it's in the connect effect's deps).
  const [liveSessionId, setLiveSessionId] = useState<LiveSessionId>(
    readOrMintLiveSessionId
  );

  useEffect(() => {
    const store = useVisualizerStore;
    const sessionId =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID().slice(0, 12)
        : Math.random().toString(36).slice(2, 14);

    let cancelled = false;
    let conn: ReturnType<typeof createSessionConnection> | null = null;

    // oxlint-disable-next-line complexity -- REVIEW: flat per-event-type dispatch switch; splitting would obscure it
    const handleEvent = (event: ServerEvent): void => {
      const s = store.getState();
      switch (event.type) {
        case "scene.state": {
          s.setScene(event.state);
          break;
        }
        case "frame.preview": {
          // eslint-disable-next-line no-console
          console.debug(
            `%c[sonara] frame.preview%c v${event.version}`,
            "color:#888",
            "color:inherit",
            event.imageUrl
          );
          s.pushFrame(event.imageUrl, event.version);
          break;
        }
        case "frame.final": {
          // eslint-disable-next-line no-console
          console.info(
            `%c[sonara] frame.final%c v${event.version} — image landed`,
            "color:#3a3",
            "color:inherit",
            event.imageUrl
          );
          s.pushFrame(event.imageUrl, event.version);
          // Settled images go into the ghost callback ring; previews don't.
          s.pushHero(event.imageUrl);
          break;
        }
        case "job.status": {
          // eslint-disable-next-line no-console
          console.info(
            `%c[sonara] job.status%c ${event.status}`,
            "color:#39c",
            "color:inherit",
            { message: event.message, reason: event.reason }
          );
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
          // eslint-disable-next-line no-console
          console.debug(
            `%c[sonara] gen.requested%c v${event.version} reason=${event.reason}`,
            "color:#888",
            "color:inherit",
            event.promptString
          );
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
          // eslint-disable-next-line no-console
          console.info(
            `%c[sonara] gen.completed%c v${event.version} ${event.durationMs}ms success=${event.success}`,
            event.success ? "color:#3a3" : "color:#c33",
            "color:inherit"
          );
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
        case "stage.status": {
          // Crowd stage opened/closed for this session — the /play wire
          // overlay mounts on stageRoom and dials /ws/stage itself.
          s.setStageRoom(event.room);
          break;
        }
        default: {
          break;
        }
      }
    };

    // oxlint-disable-next-line require-await -- REVIEW: async signature kept; awaits live in the inner runEvents loop it spawns
    const connect = async (): Promise<void> => {
      // mintWsTicket is now public — signed-in callers get a uuid-bearing
      // ticket, anon callers get a userId:null ticket and the server pins
      // their session to demo-library mode. No upfront probe; partysocket
      // opens the WS directly.
      if (cancelled) {
        return;
      }

      conn = createSessionConnection(sessionId, liveSessionId);
      const { socket, client } = conn;

      sendRef.current = (action: SessionAction) => {
        // oxlint-disable-next-line prefer-await-to-then, prefer-await-to-callbacks -- REVIEW: SessionSend is sync fire-and-forget; cannot await here
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
        // The A/B model + resolution are CLIENT-authoritative (persisted to
        // localStorage, hydrated post-mount). The server Session starts on its
        // defaults, so re-send the user's current picks on every (re)connect so
        // a fresh Session adopts them instead of silently reverting.
        const st = store.getState();
        sendRef.current({ model: st.model, type: "model.set" });
        sendRef.current({ resolution: st.resolution, type: "resolution.set" });
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
        // oxlint-disable-next-line no-unmodified-loop-condition -- REVIEW: `cancelled` is flipped by the effect cleanup closure
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
                // oxlint-disable-next-line prefer-await-to-then -- REVIEW: intentional fire-and-forget; cannot await without blocking the loop
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
          // oxlint-disable-next-line avoid-new -- REVIEW: delay primitive; there is no library-provided promise to await here
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
    // Re-runs when liveSessionId changes (startNewSession): tears down the old
    // socket and reconnects under the fresh id. Otherwise one WS per tab.
  }, [liveSessionId]);

  const send = useCallback((action: SessionAction) => {
    sendRef.current(action);
  }, []);

  const startNewSession = useCallback(() => {
    const next = typeIdGenerator("liveSession");
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(LIVE_SESSION_STORAGE_KEY, next);
    }
    setLiveSessionId(next);
  }, []);

  return { send, startNewSession };
};
