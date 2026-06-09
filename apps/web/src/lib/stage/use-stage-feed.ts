"use client";

import { SERVICE_URLS, StageFeedMessage } from "@sonara/shared";
import type { StageActivityEvent, StagePromptView } from "@sonara/shared";
import ReconnectingWebSocket from "partysocket/ws";
import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

import { publicEnv } from "../../env";

// Live connection to the public per-room stage feed (/ws/stage?room=…) — the
// push channel behind the Monad "wire" UI. No ticket: the room code is the
// capability, same as control.stageSnapshot. partysocket re-dials with
// backoff; the seq cursor makes the hello backlog idempotent across
// reconnects (and React strict-mode's double-effect in dev).

const MAX_ACTIVITY = 64;
const RING_SECONDS = 60;

// One-second activity buckets for the seismograph, ring-indexed by
// `epochSec % RING_SECONDS`. A mutable ref the canvas reads at RAF — never
// React state (that would re-render the tree at tap rate).
export interface StageFeedRing {
  counts: number[];
  lastSec: number;
}

export const makeRing = (): StageFeedRing => ({
  counts: Array.from({ length: RING_SECONDS }, () => 0),
  lastSec: 0,
});

// Zero any buckets we skipped since the last write, then bump `sec`'s bucket.
export const bumpRing = (ring: StageFeedRing, sec: number): void => {
  if (sec < ring.lastSec) {
    return;
  }
  const gap = Math.min(sec - ring.lastSec, RING_SECONDS);
  for (let i = 1; i <= gap; i += 1) {
    ring.counts[(ring.lastSec + i) % RING_SECONDS] = 0;
  }
  ring.lastSec = sec;
  const bucket = sec % RING_SECONDS;
  ring.counts[bucket] = (ring.counts[bucket] ?? 0) + 1;
};

export interface StageQueueView {
  nowPlaying: StagePromptView | null;
  upNext: StagePromptView[];
}

export interface StageFeed {
  // newest first, capped at MAX_ACTIVITY
  activity: StageActivityEvent[];
  allowPrompts: boolean;
  blockNumber: number | null;
  // the server closed the room — terminal, no reconnect
  closed: boolean;
  connected: boolean;
  kindCounts: { nudge: number; prompt: number; set: number };
  queue: StageQueueView;
  // events-per-second buckets, read by the Seismograph at RAF
  ring: RefObject<StageFeedRing>;
  // total USDC paid into this room's prompts (6-dec units as string)
  revenueUnits: string;
  txCount: number;
}

const EMPTY_QUEUE: StageQueueView = { nowPlaying: null, upNext: [] };
const ZERO_KINDS = { nudge: 0, prompt: 0, set: 0 };

export const useStageFeed = (
  room: string | null,
  onActivity?: (event: StageActivityEvent) => void
): StageFeed => {
  const [activity, setActivity] = useState<StageActivityEvent[]>([]);
  const [allowPrompts, setAllowPrompts] = useState(true);
  const [blockNumber, setBlockNumber] = useState<number | null>(null);
  const [closed, setClosed] = useState(false);
  const [connected, setConnected] = useState(false);
  const [kindCounts, setKindCounts] = useState(ZERO_KINDS);
  const [queue, setQueue] = useState<StageQueueView>(EMPTY_QUEUE);
  const [revenueUnits, setRevenueUnits] = useState("0");
  const [txCount, setTxCount] = useState(0);

  const ring = useRef<StageFeedRing>(makeRing());
  // Keep the callback in a ref so an inline closure doesn't churn the socket.
  const onActivityRef = useRef(onActivity);
  onActivityRef.current = onActivity;

  useEffect(() => {
    if (!room) {
      setActivity([]);
      setBlockNumber(null);
      setClosed(false);
      setConnected(false);
      setKindCounts(ZERO_KINDS);
      setQueue(EMPTY_QUEUE);
      setRevenueUnits("0");
      setTxCount(0);
      ring.current = makeRing();
      return;
    }

    let cancelled = false;
    // Per-room monotonic cursor — drops hello-backlog duplicates on reconnect.
    let lastSeq = 0;

    const accept = (event: StageActivityEvent, live: boolean): boolean => {
      if (event.seq <= lastSeq) {
        return false;
      }
      lastSeq = event.seq;
      setKindCounts((k) => ({ ...k, [event.kind]: k[event.kind] + 1 }));
      bumpRing(ring.current, Math.floor(event.serverTs / 1000));
      if (live) {
        onActivityRef.current?.(event);
      }
      return true;
    };

    const url = new URL(SERVICE_URLS[publicEnv.NEXT_PUBLIC_APP_ENV].ws);
    url.pathname = "/ws/stage";
    url.searchParams.set("room", room);

    const socket = new ReconnectingWebSocket(url.toString(), undefined, {
      maxReconnectionDelay: 8000,
      minReconnectionDelay: 500,
      reconnectionDelayGrowFactor: 2,
    });

    socket.addEventListener("open", () => {
      if (!cancelled) {
        setConnected(true);
      }
    });
    socket.addEventListener("close", () => {
      if (!cancelled) {
        setConnected(false);
      }
    });
    socket.addEventListener("message", (raw: MessageEvent) => {
      if (cancelled || typeof raw.data !== "string") {
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.data);
      } catch {
        return;
      }
      const result = StageFeedMessage.safeParse(parsed);
      if (!result.success) {
        return;
      }
      const msg = result.data;
      switch (msg.type) {
        case "hello": {
          const fresh = msg.recent.filter((e) => accept(e, false));
          if (fresh.length > 0) {
            setActivity((prev) =>
              [...fresh.toReversed(), ...prev].slice(0, MAX_ACTIVITY)
            );
          }
          setAllowPrompts(msg.allowPrompts);
          setBlockNumber((b) => msg.block ?? b);
          setQueue(msg.queue);
          setRevenueUnits(msg.revenueUnits);
          setTxCount(msg.txCount);
          break;
        }
        case "activity": {
          if (accept(msg.event, true)) {
            setActivity((prev) => [msg.event, ...prev].slice(0, MAX_ACTIVITY));
          }
          break;
        }
        case "block": {
          setBlockNumber(msg.number);
          break;
        }
        case "queue": {
          setQueue(msg.queue);
          break;
        }
        case "count": {
          setRevenueUnits(msg.revenueUnits);
          setTxCount(msg.txCount);
          break;
        }
        case "closed": {
          setClosed(true);
          // Terminal — without this, partysocket re-dials a dead room forever.
          socket.close();
          break;
        }
        default: {
          break;
        }
      }
    });

    return () => {
      cancelled = true;
      socket.close();
    };
  }, [room]);

  return {
    activity,
    allowPrompts,
    blockNumber,
    closed,
    connected,
    kindCounts,
    queue,
    revenueUnits,
    ring,
    txCount,
  };
};
