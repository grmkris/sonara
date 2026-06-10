import { SCHEMA } from "@sonara/db";
import type { InspectorContext, LibraryFrame } from "@sonara/shared";
import type { ImageLibraryId, LiveSessionId } from "@sonara/shared/typeid";

import { presignReadUrl } from "../storage/bucket";

// Shared image_library → wire-frame mapping, used by both the library router
// (gallery) and the sets router (recordings / curated cuts). Kept here so the
// column set + presign logic can't drift between the two.

export interface FrameRow {
  id: ImageLibraryId;
  url: string;
  width: number;
  height: number;
  palette: string[] | null;
  deck: string;
  prompt: string;
  tMs: number | null;
  sessionId: LiveSessionId | null;
  createdAt: Date;
  triggerReason: string | null;
  anchorUrl: string | null;
  inspectorContext: InspectorContext | null;
}

// The image_library columns every frame-returning query selects. Usable in a
// plain select or a joined select (frame_set_frame ⨝ image_library).
export const FRAME_COLUMNS = {
  anchorUrl: SCHEMA.imageLibrary.anchorUrl,
  createdAt: SCHEMA.imageLibrary.createdAt,
  deck: SCHEMA.imageLibrary.deck,
  height: SCHEMA.imageLibrary.height,
  id: SCHEMA.imageLibrary.id,
  inspectorContext: SCHEMA.imageLibrary.inspectorContext,
  palette: SCHEMA.imageLibrary.palette,
  prompt: SCHEMA.imageLibrary.prompt,
  sessionId: SCHEMA.imageLibrary.sessionId,
  tMs: SCHEMA.imageLibrary.tMs,
  triggerReason: SCHEMA.imageLibrary.triggerReason,
  url: SCHEMA.imageLibrary.url,
  width: SCHEMA.imageLibrary.width,
} as const;

// Stored frame url/cover → client-readable URL. Three storage shapes coexist:
// bare bucket keys (generated rows — re-presign for a fresh TTL),
// origin-relative public paths (seed rows, "/library/…" — pass through; they
// resolve on the web origin and presigning would mangle them), and absolute
// URLs (fal uploads / legacy presigned — pass through).
export const frameReadUrl = (stored: string): string => {
  if (stored.startsWith("/") || stored.includes("://")) {
    return stored;
  }
  return presignReadUrl(stored);
};

// Maps a DB row to the wire shape, re-presigning the stored bucket key so
// clients always get a fresh read URL. Rows whose tMs or sessionId is null
// (shouldn't happen for source='generated' rows, but defensive) get sensible
// defaults so the client never sees nulls.
export const rowToFrame = (row: FrameRow): LibraryFrame => {
  let anchorUrl: string | null = null;
  if (row.anchorUrl) {
    anchorUrl = frameReadUrl(row.anchorUrl);
  }
  return {
    anchorUrl,
    createdAt: row.createdAt,
    deck: row.deck,
    height: row.height,
    id: row.id,
    inspectorContext: row.inspectorContext,
    palette: row.palette,
    prompt: row.prompt,
    sessionId: (row.sessionId ?? "") as LiveSessionId,
    tMs: row.tMs ?? 0,
    triggerReason: row.triggerReason,
    url: frameReadUrl(row.url),
    width: row.width,
  };
};
