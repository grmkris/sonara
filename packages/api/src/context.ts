import type { UserId } from "@sonara/shared/typeid";

import type { SessionRegistry } from "./session-registry";

// Session shape the API expects. Apps construct this from their own auth
// system (Better Auth on web) and pass it through createContext. Keeping it
// minimal so the api package stays framework-agnostic.
export interface ApiSession {
  user: {
    id: UserId;
  };
}

export interface CreateContextArgs<TDb> {
  db: TDb;
  session: ApiSession | null;
  // Lookup over the live in-memory sessions, so the authed `control` router
  // can drive a user's own live session from a second device.
  registry: SessionRegistry;
}

export interface ApiContext<TDb> {
  db: TDb;
  session: ApiSession | null;
  userId: UserId | null;
  registry: SessionRegistry;
}

export const buildContext = <TDb>(
  args: CreateContextArgs<TDb>
): ApiContext<TDb> => ({
  db: args.db,
  registry: args.registry,
  session: args.session,
  userId: args.session?.user.id ?? null,
});
