import { SCHEMA } from "@sonara/db";
import type { Database } from "@sonara/db";
import { typeIdGenerator } from "@sonara/shared/typeid";
import type {
  FrameSetId,
  ImageLibraryId,
  LiveSessionId,
  UserId,
} from "@sonara/shared/typeid";

// Row factories for the harness DB. Defaults satisfy every NOT NULL and the
// partial unique indexes the real migrations create (promptHash is unique per
// row, so seed inserts never collide on image_library_prompt_hash_idx).

export interface TestUser {
  email: string;
  id: UserId;
  name: string;
}

export const createTestUser = async (
  db: Database,
  overrides: Partial<TestUser> = {}
): Promise<TestUser> => {
  const id = overrides.id ?? (typeIdGenerator("user") as UserId);
  const row = {
    email: overrides.email ?? `${id}@test.dev`,
    emailVerified: true,
    id,
    name: overrides.name ?? "Test User",
  };
  await db.insert(SCHEMA.user).values(row);
  return { email: row.email, id, name: row.name };
};

// userId null + a "/library/..." url models a shipped seed frame; the default
// shape is a live-generated frame in the Railway bucket.
export const insertFrame = async (
  db: Database,
  opts: {
    deck?: string;
    sessionId?: LiveSessionId;
    source?: "generated" | "seed" | "story";
    tMs?: number | null;
    url?: string;
    userId?: UserId | null;
  } = {}
): Promise<ImageLibraryId> => {
  const id = typeIdGenerator("imageLibrary") as ImageLibraryId;
  await db.insert(SCHEMA.imageLibrary).values({
    deck: opts.deck ?? "wild",
    height: 768,
    id,
    model: "test",
    prompt: `frame ${id}`,
    promptHash: `hash-${id}`,
    sessionId: opts.sessionId ?? null,
    source: opts.source ?? "generated",
    tMs: opts.tMs ?? null,
    url: opts.url ?? `generated/${opts.userId ?? "sys"}/${id}.webp`,
    userId: opts.userId ?? null,
    width: 768,
  });
  return id;
};

// Insert a set row directly — recordings and builtins are created by the boot
// converger or the live path, not by the sets router.
export const insertSet = async (
  db: Database,
  opts: {
    deckKey?: string;
    frames?: { id: ImageLibraryId; tMs?: number }[];
    liveSessionId?: LiveSessionId;
    name?: string;
    origin: "builtin" | "curated" | "recording";
    status?: "final" | "recording";
    userId?: UserId | null;
    visibility?: "private" | "public" | "unlisted";
  }
): Promise<FrameSetId> => {
  const [row] = await db
    .insert(SCHEMA.frameSet)
    .values({
      deckKey: opts.deckKey,
      frameCount: opts.frames?.length ?? 0,
      liveSessionId: opts.liveSessionId,
      name: opts.name ?? `${opts.origin} set`,
      origin: opts.origin,
      status: opts.status ?? "final",
      userId: opts.userId ?? null,
      visibility: opts.visibility ?? "private",
    })
    .returning();
  const setId = (row as { id: FrameSetId }).id;
  if (opts.frames?.length) {
    await db.insert(SCHEMA.frameSetFrame).values(
      opts.frames.map((f, i) => ({
        frameId: f.id,
        position: i,
        setId,
        tMs: f.tMs ?? null,
      }))
    );
  }
  return setId;
};
