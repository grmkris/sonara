"use client";

import type { DeckKey, ServerEvent } from "@sonara/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  applyBuiltinSetLocally,
  startSetReplayById,
} from "@/lib/apply-source";
import { createSessionConnection } from "@/lib/orpc-ws";
import { isKnownPreset } from "@/lib/render/presets";
import { dispatchSessionAction } from "@/lib/session-actions";
import type { SessionAction, SessionSend } from "@/lib/session-actions";
import { useVisualizerStore } from "@/stores/visualizer";

// Server close code for "another screen took over this stage" — the one close
// the client must NOT auto-reconnect from (it would kick the new screen right
// back: ping-pong). Reclaiming is an explicit user action.
const TAKEN_OVER_CLOSE_CODE = 4409;

export interface WsSession {
  send: SessionSend;
  // "New set": finalize the current recording segment and start the next one
  // — same connection, same scene; the new run id arrives via `run.started`.
  // Distinct from session.reset, which clears the scene but keeps the run.
  newSet: () => void;
  // Another device took over this stage's screen (latched until reclaim).
  takenOver: boolean;
  // Re-attach as the screen — kicks the other device in turn.
  reclaim: () => void;
}

// Run identity is SERVER-owned: the client never mints or stores an lse_ id.
// `target.code` names the stage to attach to (null = your default stage /
// anon pseudo-stage); the current run id flows back via `run.started` into
// the store's `liveRun`.
export const useWsSession = (target: { code: string | null }): WsSession => {
  const sendRef = useRef<SessionSend>(() => {
    // noop
  });
  const reconnectRef = useRef<() => void>(() => {
    // noop
  });
  const [takenOver, setTakenOver] = useState(false);
  const { code } = target;

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
          // overlay mounts on stageRoom and dials /ws/stage itself. showQr
          // drives the projector's join-QR overlay (host-toggled).
          s.setStageRoom(event.room);
          s.setStageShowQr(event.showQr ?? true);
          break;
        }
        case "run.started": {
          // Server-owned run identity — on every (re)connect init and after
          // "new set". ShareLink derives the recording permalink from it.
          s.setLiveRun(event.liveSessionId);
          break;
        }
        case "source.set": {
          // Remote source switch (console picks / studio "activate on
          // <stage>"). Apply exactly like a local pick; source.report then
          // confirms producer-truth back to the server. Builtin sets carry
          // deckKey → manifest-direct, no fetch (the offline path).
          const { source } = event;
          if (source.kind === "set" && source.deckKey) {
            applyBuiltinSetLocally(
              {
                deckKey: source.deckKey as DeckKey,
                name: source.label ?? null,
                setId: source.setId ?? null,
              },
              (a) => sendRef.current?.(a)
            );
          } else if (source.kind === "set" && source.setId) {
            // startSetReplayById sets the unified source + applies the set's
            // authored look. sendRef dodges the handler/send decl order.
            void startSetReplayById(source.setId, (a) => sendRef.current?.(a));
          } else if (source.kind === "idle") {
            s.stopToIdle();
          }
          break;
        }
        case "screen.takenOver": {
          // Rides the shared publisher, so the NEW screen sees it too — only
          // the kicked connection demotes itself. The authoritative signal is
          // the 4409 close (handled below); this is the early UI latch.
          if (event.connectionId === sessionId) {
            setTakenOver(true);
          }
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

      conn = createSessionConnection(sessionId, { code });
      const { socket, client } = conn;

      sendRef.current = (action: SessionAction) => {
        // oxlint-disable-next-line prefer-await-to-then, prefer-await-to-callbacks -- REVIEW: SessionSend is sync fire-and-forget; cannot await here
        dispatchSessionAction(client, action).catch((error) => {
          console.warn("[ws] dispatch failed", error);
        });
      };
      reconnectRef.current = () => {
        socket.reconnect();
      };

      socket.addEventListener("open", () => {
        // (Re)attaching as the screen — clear a previous takeover demotion
        // and restore the producer send path.
        setTakenOver(false);
        sendRef.current = (action: SessionAction) => {
          // oxlint-disable-next-line prefer-await-to-then, prefer-await-to-callbacks -- REVIEW: SessionSend is sync fire-and-forget; cannot await here
          dispatchSessionAction(client, action).catch((error) => {
            console.warn("[ws] dispatch failed", error);
          });
        };
        store.getState().setConnected(true);
        // Fire hello on every (re)connect so the server can re-init its
        // side idempotently. The state() pull below hydrates the playback
        // source from server-authoritative state — anon sessions come up
        // pinned to a random deck, signed-in sessions come up with whatever
        // they last set.
        sendRef.current({ type: "hello" });
        // The A/B resolution is CLIENT-authoritative (persisted to
        // localStorage, hydrated post-mount). The server Session starts on
        // its default, so re-send the user's current pick on every
        // (re)connect so a fresh Session adopts it instead of reverting.
        sendRef.current({
          resolution: store.getState().resolution,
          type: "resolution.set",
        });
      });
      socket.addEventListener("close", (ev: { code?: number }) => {
        store.getState().setConnected(false);
        if (ev.code === TAKEN_OVER_CLOSE_CODE) {
          // Kicked by another screen. Stop partysocket's retry loop (a
          // reconnect would kick the other device right back) and silence
          // the producers — a demoted tab must not keep pushing
          // frame.report / audio.features into the new screen's run.
          setTakenOver(true);
          sendRef.current = () => {
            // demoted — producer sends are dropped until reclaim
          };
          socket.close();
        }
      });

      // Events iterator: restart whenever it drops (socket reconnect, transient
      // error). orpc's iterator throws on socket close; the outer loop retries.
      // After each subscribe, pull session.state() to cover the race where
      // init()'s initial publishes land before our subscribe attached — and to
      // re-hydrate scene after reconnect.
      const runEvents = async (): Promise<void> => {
        // Reconnect/event-stream loop: each iteration is ONE full reconnect
        // cycle (open iterator → hydrate snapshot → consume the stream →
        // backoff). Inherently sequential — you can't parallelize reconnect
        // attempts — so no-await-in-loop is disabled for the whole loop body.
        /* oxlint-disable no-await-in-loop */
        // oxlint-disable-next-line no-unmodified-loop-condition -- REVIEW: `cancelled` is flipped by the effect cleanup closure
        while (!cancelled) {
          try {
            const iter = await client.events();
            try {
              const snap = await client.state();
              if (!cancelled) {
                const s = store.getState();
                s.setScene(snap.scene);
                // Hydrate the playback source from the server snapshot. For
                // anon sessions the server pinned a random builtin set
                // (deckKey-only) at construction; for signed-in this is the
                // last command/report. Builtin sets hydrate manifest-direct
                // (no fetch — anon can't call sets.get-dependent flows and
                // offline must not need to); fetched sets hydrate through
                // startSetReplayById (frames + authored look).
                const src = snap.source;
                if (src.kind === "set" && src.deckKey) {
                  applyBuiltinSetLocally(
                    {
                      deckKey: src.deckKey,
                      name: src.label,
                      setId: src.setId,
                    },
                    (a) => sendRef.current?.(a)
                  );
                } else if (src.kind === "set" && src.setId) {
                  void startSetReplayById(src.setId, (a) =>
                    sendRef.current?.(a)
                  );
                } else if (src.kind === "set") {
                  // Degenerate set source (neither id nor deckKey) — treat
                  // as idle rather than crash.
                  s.setSource({ kind: "idle" });
                } else {
                  s.setSource({ kind: src.kind });
                }
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
        /* oxlint-enable no-await-in-loop */
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
      reconnectRef.current = () => {
        // noop
      };
    };
    // One WS per tab; re-runs only if the page retargets to another stage.
  }, [code]);

  const send = useCallback((action: SessionAction) => {
    sendRef.current(action);
  }, []);

  const newSet = useCallback(() => {
    sendRef.current({ type: "set.new" });
  }, []);

  const reclaim = useCallback(() => {
    reconnectRef.current();
  }, []);

  return { newSet, reclaim, send, takenOver };
};
