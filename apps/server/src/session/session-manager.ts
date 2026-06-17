import type { SessionRegistry } from "@sonara/api/server";
import type { LiveSessionId } from "@sonara/shared/typeid";

import { getPool } from "../db/pool";
import type { Logger } from "../lib/logger";
import { finalizeRecordingSet } from "../library/recording-set";
import { Session } from "./session";

// The registry of live runs, keyed by DURABLE identity, not by socket:
//
//   stg_…            stage-keyed (new clients): at most one run per stage;
//                    survives reconnects via the grace window; a second
//                    screen takes over.
//   anon:<anonId>    anon stage-keyed: same grace semantics, demo-only.
//   conn:<wsId>      legacy clients (they sent ?liveSessionId=) and tickets
//                    minted by the previous build: verbatim old behavior —
//                    one entry per socket, finalize immediately on close.
//                    Deleted in the post-W2 cleanup.
//
// The Session object (generation engine) stays ALIVE through the grace
// window: it holds the warm fal pool, scene, anchor and run identity, so a
// reconnecting screen resumes mid-thought instead of cold-starting. The
// `setAttached` gate keeps a screenless run from generating.

const GRACE_MS = 120_000;

// Minimal view of the producer socket the manager needs — satisfied by Bun's
// ServerWebSocket and by plain fakes in tests.
export interface AttachedWs {
  close: (code?: number, reason?: string) => void;
  data: { sessionId: string };
}

interface StageEntry {
  graceTimer: ReturnType<typeof setTimeout> | null;
  session: Session;
  ws: AttachedWs | null;
}

export interface AttachOpts {
  key: string;
  // Connection id of the attaching socket (Session.id for fresh runs).
  ws: AttachedWs;
  userId: string | null;
  // stg_ typeid from the ticket; null for anon/legacy.
  stageId: string | null;
  // Legacy clients only — honored as the run id so old sessionStorage
  // identity (and its /s/<set> share links) stays truthful.
  liveSessionId?: LiveSessionId | null;
}

export class SessionManager implements SessionRegistry {
  private readonly entries = new Map<string, StageEntry>();
  private readonly logger: Logger;
  private readonly graceMs: number;

  constructor(logger: Logger, opts: { graceMs?: number } = {}) {
    this.logger = logger;
    this.graceMs = opts.graceMs ?? GRACE_MS;
  }

  // Resolve-or-create the entry for `key` and bind this socket as its screen.
  attach(opts: AttachOpts): { resumed: boolean; session: Session } {
    const entry = this.entries.get(opts.key);
    if (entry) {
      if (entry.ws) {
        const old = entry.ws;
        // Same connection id = the SAME tab reconnecting over a half-dead
        // socket (laptop wake, proxy cut, network switch) before the server
        // noticed the old one died. That's a resume, not a takeover — swap
        // silently, or the tab "kicks itself" and freezes behind the
        // taken-over overlay. The id is minted once per tab and reused for
        // every reconnect attempt, so equality means same logical screen.
        const samePeer = old.data.sessionId === opts.ws.data.sessionId;
        entry.ws = opts.ws;
        if (samePeer) {
          old.close(1000, "stale connection replaced");
          this.logger.info(
            { connectionId: old.data.sessionId, key: opts.key },
            "stale screen socket replaced (same tab reconnect)"
          );
        } else {
          // Genuine takeover: a second device claims the stage. Tell both
          // screens (clients match connectionId against their own); the
          // binding swapped FIRST so the old socket's close callback no-ops.
          entry.session.notifyTakenOver(old.data.sessionId);
          old.close(4409, "screen taken over");
          this.logger.info(
            { key: opts.key, kicked: old.data.sessionId },
            "screen takeover"
          );
        }
      } else {
        // Resume from grace.
        if (entry.graceTimer) {
          clearTimeout(entry.graceTimer);
          entry.graceTimer = null;
        }
        entry.ws = opts.ws;
        this.logger.info({ key: opts.key }, "screen resumed within grace");
      }
      entry.session.setAttached(true);
      return { resumed: true, session: entry.session };
    }

    const session = new Session({
      id: opts.ws.data.sessionId,
      liveSessionId: opts.liveSessionId,
      logger: this.logger,
      stageId: opts.stageId,
      userId: opts.userId,
    });
    this.entries.set(opts.key, {
      graceTimer: null,
      session,
      ws: opts.ws,
    });
    return { resumed: false, session };
  }

