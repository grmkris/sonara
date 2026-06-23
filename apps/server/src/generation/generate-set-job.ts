import { SCHEMA } from "@sonara/db";
import type { Database } from "@sonara/db";
import { typeIdGenerator } from "@sonara/shared/typeid";
import type { FrameSetId } from "@sonara/shared/typeid";
import { eq } from "drizzle-orm";

import {
  COST_PER_FRAME,
  refundOnError,
  tryDebitCredit,
} from "../credits/credit-gate";
import { env } from "../env";
import type { Logger } from "../lib/logger";
import { persistFrame } from "../library/persist-frame";
import { streamPreview } from "./fal-provider";

// Single-process, fire-and-forget runner for "generate a set with AI". There's
// no job queue: a generate RPC creates the set header (status='generating')
// and hands the prompt list here; this loops t2i → persist → append, charging
// one credit per persisted frame, then flips the set to 'final'. A
// deploy/crash mid-loop leaves the set 'generating' with no worker — the boot
// `finalizeStaleRecordingSets` sweep recovers it as a usable partial set.

// Render size — matches streamPreview's default (768², ~$0.0035/image).
const FRAME_SIZE = 768;
// Nominal per-frame offset stamped on the image_library row (display metadata
// only; the curated timeline drives real playback timing via the look cadence
// and per-clip durations).
const NOMINAL_FRAME_MS = 2000;

// One-in-flight-per-user guard: a user can't start a second generation while
// one is still running (each costs real credits + fal calls). In-memory — a
// restart clears it, which is fine: the old loop is dead anyway and the boot
// sweep finalizes its set.
const inFlight = new Set<string>();

export const isUserGenerating = (userId: string): boolean =>
  inFlight.has(userId);

// Deterministic seed from (prompt, index) so a given spec renders
// reproducibly and the seeds are well-spread across the set. Plain
// multiplicative string hash kept positive + bounded by a per-step modulo
// (no bitwise — the lint preset forbids it and a real uint32 mix isn't
// needed; we only want a stable, spread integer).
const SEED_MODULO = 2_000_000_000;
const seedFrom = (prompt: string, index: number): number => {
  let h = (2_166_136_261 + index * 16_777_619) % SEED_MODULO;
  for (let k = 0; k < prompt.length; k += 1) {
    h = (h * 31 + (prompt.codePointAt(k) ?? 0)) % SEED_MODULO;
  }
  return h;
};

// Promisify the callback-shaped streamPreview into "await one t2i url".
// streamPreview never rejects (it routes every failure — including abort —
// through onError), so resolving/rejecting from the callbacks is complete.
const renderFrame = (args: {
  prompt: string;
  seed: number;
  signal: AbortSignal;
  logger: Logger;
}): Promise<string> =>
  // oxlint-disable-next-line promise/avoid-new -- promisify streamPreview's callback API (onFinal/onError) into a single awaitable url
  new Promise<string>((resolve, reject) => {
    let settled = false;
    void streamPreview({
      logger: args.logger,
      onError: (err) => {
        if (!settled) {
          settled = true;
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      },
      onFinal: (url) => {
        if (!settled) {
          settled = true;
          resolve(url);
        }
      },
      // t2i: there's no distinct preview — onFinal carries the settled url.
      onPreview: () => {
        // intentionally ignored
      },
      prompt: args.prompt,
      seed: args.seed,
      signal: args.signal,
    });
  });

interface RunArgs {
  db: Database;
  userId: string;
  setId: FrameSetId;
  prompts: string[];
  logger: Logger;
}

const runLoop = async (args: RunArgs): Promise<void> => {
  const { db, logger, prompts, setId, userId } = args;
  // Synthetic session id: image_library rows require one, but a generated set
  // has no live session. A fresh lse id groups this job's frames harmlessly.
  const jobSessionId = typeIdGenerator("liveSession");
  const controller = new AbortController();
  let position = 0;

  // Sequential by design: each frame gates a credit → renders → persists in
  // order, and the loop stops the instant the user runs out of credits.
  // Parallelizing would defeat the stop-on-empty gate and hammer fal.
  /* oxlint-disable no-await-in-loop -- intentional per-frame sequential pipeline */
  for (let i = 0; i < prompts.length; i += 1) {
    const prompt = prompts[i] as string;

    const gate = await tryDebitCredit({
      cost: COST_PER_FRAME,
      isUserInitiated: true,
      lastCreditDenialAt: 0,
      logger,
      now: Date.now(),
      userId,
    });
    if (!gate.ok) {
      logger.info(
        { reason: gate.reason, setId },
        "generate-set: stopping early (credit gate)"
      );
      break;
    }

    let url: string;
    try {
      url = await renderFrame({
        logger,
        prompt,
        seed: seedFrom(prompt, i),
        signal: controller.signal,
      });
    } catch (error) {
      logger.warn({ error, i, setId }, "generate-set: render failed; skipping");
      refundOnError(userId, gate.paidCost, logger);
      continue;
    }

    const frameId = typeIdGenerator("imageLibrary");
    const persisted = await persistFrame({
      deck: "generated",
      falUrl: url,
      height: FRAME_SIZE,
      id: frameId,
      logger,
      model: env.FAL_TEXT_MODEL,
      palette: null,
      prompt,
      seed: seedFrom(prompt, i),
      sessionId: jobSessionId,
      tMs: i * NOMINAL_FRAME_MS,
      triggerReason: "generated",
      userId,
      width: FRAME_SIZE,
    });
    if (!persisted) {
      refundOnError(userId, gate.paidCost, logger);
      continue;
    }

    try {
      await db
        .insert(SCHEMA.frameSetFrame)
        .values({ frameId, position, setId });
      position += 1;
      await db
        .update(SCHEMA.frameSet)
        .set({ frameCount: position })
        .where(eq(SCHEMA.frameSet.id, setId));
    } catch (error) {
      // Frame persisted but couldn't be linked — refund so we don't bill for
      // a frame the set never gained.
      logger.warn(
        { error, i, setId },
        "generate-set: membership insert failed"
      );
      refundOnError(userId, gate.paidCost, logger);
    }
  }
  /* oxlint-enable no-await-in-loop */

  try {
    await db
      .update(SCHEMA.frameSet)
      .set({ status: "final" })
      .where(eq(SCHEMA.frameSet.id, setId));
  } catch (error) {
    logger.error(
      { error, setId },
      "generate-set: finalize failed (boot sweep recovers it)"
    );
  }
  logger.info({ frameCount: position, setId }, "generate-set: complete");
};

// Fire-and-forget. Marks the user in-flight, runs the loop detached (never
// awaited by the RPC), and always clears the guard when it settles.
export const startSetGeneration = (args: RunArgs): void => {
  inFlight.add(args.userId);
  void (async () => {
    try {
      await runLoop(args);
    } catch (error) {
      args.logger.error(
        { error, setId: args.setId },
        "generate-set: loop threw unexpectedly"
      );
    } finally {
      inFlight.delete(args.userId);
    }
  })();
};
