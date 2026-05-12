// Barrel for `@music-visualizer/db/schema`. Each domain file is grouped by
// responsibility:
//
//   auth.db.ts     Better Auth tables (user, session, account, verification,
//                  walletAddress). Drizzle adapter reads these.
//   credits.db.ts  credit balance + usage ledger + free-tier quota.
export * from "./auth.db";
export * from "./credits.db";
