import { beforeAll, beforeEach, expect, mock, test } from "bun:test";

import { createRouterClient } from "@orpc/server";
import { SCHEMA } from "@sonara/db";
import { typeIdGenerator } from "@sonara/shared/typeid";
import { createTestUser } from "@sonara/test-utils/factories";
import { makeServerCtx } from "@sonara/test-utils/orpc";
import { getTestDb } from "@sonara/test-utils/test-db";
import type { TestDb } from "@sonara/test-utils/test-db";
import { eq } from "drizzle-orm";

import type { moodRouter as Router } from "./mood.router";
import type { ServerHttpContext } from "./procedures";

void mock.module("../storage/bucket", () => ({
  presignReadUrl: (key: string) => `https://signed.test/${key}`,
}));
let moodRouter: typeof Router;

let database: TestDb;
const owner = typeIdGenerator("user");
const stranger = typeIdGenerator("user");
const client = (userId: typeof owner | null) =>
  createRouterClient(moodRouter, {
    context: makeServerCtx({ db: database.db, userId }) as ServerHttpContext,
  });
beforeAll(async () => {
  database = await getTestDb();
  ({ moodRouter } = await import("./mood.router"));
}, 30_000);
beforeEach(async () => {
  await database.reset();
  await createTestUser(database.db, {
    email: "mood@test.dev",
    id: owner,
    name: "Owner",
  });
  await createTestUser(database.db, {
    email: "other-mood@test.dev",
    id: stranger,
    name: "Other",
  });
});
test("one image request is durable and retries reuse one private set and job", async () => {
  const input = { prompt: "Moonlit garden", requestId: crypto.randomUUID() };
  const first = await client(owner).generate(input);
  expect(await client(owner).generate(input)).toEqual(first);
  const jobs = await database.db.select().from(SCHEMA.generationJob);
  expect(jobs).toHaveLength(1);
  expect(jobs[0]?.total).toBe(1);
  expect(jobs[0]?.prompts).toEqual([input.prompt]);
  const sets = await database.db.select().from(SCHEMA.frameSet);
  expect(sets).toHaveLength(1);
  expect(sets[0]?.visibility).toBe("private");
  // A finished job must remain the same request, even after reconnect.
  await database.db.update(SCHEMA.generationJob).set({ status: "done" });
  expect(await client(owner).generate(input)).toEqual(first);
  const finished = await client(owner).status(input);
  expect(finished.status).toBe("done");
  await expect(
    client(owner).generate({ ...input, prompt: "Changed" })
  ).rejects.toThrow();
  await expect(client(stranger).generate(input)).rejects.toThrow();
  await expect(client(stranger).status(input)).rejects.toThrow();
  await expect(client(null).generate(input)).rejects.toThrow();
});
test("a second image cannot queue while the first is running; failed work permits a new explicit request", async () => {
  const input = { prompt: "One", requestId: crypto.randomUUID() };
  const { setId } = await client(owner).generate(input);
  await expect(
    client(owner).generate({ ...input, requestId: crypto.randomUUID() })
  ).rejects.toThrow("still being made");
  await database.db
    .update(SCHEMA.generationJob)
    .set({ status: "failed" })
    .where(eq(SCHEMA.generationJob.setId, setId));
  const failed = await client(owner).status(input);
  expect(failed.url).toBeNull();
  await client(owner).generate({
    prompt: "Two",
    requestId: crypto.randomUUID(),
  });
  expect(await database.db.select().from(SCHEMA.generationJob)).toHaveLength(2);
});
