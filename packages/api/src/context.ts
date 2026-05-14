import type { UserId } from "@sonara/shared/typeid";

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
}

export interface ApiContext<TDb> {
  db: TDb;
  session: ApiSession | null;
  userId: UserId | null;
}

export function buildContext<TDb>(
  args: CreateContextArgs<TDb>,
): ApiContext<TDb> {
  return {
    db: args.db,
    session: args.session,
    userId: args.session?.user.id ?? null,
  };
}
