import { z } from "zod";

// Wire types for the public per-room stage feed WebSocket (/ws/stage?room=…)
// — the push channel behind the Monad "wire" UI (live tx ticker, block
// heartbeat, prompt queue). The server's onchain listener publishes these via
// Bun pub/sub; apps/web consumes them in use-stage-feed. Lives in shared so
// both ends parse with the same schemas (server never sends, web never
// accepts, anything outside this union).

// The continuous scene knobs in contract enum order. Duplicated from
// @sonara/onchain's STAGE_KNOBS because shared must not depend on onchain
// (web imports shared); the contract enum order is frozen, so drift is a
// compile-time-visible event, not a runtime hazard.
export const StageKnobName = z.enum([
  "intensity",
  "softness",
  "surrealness",
  "abstraction",
  "stability",
]);
export type StageKnobName = z.infer<typeof StageKnobName>;

// One queued/playing prompt as the audience sees it. Mirrors the server's
// PromptView (prompt-queue.ts) structurally — text + sender + tip in 6-dec
// USDC units (string: bigints never ride JSON).
export const StagePromptView = z.object({
  text: z.string(),
  // 6-dec USDC units as string
  tip: z.string(),
  who: z.string(),
});
export type StagePromptView = z.infer<typeof StagePromptView>;

export const StageQueueSnapshot = z.object({
  nowPlaying: StagePromptView.nullable(),
  upNext: z.array(StagePromptView),
});
export type StageQueueSnapshot = z.infer<typeof StageQueueSnapshot>;

// One decoded on-chain action, as heard by the server's event listener. This
// is the unit the ticker prints. `seq` is a per-room monotonic cursor so
// clients can dedupe the hello backlog against live pushes; `serverTs` is
// when the listener heard the log (the basis for "tap → on-chain" latency).
export const StageActivityEvent = z.object({
  // true when `who` is the server-held MCP agent signer (an AI VJ, not a phone)
  agent: z.boolean(),
  blockNumber: z.number().int().nonnegative(),
  // nudge: normalized signed step in [-1, 1]
  delta: z.number().optional(),
  kind: z.enum(["nudge", "set", "prompt"]),
  knob: StageKnobName.optional(),
  // prompt: total USDC pulled (base price + tip), 6-dec units as string
  paid: z.string().optional(),
  seq: z.number().int().positive(),
  serverTs: z.number(),
  // prompt text (server caps length)
  text: z.string().optional(),
  // prompt: priority tip portion, 6-dec USDC units as string
  tip: z.string().optional(),
  txHash: z.string(),
  // set: normalized absolute level in [0, 1]
  value: z.number().optional(),
  who: z.string(),
});
export type StageActivityEvent = z.infer<typeof StageActivityEvent>;

// Everything the server pushes down a stage feed socket. `hello` arrives once
// per (re)connect with the full current state + recent backlog; the rest are
// incremental. `closed` is terminal — the room is gone, don't reconnect.
export const StageFeedMessage = z.discriminatedUnion("type", [
  z.object({
    allowPrompts: z.boolean(),
    // last block number the heartbeat saw; null before the first tick
    block: z.number().nullable(),
    queue: StageQueueSnapshot,
    recent: z.array(StageActivityEvent),
    // total USDC paid into this room's prompts (6-dec units as string)
    revenueUnits: z.string(),
    room: z.string(),
    txCount: z.number().int().nonnegative(),
    type: z.literal("hello"),
  }),
  z.object({ event: StageActivityEvent, type: z.literal("activity") }),
  // Monad block heartbeat (~400ms cadence) — published to every room's feed.
  z.object({ number: z.number(), type: z.literal("block") }),
  z.object({ queue: StageQueueSnapshot, type: z.literal("queue") }),
  z.object({
    revenueUnits: z.string(),
    txCount: z.number().int().nonnegative(),
    type: z.literal("count"),
  }),
  z.object({ type: z.literal("closed") }),
]);
export type StageFeedMessage = z.infer<typeof StageFeedMessage>;
