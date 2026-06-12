import type {
  SonaraSceneState,
  ResolvedScene,
  ResolvedSceneCore,
  ResolvedAudioState,
} from "@sonara/shared";

import type { Logger } from "../lib/logger";
import { expandScene, deterministicResolve } from "./scene-llm-expander";

// Module-level cache: scene-hash → expanded core. The hot path (periodic /
// pause / section triggers) does NOT call the LLM — only `drift_modifiers`
// and `audio_state` are per-trigger. The LLM hop fires only on miss, which
// happens when the user changes their `prompt`. Slider knobs do NOT bust
// the cache; they're sent to the LLM at expansion time and modulate the
// deterministic fallback inline.
//
// In-memory only. Server restart re-warms naturally; this is by design — no
// persistence cost, no stale-cross-deploy hazard.

const CACHE_TTL_MS = 5 * 60_000;

interface CacheEntry {
  core: ResolvedSceneCore;
  at: number;
}

const cache = new Map<string, CacheEntry>();

// Background-fill bookkeeping. Multiple triggers can race for the same scene
// hash on a fresh cache miss; we keep one in-flight LLM call per hash and let
// concurrent triggers fall back to deterministic in the meantime.
const inFlight = new Map<string, Promise<ResolvedSceneCore>>();

const hashScene = (s: SonaraSceneState): string =>
  s.prompt.trim().toLowerCase();

const getCached = (hash: string): ResolvedSceneCore | null => {
  const hit = cache.get(hash);
  if (!hit) {
    return null;
  }
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(hash);
    return null;
  }
  return hit.core;
};

export interface ResolveOpts {
  driftModifiers: string[];
  audio: ResolvedAudioState;
  logger: Logger;
  signal?: AbortSignal;
}

// Synchronous-style resolve: returns deterministic immediately on cache miss
// while kicking off a background LLM expansion. The next call for the same
// hash gets the LLM result. This keeps the trigger() hot path non-blocking
// while still warming the cache.
export const resolveScene = (
  scene: SonaraSceneState,
  opts: ResolveOpts
): ResolvedScene => {
  const hash = hashScene(scene);
  const cached = getCached(hash);

  if (!cached && !inFlight.has(hash)) {
    // Fire-and-forget background fill: the chain is intentionally NOT awaited
    // so the hot path stays synchronous; the promise is stashed in `inFlight`
    // for dedupe. Rewriting to await would block the trigger path.
    /* oxlint-disable prefer-await-to-then, prefer-await-to-callbacks -- REVIEW: background fill must stay a non-awaited promise chain */
    const promise = expandScene(scene, {
      logger: opts.logger,
      signal: opts.signal,
    })
      .then((core) => {
        cache.set(hash, { at: Date.now(), core });
        opts.logger.debug(
          {
            driftCandidates: core.drift_candidates.length,
            hash,
            paletteLen: core.color_palette.length,
            subjectsLen: core.subjects.length,
          },
          "scene-resolver: cache filled"
        );
        return core;
      })
      .catch((error) => {
        opts.logger.warn({ error, hash }, "scene-resolver: expand failed");
        const fallback = deterministicResolve(scene);
        // Cache the fallback briefly so we don't re-call the LLM on every
        // subsequent trigger while the upstream is unhealthy. Short TTL so
        // recovery is quick once the LLM comes back.
        cache.set(hash, {
          at: Date.now() - CACHE_TTL_MS + 30_000,
          core: fallback,
        });
        return fallback;
      })
      .finally(() => {
        inFlight.delete(hash);
      });
    /* oxlint-enable prefer-await-to-then, prefer-await-to-callbacks */
    inFlight.set(hash, promise);
  }

  const core = cached ?? deterministicResolve(scene);
  return {
    ...core,
    audio_state: opts.audio,
    drift_modifiers: opts.driftModifiers,
  };
};

// Awaited variant — used by tests / shadow-mode validation that wants the
// real LLM result rather than the deterministic stand-in. Still respects
// the cache and the in-flight dedupe.
export const resolveSceneAwaited = async (
  scene: SonaraSceneState,
  opts: ResolveOpts
): Promise<ResolvedScene> => {
  const hash = hashScene(scene);
  let core = getCached(hash);
  if (!core) {
    const existing = inFlight.get(hash);
    if (existing) {
      core = await existing;
    } else {
      // The promise is stashed in `inFlight` (for cross-call dedupe) BEFORE
      // it is awaited; the chain must stay a promise so concurrent callers
      // share the same in-flight expansion. Rewriting to await would defeat
      // the dedupe.
      /* oxlint-disable prefer-await-to-then -- REVIEW: promise must be shared via inFlight before awaiting */
      const promise = expandScene(scene, {
        logger: opts.logger,
        signal: opts.signal,
      })
        .then((c) => {
          cache.set(hash, { at: Date.now(), core: c });
          return c;
        })
        .finally(() => {
          inFlight.delete(hash);
        });
      /* oxlint-enable prefer-await-to-then */
      inFlight.set(hash, promise);
      core = await promise;
    }
  }
  return {
    ...core,
    audio_state: opts.audio,
    drift_modifiers: opts.driftModifiers,
  };
};
