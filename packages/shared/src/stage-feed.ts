import { z } from "zod";

// Wire types for the public per-room stage feed WebSocket (/ws/stage?room=…)
// — the push channel behind the crowd "wire" UI (live activity ticker, prompt
// queue). The server's stage-actions module publishes these via Bun pub/sub;
// apps/web consumes them in use-stage-feed. Lives in shared so both ends
// parse with the same schemas (server never sends, web never accepts,
// anything outside this union).

// Crowd prompts are capped at this length everywhere: the RPC input, the
// dwell queue, the activity log, and the composer textarea.
export const MAX_STAGE_PROMPT_CHARS = 200;

// The continuous scene knobs the crowd can drive. Mirrors the audio-reactive
// fields of SonaraSceneState; the RPC input enum.
export const StageKnobName = z.enum([
  "intensity",
  "softness",
  "surrealness",
  "abstraction",
  "stability",
]);
export type StageKnobName = z.infer<typeof StageKnobName>;

// One queued/playing prompt as the audience sees it. Mirrors the server's
// PromptView (prompt-queue.ts) structurally — text + sender handle.
export const StagePromptView = z.object({
  text: z.string(),
  who: z.string(),
});
export type StagePromptView = z.infer<typeof StagePromptView>;

export const StageQueueSnapshot = z.object({
  nowPlaying: StagePromptView.nullable(),
  upNext: z.array(StagePromptView),
});
export type StageQueueSnapshot = z.infer<typeof StageQueueSnapshot>;

// One crowd action, as applied by the server. This is the unit the ticker
// prints. `seq` is a per-room monotonic cursor so clients can dedupe the
// hello backlog against live pushes; `serverTs` is when the server applied
// the action (the basis for "tap → on screen" latency). `who` is an opaque
// per-device handle (e.g. K7QX), never an account.
export const StageActivityEvent = z.object({
  // nudge: normalized signed step in [-1, 1]
  delta: z.number().optional(),
  kind: z.enum(["nudge", "set", "prompt"]),
  knob: StageKnobName.optional(),
  seq: z.number().int().positive(),
  serverTs: z.number(),
  // prompt text (server caps length)
  text: z.string().optional(),
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
    queue: StageQueueSnapshot,
    recent: z.array(StageActivityEvent),
    room: z.string(),
    tapCount: z.number().int().nonnegative(),
    type: z.literal("hello"),
  }),
  z.object({ event: StageActivityEvent, type: z.literal("activity") }),
  z.object({ queue: StageQueueSnapshot, type: z.literal("queue") }),
  z.object({
    tapCount: z.number().int().nonnegative(),
    type: z.literal("count"),
  }),
  z.object({ type: z.literal("closed") }),
]);
export type StageFeedMessage = z.infer<typeof StageFeedMessage>;
