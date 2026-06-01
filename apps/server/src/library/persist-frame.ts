import {
  type ImageLibraryId,
  type LiveSessionId,
  type UserId,
  typeIdGenerator,
  typeIdToUuid,
} from "@sonara/shared/typeid";
import { getPool } from "../db/pool";
import type { Logger } from "../lib/logger";
import { isConfigured, presignReadUrl, uploadBytes } from "../storage/bucket";

export interface PersistFrameInput {
  userId: UserId;
  sessionId: LiveSessionId;
  deck: string;
  prompt: string;
  model: string;
  seed: number | null;
  palette: string[] | null;
  falUrl: string;
  tMs: number;
  width: number;
  height: number;
  logger: Logger;
}

export interface PersistedFrame {
  id: ImageLibraryId;
  url: string; // presigned read URL
  width: number;
  height: number;
  palette: string[] | null;
  deck: string;
  prompt: string;
  tMs: number;
  sessionId: LiveSessionId;
  createdAt: Date;
}

// Persist one generated frame: fetch the fal URL → upload bytes to the
// Railway bucket → insert an image_library row with source='generated'.
// Returns the persisted row with a fresh presigned read URL, or null on
// any failure (bucket not configured, fal fetch failed, upload failed,
// DB insert failed). NEVER throws; the caller fire-and-forgets and the
// rendering hot path is never blocked.
export async function persistFrame(
  input: PersistFrameInput,
): Promise<PersistedFrame | null> {
  const { logger } = input;

  if (!isConfigured()) {
    logger.debug({ sessionId: input.sessionId }, "persist-frame: bucket not configured; skipping");
    return null;
  }

  const id = typeIdGenerator("imageLibrary");
  const key = `generated/${input.userId}/${id}.webp`;

  let bytes: ArrayBuffer;
  let contentType = "image/webp";
  try {
    const res = await fetch(input.falUrl);
    if (!res.ok) {
      logger.warn(
        { sessionId: input.sessionId, falUrl: input.falUrl, status: res.status },
        "persist-frame: fal fetch non-200",
      );
      return null;
    }
    contentType = res.headers.get("content-type") ?? contentType;
    bytes = await res.arrayBuffer();
  } catch (err) {
    logger.warn(
      { sessionId: input.sessionId, falUrl: input.falUrl, err: String(err) },
      "persist-frame: fal fetch threw",
    );
    return null;
  }

  try {
    await uploadBytes(key, bytes, contentType);
  } catch (err) {
    logger.warn(
      { sessionId: input.sessionId, key, err: String(err) },
      "persist-frame: bucket upload failed",
    );
    return null;
  }

  // Hash is non-unique among generated rows; just feed something stable
  // per (user, prompt, sessionId, tMs) so the partial-unique seed index
  // is never tickled by live rows.
  const promptHash = `gen:${input.sessionId}:${input.tMs}`;
  const userUuid = typeIdToUuid(input.userId).uuid;
  const frameUuid = typeIdToUuid(id).uuid;

  let createdAt: Date;
  try {
    const client = await getPool().connect();
    try {
      const result = await client.query<{ created_at: Date }>(
        `INSERT INTO image_library
           (id, deck, prompt, prompt_hash, model, seed, url, width, height,
            palette, status, source, user_id, session_id, t_ms, source_url)
         VALUES
           ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9,
            $10::text[], 'active', 'generated', $11::uuid, $12, $13, $14)
         RETURNING created_at`,
        [
          frameUuid,
          input.deck,
          input.prompt,
          promptHash,
          input.model,
          input.seed,
          key,
          input.width,
          input.height,
          input.palette,
          userUuid,
          input.sessionId,
          input.tMs,
          input.falUrl,
        ],
      );
      createdAt = result.rows[0]?.created_at ?? new Date();
    } finally {
      client.release();
    }
  } catch (err) {
    logger.warn(
      { sessionId: input.sessionId, key, err: String(err) },
      "persist-frame: DB insert failed (object orphaned in bucket)",
    );
    return null;
  }

  return {
    id,
    url: presignReadUrl(key),
    width: input.width,
    height: input.height,
    palette: input.palette,
    deck: input.deck,
    prompt: input.prompt,
    tMs: input.tMs,
    sessionId: input.sessionId,
    createdAt,
  };
}
