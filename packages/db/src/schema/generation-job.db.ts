import type { SetLook } from "@sonara/shared";
import { typeIdGenerator } from "@sonara/shared/typeid";
import type {
  FrameSetId,
  GenerationJobId,
  UserId,
} from "@sonara/shared/typeid";
import { index, integer, jsonb, pgTable, text } from "drizzle-orm/pg-core";

import { baseEntityFields, createTimestampField, typeId } from "../utils";
import { user } from "./auth.db";
import { frameSet } from "./frame-set.db";

// A durable, resumable AI set-generation job — the unit of work behind
// "generate a set" and "generate more". Postgres is the queue: a single
// in-process worker claims rows (FOR UPDATE SKIP LOCKED + a lease) and renders
// prompts[cursor] → cursor++ persisting progress every frame, so a deploy or
// crash mid-job RESUMES from the cursor instead of stranding the remaining
// frames. The prompt list grows lazily in chunks (style-anchored) up to
// `total`, which is what makes 200-frame sets and "generate more" tractable.
export const generationJob = pgTable(
  "generation_job",
  // oxlint-disable-next-line sort-keys -- columns grouped by concern (identity / work spec / progress / lease), not alphabetised; key order has no SQL effect
  {
    id: typeId("generationJob", "id")
      .primaryKey()
      .$defaultFn(() => typeIdGenerator("generationJob"))
      .$type<GenerationJobId>(),
    userId: typeId("user", "user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" })
      .$type<UserId>(),
    // The set this job populates. Cascade: deleting the set kills its jobs.
    setId: typeId("frameSet", "set_id")
      .notNull()
      .references(() => frameSet.id, { onDelete: "cascade" })
      .$type<FrameSetId>(),
    kind: text("kind", { enum: ["create", "extend", "insert"] }).notNull(),
    status: text("status", {
      enum: ["pending", "running", "done", "failed", "canceled"],
    })
      .notNull()
      .default("pending"),
    // The user's brief — kept so the worker can expand further prompt batches.
    description: text("description"),
    // The locked "world" anchor (the frame_set.styleDrift successor) passed
    // verbatim to every batch expansion so frames stay coherent.
    styleAnchor: text("style_anchor").notNull(),
    // The baked look applied to the set; carried for re-expansion context.
    look: jsonb("look").$type<SetLook>(),
    // The expanded prompts so far — grows lazily in chunks up to `total`.
    prompts: jsonb("prompts").$type<string[]>().notNull().default([]),
    // Target frame count for this job and the next prompt index to render
    // (persisted every frame → resumable).
    total: integer("total").notNull(),
    cursor: integer("cursor").notNull().default(0),
    // 'insert' jobs splice members starting at this display index; null for
    // append (create / extend).
    insertAt: integer("insert_at"),
    // Worker lease: a claimed row whose lease has expired (a dead process) is
    // re-claimable. Null when not running.
    leaseExpiresAt: createTimestampField("lease_expires_at"),
    error: text("error"),
    ...baseEntityFields,
  },
  (table) => [
    // The claim query scans claimable work by (status, lease).
    index("generation_job_status_lease_idx").on(
      table.status,
      table.leaseExpiresAt
    ),
    index("generation_job_set_idx").on(table.setId),
  ]
);