  // Screen socket closed. Identity-guarded: a socket kicked by takeover
  // closes late and must not detach the NEW screen.
  detach(key: string, ws: AttachedWs): void {
    const entry = this.entries.get(key);
    if (!entry || entry.ws !== ws) {
      return;
    }
    entry.ws = null;
    entry.session.setAttached(false);
    if (key.startsWith("conn:")) {
      // Legacy semantics: no grace, finalize on close (reconnects re-create
      // and ensureRecordingSet resumes the same set via ON CONFLICT).
      this.endRun(key);
      return;
    }
    entry.graceTimer = setTimeout(() => this.endRun(key), this.graceMs);
    this.logger.info({ graceMs: this.graceMs, key }, "screen detached — grace");
  }

  // Terminal: explicit stop, grace expiry, or legacy close. Idempotent-safe
  // because finalizeRecordingSet is status-guarded SQL.
  endRun(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) {
      return;
    }
    if (entry.graceTimer) {
      clearTimeout(entry.graceTimer);
      entry.graceTimer = null;
    }
    const { session } = entry;
    session.close();
    this.entries.delete(key);
    if (session.userId !== null) {
      const { liveSessionId } = session;
      void (async () => {
        try {
          await finalizeRecordingSet(getPool(), liveSessionId);
        } catch (error) {
          this.logger.warn(
            { error, liveSessionId },
            "recording-set finalize failed"
          );
        }
      })();
    }
  }

  // Shutdown drain (SIGTERM = every Railway deploy): close every session
  // (aborts in-flight jobs, clears timers) and finalize each signed-in run's
  // recording, so a mid-show deploy lands the set as 'final' instead of
  // stranding it in 'recording'. The boot-time finalizeStaleRecordingSets
  // sweep is the crash-path backstop for whatever this never got to run on.
  async closeAll(): Promise<void> {
    const finalizes: Promise<void>[] = [];
    for (const entry of this.entries.values()) {
      if (entry.graceTimer) {
        clearTimeout(entry.graceTimer);
        entry.graceTimer = null;
      }
      const { session } = entry;
      session.close();
      if (session.userId !== null) {
        const { liveSessionId } = session;
        finalizes.push(
          (async () => {
            try {
              await finalizeRecordingSet(getPool(), liveSessionId);
            } catch (error) {
              this.logger.warn(
                { error, liveSessionId },
                "recording-set finalize failed on shutdown"
              );
            }
          })()
        );
      }
    }
    this.entries.clear();
    await Promise.all(finalizes);
  }

  getByKey(key: string): Session | undefined {
    return this.entries.get(key)?.session;
  }

  // --- SessionRegistry: discovery for the operator remote and the lens. ---

  // rawUserId is the raw UUID (matching Session.userId), NOT a typeid.
  listByUserId(rawUserId: string): Session[] {
    const out: Session[] = [];
    for (const entry of this.entries.values()) {
      if (entry.session.userId === rawUserId) {
        out.push(entry.session);
      }
    }
    return out;
  }

  getByLiveSessionId(liveSessionId: string): Session | undefined {
    for (const entry of this.entries.values()) {
      if (entry.session.liveSessionId === liveSessionId) {
        return entry.session;
      }
    }
    return undefined;
  }

  getByStageId(stageId: string): Session | undefined {
    return this.entries.get(stageId)?.session;
  }

  // Liveness nuance for the console: a graced run still exists (lens reads
  // it as live) but has no screen — "no screen connected" copy keys off this.
  screenAttached(stageId: string): boolean {
    const ws = this.entries.get(stageId)?.ws ?? null;
    return ws !== null;
  }

  count(): number {
    return this.entries.size;
  }
}
