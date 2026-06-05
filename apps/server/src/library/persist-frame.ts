import type { InspectorContext } from "@sonara/shared";
import { typeIdToUuid } from "@sonara/shared/typeid";
import type { ImageLibraryId, LiveSessionId } from "@sonara/shared/typeid";

import { getPool } from "../db/pool";
import type { Logger } from "../lib/logger";
import {
  bucketKeyFromUrl,
  isConfigured,
  presignReadUrl,
  uploadBytes,
} from "../storage/bucket";

export interface PersistFrameInput {
  // Pre-minted by the caller so the matching frame.final event can carry
  // the id WITHOUT waiting for the persist round-trip to complete.
  id: ImageLibraryId;
  // Raw user uuid (matches the Session.userId shape + credits.service /
  // library-provider conventions on the server). The library router
  // converts to typeid at the API boundary.
  userId: string;
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
  // Why trigger() fired ('periodic' | 'semantic' | 'section' | 'pause' |
  // 'voice'). Surfaces in /studio inspector. Optional for forward-compat
  // — old call sites pre-/studio would pass undefined.
  triggerReason?: string;
  // Anchor input URL when this was an anchor-mode frame. Optional.
  anchorUrl?: string;
  // Display-only metadata bag for the inspector. Optional.
  inspectorContext?: InspectorContext;
  logger: Logger;
}

export interface PersistedFrame {
  id: ImageLibraryId;
  // presigned read URL
  url: string;
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
export const persistFrame = async (
  input: PersistFrameInput
): Promise<PersistedFrame | null> => {
  const { logger } = input;

  if (!isConfigured()) {
    logger.debug(
      { sessionId: input.sessionId },
      "persist-frame: bucket not configured; skipping"
    );
    return null;
  }

  const { id } = input;
  // Bucket key uses the raw uuid (no `usr_` prefix) so all of one user's
  // frames live under the same prefix without typeid-encoding overhead.
  const key = `generated/${input.userId}/${id}.webp`;

  let bytes: ArrayBuffer;
  let contentType = "image/webp";
  try {
    const res = await fetch(input.falUrl);
    if (!res.ok) {
      logger.warn(
        {
          falUrl: input.falUrl,
          sessionId: input.sessionId,
          status: res.status,
        },
        "persist-frame: fal fetch non-200"
      );
      return null;
    }
    contentType = res.headers.get("content-type") ?? contentType;
    bytes = await res.arrayBuffer();
  } catch (error) {
    logger.warn(
      { err: String(error), falUrl: input.falUrl, sessionId: input.sessionId },
      "persist-frame: fal fetch threw"
    );
    return null;
  }

  try {
    await uploadBytes(key, bytes, contentType);
  } catch (error) {
    logger.warn(
      { err: String(error), key, sessionId: input.sessionId },
      "persist-frame: bucket upload failed"
    );
    return null;
  }

  // Hash is non-unique among generated rows; just feed something stable
  // per (user, prompt, sessionId, tMs) so the partial-unique seed index
  // is never tickled by live rows.
  const promptHash = `gen:${input.sessionId}:${input.tMs}`;
  const frameUuid = typeIdToUuid(id).uuid;

  let createdAt: Date;
  try {
    const client = await getPool().connect();
    try {
      const result = await client.query<{ created_at: Date }>(
        `INSERT INTO image_library
           (id, deck, prompt, prompt_hash, model, seed, url, width, height,
            palette, status, source, user_id, session_id, t_ms, source_url,
            trigger_reason, anchor_url, inspector_context)
         VALUES
           ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9,
            $10::text[], 'active', 'generated', $11::uuid, $12, $13, $14,
            $15, $16, $17::jsonb)
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
          input.userId,
          input.sessionId,
          input.tMs,
          input.falUrl,
          input.triggerReason ?? null,
          // Store a durable bucket key when the anchor came from our bucket so
          // it can be re-presigned on read; keep external/public URLs as-is.
          input.anchorUrl
            ? (bucketKeyFromUrl(input.anchorUrl) ?? input.anchorUrl)
            : null,
          input.inspectorContext
            ? JSON.stringify(input.inspectorContext)
            : null,
        ]
      );
      createdAt = result.rows[0]?.created_at ?? new Date();
    } finally {
      client.release();
    }
  } catch (error) {
    logger.warn(
      { err: String(error), key, sessionId: input.sessionId },
      "persist-frame: DB insert failed (object orphaned in bucket)"
    );
    return null;
  }

  return {
    createdAt,
    deck: input.deck,
    height: input.height,
    id,
    palette: input.palette,
    prompt: input.prompt,
    sessionId: input.sessionId,
    tMs: input.tMs,
    url: presignReadUrl(key),
    width: input.width,
  };
};
