"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AppRouterClient } from "server/rpc";
import { toast } from "sonner";

import { dispatchControlAction } from "@/lib/control-actions";
import type { ControlTarget } from "@/lib/control-actions";
import { rpcClient } from "@/lib/orpc";
import type { SessionSend } from "@/lib/session-actions";
import { useVisualizerStore } from "@/stores/visualizer";

// The full snapshot the operator polls — inferred from the control router so
// the wire shape can never drift from the server.
export type ControlSnapshot = Awaited<
  ReturnType<AppRouterClient["control"]["snapshot"]>
>;

const POLL_MS = 1000;

// While the operator is actively editing (dragging a slider, typing a prompt),
// hold off rehydrating the scene from the poll for this window — otherwise the
// next ~1s poll overwrites the optimistic value mid-drag and the control snaps
// back. Status / demo / anchor still reconcile every poll; only the scene is
// held. After this idle gap the poll resyncs to server truth.
const SCENE_REHYDRATE_HOLD_MS = 1800;

export interface RemoteSession {
  // Same SessionSend contract the WS path exposes, so the existing controls
  // (PromptInput, DeckPicker, …) reuse unchanged.
  send: SessionSend;
  // Latest poll — used by /control for the thumbnail, status pill, and prompt
  // readout. Null until the first poll lands (or while no session is selected).
  snapshot: ControlSnapshot | null;
  // Whether the last poll reached the live session. Goes false when it
  // disconnects (e.g. the projector closed), which /control surfaces.
  connected: boolean;
}

// Operator-side analogue of useWsSession. Instead of owning a WebSocket, it
// drives a remote live Session over the authed `control` HTTP router and
// hydrates the SAME zustand store from ~1s snapshot polls, so the reused
// controls read current state exactly as they do on /play.
export const useRemoteSession = (
  // Stage-addressed; stage-keyed snapshots make "new set" run swaps
  // invisible — no rebind needed.
  target: ControlTarget | null
): RemoteSession => {
  const [snapshot, setSnapshot] = useState<ControlSnapshot | null>(null);
  const [connected, setConnected] = useState(false);

  // Kept in a ref so the stable `send` callback always targets the current
  // session without re-creating on every rebind.
  const idRef = useRef(target);
  idRef.current = target;

  // Timestamp of the operator's last scene edit; the poll skips rehydrating the
  // scene for SCENE_REHYDRATE_HOLD_MS after it so optimistic drags don't snap
  // back. Shared across the poll effect and the send callback via a ref.
  const lastSceneEditAtRef = useRef(0);

  // Key the poll effect on the serialized target (object identity churns).
  const targetKey = target ? `stg:${target.stageId}` : null;

  useEffect(() => {
    const boundTarget = idRef.current;
    if (!(targetKey && boundTarget)) {
      setSnapshot(null);
      setConnected(false);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const store = useVisualizerStore;

    const poll = async (): Promise<void> => {
      try {
        const snap = await rpcClient.control.snapshot(boundTarget);
        if (cancelled) {
          return;
        }
        setSnapshot(snap);
        setConnected(true);
        // Hydrate the store the controls read from. Demo/anchor are also
        // mutated locally by the controls themselves; the poll reconciles
        // them with server truth.
        const s = store.getState();
        // Skip scene rehydrate while the operator is mid-edit so the poll
        // doesn't clobber an in-flight optimistic drag (see send below).
        if (Date.now() - lastSceneEditAtRef.current > SCENE_REHYDRATE_HOLD_MS) {
          s.setScene(snap.scene);
        }
        s.setStatus(snap.jobStatus);
        // Reconcile the source only when it actually changed — setSource
        // builds a fresh object, and a 1s poll would otherwise re-render
        // every `source` selector each tick.
        const cur = s.source;
        const next = snap.source;
        const sameSource =
          cur.kind === next.kind &&
          (next.kind !== "set" ||
            (cur.kind === "set" &&
              cur.setId === next.setId &&
              cur.deckKey === next.deckKey));
        if (!sameSource) {
          if (next.kind === "set") {
            // Display-only mapping for the console (it never mounts the
            // playback loop): look isn't in the snapshot.
            s.setSource({
              deckKey: next.deckKey,
              kind: "set",
              look: null,
              name: next.label,
              origin: next.deckKey ? "builtin" : "curated",
              setId: next.setId,
            });
          } else {
            s.setSource({ kind: next.kind });
          }
        }
        if (snap.imageAnchor) {
          s.setAnchorImageUrl(snap.imageAnchor.url);
        } else {
          s.clearAnchor();
        }
      } catch {
        // NOT_FOUND (no live run on the stage) / transient error → drop the
        // connected flag; the stage console surfaces "no screen connected".
        if (!cancelled) {
          setConnected(false);
        }
      } finally {
        if (!cancelled) {
          timer = setTimeout(poll, POLL_MS);
        }
      }
    };
    void poll();

    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- boundTarget derives from targetKey
  }, [targetKey]);

  const send = useCallback<SessionSend>((action) => {
    const boundTarget = idRef.current;
    if (!boundTarget) {
      return;
    }
    // Optimistic scene merge for slider/prompt patches so the operator's own
    // edit shows immediately rather than waiting for the next poll. Mark the
    // edit time so the poll holds off rehydrating the scene over it.
    if (action.type === "scene.patch" || action.type === "voice.patch") {
      const s = useVisualizerStore.getState();
      s.setScene({ ...s.scene, ...action.patch });
      lastSceneEditAtRef.current = Date.now();
    }
    // oxlint-disable-next-line prefer-await-to-then, prefer-await-to-callbacks -- REVIEW: send is a synchronous fire-and-forget SessionSend; awaiting here would change its contract
    dispatchControlAction(rpcClient, boundTarget, action).catch((error) => {
      // Surface it — a silently dropped control action reads as "the app
      // ignored me" (and once hid a never-sent source switch entirely).
      console.warn("[control] dispatch failed", error);
      toast.error("the stage didn't get that — try again");
    });
  }, []);

  return { connected, send, snapshot };
};
