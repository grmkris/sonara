import { beforeAll, beforeEach, expect, mock, test } from "bun:test";

import { createRouterClient } from "@orpc/server";
import { DEFAULT_INSTRUMENT } from "@sonara/shared";
import { typeIdGenerator } from "@sonara/shared/typeid";
import { createTestUser } from "@sonara/test-utils/factories";
import { makeServerCtx } from "@sonara/test-utils/orpc";
import { getTestDb } from "@sonara/test-utils/test-db";
import type { TestDb } from "@sonara/test-utils/test-db";

import type { ServerHttpContext } from "./procedures";
import type { takesRouter as Router } from "./takes.router";

void mock.module("../storage/bucket", () => ({
  bucketKeyFromUrl: () => null,
  isConfigured: () => true,
  presignReadUrl: (key: string) => `https://signed.test/${key}`,
  uploadBytes: () => Promise.resolve(),
}));
let database: TestDb;
let router: typeof Router;
const owner = typeIdGenerator("user");
const stranger = typeIdGenerator("user");
const client = (userId: typeof owner | null) =>
  createRouterClient(router, {
    context: makeServerCtx({ db: database.db, userId }) as ServerHttpContext,
  });
beforeAll(async () => {
  database = await getTestDb();
  ({ takesRouter: router } = await import("./takes.router"));
}, 30_000);
beforeEach(async () => {
  await database.reset();
  await createTestUser(database.db, {
    email: "performer@test.dev",
    id: owner,
    name: "Performer",
  });
  await createTestUser(database.db, {
    email: "viewer@test.dev",
    id: stranger,
    name: "Viewer",
  });
});
test("a procedural take needs no image frames and retries reuse the same set", async () => {
  const c = client(owner);
  const input = {
    clientId: crypto.randomUUID(),
    name: "Liquid performance",
    remix: false,
  };
  const a = await c.begin(input);
  const b = await c.begin(input);
  expect(b.setId).toBe(a.setId);
  const list = await c.list();
  expect(list.length).toBe(1);
  await expect(client(stranger).get(a)).rejects.toThrow();
  await expect(client(null).get(a)).rejects.toThrow();
  await expect(client(stranger).begin(input)).rejects.toThrow();
});
test("chunks are owner-only and retry-safe; finalization refuses gaps", async () => {
  const c = client(owner);
  const id = crypto.randomUUID();
  const { setId } = await c.begin({ clientId: id, name: "Take", remix: false });
  const chunk = {
    contentType: "video/webm",
    data: btoa("video"),
    index: 0,
    kind: "video" as const,
    setId,
  };
  await expect(client(stranger).chunk(chunk)).rejects.toThrow();
  await c.chunk(chunk);
  await c.chunk(chunk);
  await expect(
    c.chunk({ ...chunk, data: btoa("different") })
  ).rejects.toThrow();
  const finish = {
    counts: { audio: 0, events: 1, masks: 0, video: 1 },
    manifest: {
      config: DEFAULT_INSTRUMENT,
      createdAt: new Date().toISOString(),
      duration: 10,
      engine: "sonara-1" as const,
      id,
      name: "Take",
      version: 1 as const,
    },
    setId,
  };
  await expect(c.finalize(finish)).rejects.toThrow();
  await c.chunk({
    ...chunk,
    contentType: "application/json",
    data: btoa("[]"),
    kind: "events",
  });
  await c.finalize(finish);
  await c.finalize(finish);
  await expect(
    c.finalize({ ...finish, manifest: { ...finish.manifest, duration: 20 } })
  ).rejects.toThrow();
  const saved = await c.get({ setId });
  expect(saved.manifest?.duration).toBe(10);
  await expect(c.chunk({ ...chunk, index: 1 })).rejects.toThrow();
});
