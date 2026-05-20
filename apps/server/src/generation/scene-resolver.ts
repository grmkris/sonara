import {
  type SonaraSceneState,
  type ResolvedScene,
  type ResolvedSceneCore,
  type ResolvedAudioState,
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

function hashScene(s: SonaraSceneState): string {
  return s.prompt.trim().toLowerCase();
}

function getCached(hash: string): ResolvedSceneCore | null {
  const hit = cache.get(hash);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(hash);
    return null;
  }
  return hit.core;
}

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
export function resolveScene(
  scene: SonaraSceneState,
  opts: ResolveOpts,
): ResolvedScene {
  const hash = hashScene(scene);
  const cached = getCached(hash);

  if (!cached && !inFlight.has(hash)) {
    const promise = expandScene(scene, {
      logger: opts.logger,
      signal: opts.signal,
    })
      .then((core) => {
        cache.set(hash, { core, at: Date.now() });
        opts.logger.debug(
          {
            hash,
            paletteLen: core.color_palette.length,
            subjectsLen: core.subjects.length,
            driftCandidates: core.drift_candidates.length,
          },
          "scene-resolver: cache filled",
        );
        return core;
      })
      .catch((err) => {
        opts.logger.warn({ err, hash }, "scene-resolver: expand failed");
        const fallback = deterministicResolve(scene);
        // Cache the fallback briefly so we don't re-call the LLM on every
        // subsequent trigger while the upstream is unhealthy. Short TTL so
        // recovery is quick once the LLM comes back.
        cache.set(hash, { core: fallback, at: Date.now() - CACHE_TTL_MS + 30_000 });
        return fallback;
      })
      .finally(() => {
        inFlight.delete(hash);
      });
    inFlight.set(hash, promise);
  }

  const core = cached ?? deterministicResolve(scene);
  return {
    ...core,
    drift_modifiers: opts.driftModifiers,
    audio_state: opts.audio,
  };
}

// Awaited variant — used by tests / shadow-mode validation that wants the
// real LLM result rather than the deterministic stand-in. Still respects
// the cache and the in-flight dedupe.
export async function resolveSceneAwaited(
  scene: SonaraSceneState,
  opts: ResolveOpts,
): Promise<ResolvedScene> {
  const hash = hashScene(scene);
  let core = getCached(hash);
  if (!core) {
    const existing = inFlight.get(hash);
    if (existing) {
      core = await existing;
    } else {
      const promise = expandScene(scene, {
        logger: opts.logger,
        signal: opts.signal,
      })
        .then((c) => {
          cache.set(hash, { core: c, at: Date.now() });
          return c;
        })
        .finally(() => {
          inFlight.delete(hash);
        });
      inFlight.set(hash, promise);
      core = await promise;
    }
  }
  return {
    ...core,
    drift_modifiers: opts.driftModifiers,
    audio_state: opts.audio,
  };
}

// Test/maintenance helpers.
export function _clearResolverCache(): void {
  cache.clear();
  inFlight.clear();
}

export function _resolverCacheSize(): number {
  return cache.size;
}
