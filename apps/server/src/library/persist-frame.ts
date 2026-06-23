import { SCHEMA } from "@sonara/db";
import type { InspectorContext } from "@sonara/shared";
import { typeIdToUuid } from "@sonara/shared/typeid";
import type {
  ImageLibraryId,
  LiveSessionId,
  UserId,
} from "@sonara/shared/typeid";

import { getDb } from "../db/db";
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
  // App-standard `usr_…` typeid. drizzle stores the uuid; the bucket key
  // derives the raw uuid form (see below).
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
  // Bucket key keeps the raw-uuid prefix (generated/<uuid>/<frame-typeid>.webp)
  // so existing and new objects share one layout — drizzle stores the uuid in
  // the row, but the object path is addressed by the raw uuid.
  const userUuid = typeIdToUuid(input.userId).uuid;
  const key = `generated/${userUuid}/${id}.webp`;

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
  // per (session, tMs) so the partial-unique seed index is never tickled by
  // live rows.
  const promptHash = `gen:${input.sessionId}:${input.tMs}`;

  let createdAt: Date;
  try {
    const [row] = await getDb()
      .insert(SCHEMA.imageLibrary)
      .values({
        // Store a durable bucket key when the anchor came from our bucket so
        // it can be re-presigned on read; keep external/public URLs as-is.
        anchorUrl: input.anchorUrl
          ? (bucketKeyFromUrl(input.anchorUrl) ?? input.anchorUrl)
          : null,
        deck: input.deck,
        height: input.height,
        id: input.id,
        inspectorContext: input.inspectorContext ?? null,
        model: input.model,
        palette: input.palette,
        prompt: input.prompt,
        promptHash,
        seed: input.seed,
        sessionId: input.sessionId,
        source: "generated",
        sourceUrl: input.falUrl,
        status: "active",
        tMs: input.tMs,
        triggerReason: input.triggerReason ?? null,
        url: key,
        userId: input.userId,
        width: input.width,
      })
      .returning();
    createdAt = row?.createdAt ?? new Date();
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
