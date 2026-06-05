"use client";

import type { LiveSessionId } from "@sonara/shared/typeid";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AppRouterClient } from "server/rpc";

import { dispatchControlAction } from "@/lib/control-actions";
import { rpcClient } from "@/lib/orpc";
import type { SessionSend } from "@/lib/session-actions";
import { useVisualizerStore } from "@/stores/visualizer";

// The full snapshot the operator polls — inferred from the control router so
// the wire shape can never drift from the server.
export type ControlSnapshot = Awaited<
  ReturnType<AppRouterClient["control"]["snapshot"]>
>;

const POLL_MS = 1000;

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
export function useRemoteSession(
  liveSessionId: LiveSessionId | null
): RemoteSession {
  const [snapshot, setSnapshot] = useState<ControlSnapshot | null>(null);
  const [connected, setConnected] = useState(false);

  // Kept in a ref so the stable `send` callback always targets the current
  // session without re-creating on every rebind.
  const idRef = useRef(liveSessionId);
  idRef.current = liveSessionId;

  useEffect(() => {
    if (!liveSessionId) {
      setSnapshot(null);
      setConnected(false);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const store = useVisualizerStore;

    const poll = async (): Promise<void> => {
      try {
        const snap = await rpcClient.control.snapshot({ liveSessionId });
        if (cancelled) {
          return;
        }
        setSnapshot(snap);
        setConnected(true);
        // Hydrate the store the controls read from. Demo/anchor are also
        // mutated locally by the controls themselves; the poll reconciles
        // them with server truth.
        const s = store.getState();
        s.setScene(snap.scene);
        s.setStatus(snap.jobStatus);
        s.setDemoMode(snap.demoMode);
        s.setDemoDeck(snap.demoDeck);
        if (snap.imageAnchor) {
          s.setAnchorImageUrl(snap.imageAnchor.url);
        } else {
          s.clearAnchor();
        }
      } catch {
        // NOT_FOUND (session gone) / transient error → drop the connected flag;
        // /control re-resolves the live session from liveSessions() and rebinds.
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
  }, [liveSessionId]);

  const send = useCallback<SessionSend>((action) => {
    const id = idRef.current;
    if (!id) {
      return;
    }
    // Optimistic scene merge for slider/prompt patches so the operator's own
    // edit shows immediately rather than waiting for the next poll.
    if (action.type === "scene.patch" || action.type === "voice.patch") {
      const s = useVisualizerStore.getState();
      s.setScene({ ...s.scene, ...action.patch });
    }
    dispatchControlAction(rpcClient, id, action).catch((error) => {
      console.warn("[control] dispatch failed", error);
    });
  }, []);

  return { connected, send, snapshot };
}
