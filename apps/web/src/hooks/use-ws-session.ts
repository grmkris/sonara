"use client";

import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import type { ClientEvent } from "@music-visualizer/shared";
import { WsClient } from "@/lib/ws/ws-client";
import { useVisualizerStore } from "@/stores/visualizer-store";

const WS_URL =
  process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:3001/ws";

export function useWsSession(): (event: ClientEvent) => void {
  const clientRef = useRef<WsClient | null>(null);

  useEffect(() => {
    const store = useVisualizerStore;
    const sessionId =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID().slice(0, 12)
        : Math.random().toString(36).slice(2, 14);

    const client = new WsClient({
      url: WS_URL,
      sessionId,
      onOpen: () => store.getState().setConnected(true),
      onClose: () => store.getState().setConnected(false),
      onEvent: (event) => {
        const s = store.getState();
        switch (event.type) {
          case "scene.state":
            s.setScene(event.state);
            break;
          case "frame.preview":
          case "frame.final":
            s.pushFrame(event.imageUrl, event.version);
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
        }
      },
    });
    clientRef.current = client;
    client.connect();
    return () => {
      client.close();
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
