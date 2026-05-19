import type { Logger } from "../lib/logger";
import { Session } from "./session";

export class SessionManager {
  private readonly sessions = new Map<string, Session>();
  private readonly logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  create(id: string, userId: string | null): Session {
    const existing = this.sessions.get(id);
    if (existing) existing.close();
    const session = new Session({ id, userId, logger: this.logger });
    this.sessions.set(id, session);
    return session;
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  destroy(id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    session.close();
    this.sessions.delete(id);
  }

  count(): number {
    return this.sessions.size;
  }
}
