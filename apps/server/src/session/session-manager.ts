import type { SessionRegistry } from "@sonara/api/server";
import type { LiveSessionId } from "@sonara/shared/typeid";

import { getPool } from "../db/pool";
import type { Logger } from "../lib/logger";
import { finalizeRecordingSet } from "../library/recording-set";
import { Session } from "./session";

export class SessionManager implements SessionRegistry {
  private readonly sessions = new Map<string, Session>();
  private readonly logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  create(
    id: string,
    userId: string | null,
    liveSessionId?: LiveSessionId | null
  ): Session {
    const existing = this.sessions.get(id);
    if (existing) {
      existing.close();
    }
    const session = new Session({
      id,
      liveSessionId,
      logger: this.logger,
      userId,
    });
    this.sessions.set(id, session);
    return session;
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  // --- SessionRegistry: discovery for the operator remote. The map is keyed
  // by the ephemeral per-tab WS id, so finding "this user's live session(s)"
  // means iterating. N is the count of concurrent live connections (small).

  // rawUserId is the raw UUID (matching Session.userId), NOT a typeid.
  listByUserId(rawUserId: string): Session[] {
    const out: Session[] = [];
    for (const session of this.sessions.values()) {
      if (session.userId === rawUserId) {
        out.push(session);
      }
    }
    return out;
  }

  getByLiveSessionId(liveSessionId: string): Session | undefined {
    for (const session of this.sessions.values()) {
      if (session.liveSessionId === liveSessionId) {
        return session;
      }
    }
    return undefined;
  }

  destroy(id: string): void {
    const session = this.sessions.get(id);
    if (!session) {
      return;
    }
    session.close();
    this.sessions.delete(id);
    // The session is truly evicted here (the WS close handler calls destroy;
    // there is no reconnect grace window — a reconnect builds a new Session
    // and ensureRecordingSet resumes status='recording' on the same set), so
    // close out the performance's auto-recorded set. Fire-and-forget: anon
    // sessions never persist frames, so the UPDATE simply matches nothing,
    // but skip the round-trip anyway.
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

  count(): number {
    return this.sessions.size;
  }
}
