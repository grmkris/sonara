import type { SessionRegistry } from "@sonara/api/server";

import type { Logger } from "../lib/logger";
import { Session } from "./session";

export class SessionManager implements SessionRegistry {
  private readonly sessions = new Map<string, Session>();
  private readonly logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  create(id: string, userId: string | null): Session {
    const existing = this.sessions.get(id);
    if (existing) {
      existing.close();
    }
    const session = new Session({ id, logger: this.logger, userId });
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
  }

  count(): number {
    return this.sessions.size;
  }
}
