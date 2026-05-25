import {
  type ImageLibraryId,
  typeIdFromUuid,
  typeIdToUuid,
} from "@sonara/shared/typeid";
import { getPool } from "../db/pool";
import type { Logger } from "../lib/logger";

export interface LibraryPick {
  id: ImageLibraryId;
  url: string;
  width: number;
  height: number;
}

// Pull one active image_library row for the given deck. `excludeIds` is the
// session's small LRU of recently-served typeids so consecutive triggers
// don't repeat. Returns null when the deck is empty (caller should fall
// back to the fal path).
export async function pickLibraryFrame(
  deck: string,
  excludeIds: readonly ImageLibraryId[],
  logger: Logger,
): Promise<LibraryPick | null> {
  const excludeUuids = excludeIds.map((id) => typeIdToUuid(id).uuid);
  const client = await getPool().connect();
  try {
    const pick = async (exclude: string[]) =>
      (
        await client.query<{
          id: string;
          url: string;
          width: number;
          height: number;
        }>(
          `SELECT id::text AS id, url, width, height
             FROM image_library
            WHERE deck = $1
              AND status = 'active'
              AND id <> ALL($2::uuid[])
            ORDER BY random()
            LIMIT 1`,
          [deck, exclude],
        )
      ).rows[0];

    // Prefer a frame not recently served. But when the recent-LRU covers the
    // whole deck (deck size <= LIBRARY_LRU), the exclusion empties the result
    // and we'd otherwise return null → the session reports "deck empty" and
    // freezes on the last frame. Fall back to the full deck so demo mode loops
    // forever regardless of deck size (a small deck just repeats sooner).
    let row = await pick(excludeUuids);
    if (!row && excludeUuids.length > 0) {
      row = await pick([]);
    }
    if (!row) {
      logger.debug({ deck }, "library-provider: no rows for deck");
      return null;
    }
    return {
      id: typeIdFromUuid("imageLibrary", row.id),
      url: row.url,
      width: row.width,
      height: row.height,
    };
  } finally {
    client.release();
  }
}
