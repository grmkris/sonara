// Barrel for `@sonara/db/schema`. Each domain file is grouped by
// responsibility:
//
//   auth.db.ts        Better Auth tables (user, session, account,
//                     verification). Drizzle adapter reads these.
//   credits.db.ts     credit balance + usage ledger + free-tier quota.
//   allowlist.db.ts   email allowlist gating emailAndPassword signup.
// oxlint-disable-next-line no-barrel-file -- REVIEW: public schema surface for @sonara/db/schema; re-exports are intentional, splitting would break the package API
export * from "./allowlist.db";
export * from "./auth.db";
export * from "./credits.db";
export * from "./frame-set.db";
export * from "./image-library.db";
export * from "./reel.db";
