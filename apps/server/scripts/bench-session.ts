/**
 * End-to-end latency harness for the LIVE session flow — the same path the
 * browser drives (goLive / scene.patch → frame.final), but in-process so we can
 * time each stage. Hits REAL fal + the REAL scene LLM, so it measures true
 * latency (not a mocked CI test).
 *
 * The session emits `generation.requested` AFTER the credit gate + LLM resolve
 * but BEFORE the fal call, which lets us split the total cleanly:
 *   resolve+gate = t(generation.requested) - t0   (LLM expand/moderate + credit)
 *   fal gen      = t(frame.final) - t(generation.requested)
 *   TOTAL        = t(frame.final) - t0
 *
 * Run:  cd apps/server && bun scripts/bench-session.ts
 *       BENCH_USER=<uuid> overrides the credited user (default: the local test
 *       user). The user needs credits (the credit gate is real).
 */
import type { Logger } from "../src/lib/logger";
import { Session } from "../src/session/session";

// Minimal logger stub — keep the harness output clean.
const noop = (): void => {
  // no-op sink for harness logging
};
const logger = {
  child: () => logger,
  debug: noop,
  error: noop,
  info: noop,
  warn: noop,
} as unknown as Logger;

const sleep = (ms: number): Promise<void> =>
  // oxlint-disable-next-line promise/avoid-new -- REVIEW: setTimeout has no promise form
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const USER =
  process.env.BENCH_USER ?? "019ead3b-4aaf-7ff8-a9bf-ff1182c14b8c";

const session = new Session({
  id: "bench-session",
  liveSessionId: null,
  logger,
  userId: USER,
});

interface Marks {
  requested?: number;
  preview?: number;
  final?: number;
  error?: string;
}
let marks: Marks = {};
let resolveCurrent: (() => void) | null = null;

// Background event consumer — routes the session's events to the active measure.
void (async () => {
  for await (const ev of session.subscribe()) {
    const now = performance.now();
    if (ev.type === "generation.requested" && marks.requested === undefined) {
      marks.requested = now;
    } else if (ev.type === "frame.preview" && marks.preview === undefined) {
      marks.preview = now;
    } else if (ev.type === "frame.final") {
      marks.final = now;
      resolveCurrent?.();
    } else if (ev.type === "job.status" && ev.status === "error") {
      marks.error = ev.message ?? "error";
      resolveCurrent?.();
    }
  }
})();

const pad = (n: number | null, w = 6): string =>
  (n === null ? "  n/a" : `${n}`).padStart(w);

const measure = async (label: string, action: () => void): Promise<void> => {
  marks = {};
  const t0 = performance.now();
  // oxlint-disable-next-line promise/avoid-new -- REVIEW: bridging the session's event stream (resolved on frame.final) into an awaitable
  await new Promise<void>((resolve) => {
    resolveCurrent = resolve;
    action();
    // safety timeout so a stuck frame doesn't hang the run
    setTimeout(resolve, 30_000);
  });
  resolveCurrent = null;
  if (marks.error !== undefined) {
    process.stdout.write(`  ${label.padEnd(24)} ERROR: ${marks.error}\n`);
    return;
  }
  const req =
    marks.requested === undefined ? null : Math.round(marks.requested - t0);
  const fin = marks.final === undefined ? null : Math.round(marks.final - t0);
  const gen =
    marks.final === undefined || marks.requested === undefined
      ? null
      : Math.round(marks.final - marks.requested);
  process.stdout.write(
    `  ${label.padEnd(24)} resolve+gate=${pad(req)}ms   fal gen=${pad(gen)}ms   TOTAL=${pad(fin)}ms\n`
  );
  // small gap so the next edit is a clean, separate trigger
  await sleep(300);
};

const main = async (): Promise<void> => {
  process.stdout.write(
    `\n=== live-session flow latency (user=${USER.slice(0, 8)}…, default model) ===\n`
  );
  process.stdout.write(
    "(resolve+gate = LLM expand/moderate + credit; fal gen = realtime/queue round-trip)\n\n"
  );

  await measure("goLive (cold)", () => {
    session.goLive("a serene koi pond at dawn, sumi-e ink wash", null);
  });
  await measure("edit → snow leopard", () => {
    session.applyPatch(
      { prompt: "a snow leopard on a misty cliff, dramatic light" },
      "client"
    );
  });
  await measure("edit → neon tokyo", () => {
    session.applyPatch(
      { prompt: "a neon tokyo street in the rain, cinematic" },
      "client"
    );
  });
  await measure("re-edit koi (LLM cache)", () => {
    session.applyPatch(
      { prompt: "a serene koi pond at dawn, sumi-e ink wash" },
      "client"
    );
  });

  session.close();
  process.stdout.write("\n");
  process.exit(0);
};

void main();
