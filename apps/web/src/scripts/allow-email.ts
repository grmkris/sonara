#!/usr/bin/env bun
/**
 * Add an email to the allowlist so the holder can sign up via /login.
 *
 * Usage:
 *   bun run --filter=web allow-email <email> [note]
 *
 * Reads `DATABASE_URL` from `apps/web/.env`. Idempotent — re-running with the
 * same email is a no-op. Emails are stored lowercased + trimmed.
 */

import { createDb, SCHEMA } from "@music-visualizer/db";
import { typeIdGenerator } from "@music-visualizer/shared/typeid";

function fail(msg: string): never {
  console.error(`error: ${msg}`);
  process.exit(1);
}

async function main() {
  const [emailRaw, note] = process.argv.slice(2);
  if (!emailRaw) {
    fail("usage: bun run --filter=web allow-email <email> [note]");
  }
  const email = emailRaw.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    fail(`"${email}" doesn't look like a valid email`);
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    fail("DATABASE_URL not set — run from apps/web with .env in place");
  }
  const db = createDb(databaseUrl);
  await db
    .insert(SCHEMA.allowedEmail)
    .values({
      id: typeIdGenerator("allowedEmail"),
      email,
      note: note ?? null,
    })
    .onConflictDoNothing({ target: SCHEMA.allowedEmail.email });
  console.log(`allowed: ${email}${note ? ` (${note})` : ""}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("allow-email failed:", err);
  process.exit(1);
});
