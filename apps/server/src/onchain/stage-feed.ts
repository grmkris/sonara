import type {
  StageActivityEvent,
  StageFeedMessage,
  StageQueueSnapshot,
} from "@sonara/shared";
import type { ServerWebSocket } from "bun";

import { env } from "../env";
import { logger } from "../lib/logger";
import { deriveAgentAddress, StageActivityLog } from "./stage-activity";
import type { StageActivityInput } from "./stage-activity";
import { stageRooms } from "./stage-rooms";
import { stageState } from "./stage-state";

// The public per-room stage feed: a raw read-only WebSocket at /ws/stage that
// pushes StageFeedMessage frames (activity ticker, block heartbeat, queue,
// counters) to the projector overlay, audience phones, and the host panel.
//
// Deliberately a SEPARATE socket from /ws (the oRPC session wire): the
// rooms-and-roles plan's transport rule is "never raw frames on the oRPC
// socket", and the room code — not an auth ticket — is the capability here,
// exactly like control.stageSnapshot. Bun's native pub/sub is the fan-out:
// each socket subscribes to its room topic + the global block topic; the
// listener publishes via server.publish. Everything lives in this module so
// server.ts only gains delegation lines (that file is being rewritten by the
// rooms refactor).

export interface StageFeedWsData {
  kind: "stage";
  room: string;
}

// Structural slices of Bun.Server so this module doesn't depend on server.ts's
// WsData union (and stays trivially testable with fakes).
interface StageUpgrader {
  upgrade(req: Request, opts: { data: StageFeedWsData }): boolean;
}
interface StagePublisher {
  publish(topic: string, data: string): number;
}

const TOPIC_BLOCKS = "stage:blocks";
const topicFor = (room: string): string => `stage:${room}`;

export const stageActivity = new StageActivityLog({
  agentAddress: deriveAgentAddress(env.MCP_AGENT_KEY),
});

// server.publish needs the Bun.Server instance, which doesn't exist yet when
// the stage listener is constructed — so publishes no-op until server.ts binds
// it after Bun.serve returns. Activity is still RECORDED before binding; the
// backlog rides the next hello frame, so nothing is lost.
let publisher: StagePublisher | null = null;
export const bindStagePublisher = (server: StagePublisher): void => {
  publisher = server;
};

const send = (room: string, msg: StageFeedMessage): void => {
  publisher?.publish(topicFor(room), JSON.stringify(msg));
};

// Record + fan out one decoded on-chain action, plus the updated counters.
// Call AFTER stageState.bump so the count frame reflects this event.
export const publishActivity = (
  room: string,
  input: StageActivityInput
): StageActivityEvent => {
  const event = stageActivity.record(room, input);
  send(room, { event, type: "activity" });
  const live = stageState.get(room);
  send(room, {
    revenueUnits: live.revenueUnits,
    txCount: live.txCount,
    type: "count",
  });
  return event;
};

export const publishQueue = (room: string, queue: StageQueueSnapshot): void => {
  send(room, { queue, type: "queue" });
};

// Monad block heartbeat (~400ms). Tracked so hello frames can carry the last
// block immediately instead of waiting for the next tick.
let lastBlock: number | null = null;
export const publishBlock = (blockNumber: bigint): void => {
  lastBlock = Number(blockNumber);
  publisher?.publish(
    TOPIC_BLOCKS,
    JSON.stringify({ number: lastBlock, type: "block" } satisfies StageFeedMessage)
  );
};

// Live feed sockets per room, so closing a stage can close its watchers.
const socketsByRoom = new Map<string, Set<ServerWebSocket<StageFeedWsData>>>();

// fetch-side handler for GET /ws/stage?room=… . Bun contract: returning a
// Response means rejected; undefined means the upgrade succeeded and the
// websocket hooks take over. Unknown/closed room → 404 (the room code is the
// capability — same trust model as control.stageSnapshot).
export const tryUpgradeStageFeed = (
  req: Request,
  server: StageUpgrader
): Response | undefined => {
  const room = (new URL(req.url).searchParams.get("room") ?? "")
    .trim()
    .toUpperCase();
  if (!(room && stageRooms.resolve(room))) {
    return new Response("unknown room", { status: 404 });
  }
  return server.upgrade(req, { data: { kind: "stage", room } })
    ? undefined
    : new Response("upgrade failed", { status: 400 });
};

export const stageFeedHooks = {
  close(ws: ServerWebSocket<StageFeedWsData>): void {
    const set = socketsByRoom.get(ws.data.room);
    set?.delete(ws);
    if (set?.size === 0) {
      socketsByRoom.delete(ws.data.room);
    }
  },

  open(ws: ServerWebSocket<StageFeedWsData>): void {
    const { room } = ws.data;
    // Re-check the binding: the room can close between upgrade and open.
    const binding = stageRooms.resolve(room);
    if (!binding) {
      ws.close(4404, "room closed");
      return;
    }
    let set = socketsByRoom.get(room);
    if (!set) {
      set = new Set();
      socketsByRoom.set(room, set);
    }
    set.add(ws);
    ws.subscribe(topicFor(room));
    ws.subscribe(TOPIC_BLOCKS);
    const live = stageState.get(room);
    ws.send(
      JSON.stringify({
        allowPrompts: binding.allowPrompts,
        block: lastBlock,
        queue: { nowPlaying: live.nowPlaying, upNext: live.upNext },
        recent: stageActivity.recent(room),
        revenueUnits: live.revenueUnits,
        room,
        txCount: live.txCount,
        type: "hello",
      } satisfies StageFeedMessage)
    );
    logger.info({ room, watchers: set.size }, "stage feed socket opened");
  },
};

// Room teardown: tell watchers the show is over, close their sockets, and
// drop the room's in-memory feed state. Registered once at module load —
// control.router keeps calling plain stageRooms.close() and never learns
// about the feed.
stageRooms.onClose((room) => {
  const frame = JSON.stringify({ type: "closed" } satisfies StageFeedMessage);
  for (const ws of socketsByRoom.get(room) ?? []) {
    ws.send(frame);
    ws.close(1000, "stage closed");
  }
  socketsByRoom.delete(room);
  stageActivity.clear(room);
  stageState.clear(room);
  logger.info({ room }, "stage feed closed");
});
