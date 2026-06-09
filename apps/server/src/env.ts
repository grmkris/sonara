import { Environment } from "@sonara/shared";
import { z } from "zod";

// Startup-time env validation. Required keys fail the parse immediately so
// the server refuses to boot into a half-configured state. Optional model
// overrides stay optional because they have sane defaults.
// oxlint-disable-next-line sort-keys -- REVIEW: keys are grouped logically (required vs optional) with per-key documentation; alphabetic reorder would scramble the doc-comment associations
const envSchema = z.object({
  // Which environment this is (local | dev | prod). Required — no default, so a
  // misconfigured deploy fails loudly instead of silently using local URLs.
  // Drives every per-environment URL via SERVICE_URLS, the logger transport,
  // and the Dodo mode. (NODE_ENV stays for library behaviour only.)
  APP_ENV: Environment,
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(4471),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),

  // Required — without any of these the server cannot do its job.
  // Better Auth + WS ticket HMAC key
  BETTER_AUTH_SECRET: z.string().min(1),
  // credits ledger + auth tables
  DATABASE_URL: z.string().url(),
  // image generation + image-anchor upload
  FAL_KEY: z.string().min(1),
  // song recognition
  AUDD_API_KEY: z.string().min(1),

  // The public origin (Caddy gateway), the WS origin, and the Dodo test/live
  // mode are all derived from APP_ENV via SERVICE_URLS / dodoModeForEnv in
  // @sonara/shared — no per-URL env vars.

  // Optional in dev — empty values disable the dodopayments plugin and the
  // checkout/webhook flow. Login works without Dodo configured. Required in
  // production deploys (set all via Railway env on the server service).
  DODO_PAYMENTS_API_KEY: z.string().default(""),
  DODO_PAYMENTS_WEBHOOK_SECRET: z.string().default(""),
  // Dodo product IDs for the credit packs (see packages/shared pricing).
  // Required only when the checkout flow is active.
  DODO_PRODUCT_STARTER: z.string().default(""),
  DODO_PRODUCT_PRO: z.string().default(""),
  DODO_PRODUCT_MAX: z.string().default(""),

  // Optional — text-mode fal model. Every text-mode keyframe goes through
  // this one text-to-image endpoint. No /edit pipeline.
  FAL_TEXT_MODEL: z.string().default("fal-ai/flux-2/klein/9b"),
  // Image-anchor fal model — accepts image_url + image_prompt_strength.
  // Separate code path from FAL_TEXT_MODEL (see anchor-provider.ts).
  // Heavier model, billed at ANCHOR_FRAME_COST_CREDITS per frame.
  FAL_ANCHOR_MODEL: z.string().default("fal-ai/flux-pro/v1.1-ultra"),
  // LLM endpoint used by scene-llm-expander (drift candidate generation) and
  // song-muse (track → prompt synthesis). Not used by voice — voice is
  // direct dictation with no LLM round-trip.
  FAL_LLM_MODEL: z.string().optional(),

  // Railway Bucket (S3-compatible, Tigris-backed). Stores every persisted
  // generated frame so users can browse their library / timeline. Optional
  // in dev — when any of these is empty, persistFrame() becomes a no-op and
  // logs a warning. In prod they're wired via reference variables to the
  // sonara-frames bucket. Bucket is private; we serve via presigned URLs.
  S3_BUCKET: z.string().default(""),
  S3_ACCESS_KEY_ID: z.string().default(""),
  S3_SECRET_ACCESS_KEY: z.string().default(""),
  S3_ENDPOINT: z.string().default(""),
  S3_REGION: z.string().default("auto"),
  // Presigned read URL TTL. 7 days = 604800. Long enough to survive a tab
  // left open for a few days; the library.list RPC always returns fresh
  // URLs so any stale ones just need a refetch.
  S3_PRESIGN_TTL_SEC: z.coerce.number().int().positive().default(604_800),

  // Monad "stage" (on-chain visual control). All optional — when MONAD_RPC_WSS
  // and SONARA_STAGE_CONTRACT are both set, the server starts the on-chain
  // event listener at boot; otherwise the feature is dormant (no listener, the
  // control.openStage endpoint still mints rooms but nothing drives them).
  MONAD_RPC_WSS: z.string().default("wss://testnet-rpc.monad.xyz"),
  SONARA_STAGE_CONTRACT: z.string().default(""),
  // How long each queued prompt holds the projector before the next advances.
  PROMPT_DWELL_MS: z.coerce.number().int().positive().default(12_000),
  // EOA key the MCP agent signs with (it pays its own gas in testnet MON).
  MCP_AGENT_KEY: z.string().default(""),
  // Optional Pimlico key to lift the public bundler rate limit before a demo.
  PIMLICO_API_KEY: z.string().default(""),
});

export const env = envSchema.parse(Bun.env);
export type Env = typeof env;
