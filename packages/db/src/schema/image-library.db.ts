import { index, integer, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import {
  type ImageLibraryId,
  typeIdGenerator,
} from "@sonara/shared/typeid";
import { baseEntityFields, typeId } from "../utils";

// Pre-generated images served when DEMO mode is on. The server picks one
// row per trigger via apps/server/src/generation/library-provider.ts —
// fal is not called, credits are not debited. Seeded by
// apps/server/scripts/seed-library.ts.
export const imageLibrary = pgTable(
  "image_library",
  {
    id: typeId("imageLibrary", "id")
      .primaryKey()
      .$defaultFn(() => typeIdGenerator("imageLibrary"))
      .$type<ImageLibraryId>(),
    deck: text("deck").notNull(),
    prompt: text("prompt").notNull(),
    // sha256(deck + "::" + prompt). Idempotency key for the seeder so reruns
    // skip rows that were already generated.
    promptHash: text("prompt_hash").notNull(),
    model: text("model").notNull(),
    seed: integer("seed"),
    // Relative under apps/web/public for v1 (e.g. "/library/wild/abc.webp").
    // Stays as a plain string when we swap to absolute URLs from R2 / Railway
    // Volumes later — see the migration note in the plan.
    url: text("url").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    palette: text("palette").array(),
    status: text("status", { enum: ["active", "rejected"] })
      .notNull()
      .default("active"),
    ...baseEntityFields,
  },
  (table) => [
    index("image_library_deck_status_idx").on(table.deck, table.status),
    uniqueIndex("image_library_prompt_hash_idx").on(table.promptHash),
  ],
);
