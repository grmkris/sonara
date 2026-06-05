import type { Database } from "@sonara/db";
import { SCHEMA } from "@sonara/db";
import { DECK_KEYS, SERVICE_URLS } from "@sonara/shared";
import type { LibraryFrame, SessionSummary } from "@sonara/shared";
import type { LiveSessionId } from "@sonara/shared/typeid";
import { and, asc, eq } from "drizzle-orm";

import { env } from "../env";

// Example sessions for /studio. When a signed-in user has no generated/story
// frames yet, the library router falls back to these so the editor lands
// populated instead of empty. They're synthesized from the built-in seed
// decks (the same curated images the demo loop plays) and surfaced through the
// normal sessions/bySession shapes, so the timeline + inspector render them
// unchanged and every inspector action (use-as-anchor / reseed / download /
// copy-prompt) works on them — i.e. the user can treat them as their own.
//
// Synthetic, not materialized: nothing is written to the DB, so once the user
// generates real frames their own sessions take over and these step aside.
//
// The synthetic sessionId is `lse_example_<deck>` — it passes
// LiveSessionIdSchema (prefix + length only), is stable per deck (so
// `?session=` deep links resolve), and is recognised by the router via
// isExampleSessionId() before any DB / typeid decoding happens.

const EXAMPLE_PREFIX = "lse_example_";
// Spacing between consecutive frames on the synthetic timeline.
const FRAME_SPACING_MS = 12_000;
// Cap per deck so a large deck doesn't produce an unwieldy timeline.
const MAX_FRAMES_PER_DECK = 14;
// Each deck's session is anchored this far apart so the sidebar lists them in
// DECKS order (newest first) even if re-sorted by date.
const SESSION_STAGGER_MS = 3_600_000;

export const exampleSessionId = (deck: string): LiveSessionId =>
  `${EXAMPLE_PREFIX}${deck}` as LiveSessionId;

export const isExampleSessionId = (id: string): boolean =>
  id.startsWith(EXAMPLE_PREFIX);

export const deckFromExampleSessionId = (id: string): string =>
  id.slice(EXAMPLE_PREFIX.length);

interface SeedRow {
  id: LibraryFrame["id"];
  url: string;
  width: number;
  height: number;
  palette: string[] | null;
  deck: string;
  prompt: string;
}

// Seed images store a relative public path (e.g. "/library/neon/x.webp")
// served by the web app. Promote it to an absolute URL on the public origin
// so it works as a browser <img src>, a download, AND a server-side anchor
// fetch (which needs an absolute URL, exactly like a real generated frame's
// presigned URL).
const toAbsoluteUrl = (url: string): string => {
  if (url.includes("://")) {
    return url;
  }
  const base = SERVICE_URLS[env.APP_ENV].web.replace(/\/+$/u, "");
  return `${base}${url.startsWith("/") ? "" : "/"}${url}`;
};

// oxlint-disable-next-line require-await -- returns a drizzle thenable query builder; keep async so the declared Promise<SeedRow[]> return type holds
const fetchSeedRows = async (
  db: Database,
  deck?: string
): Promise<SeedRow[]> => {
  const conditions = [
    eq(SCHEMA.imageLibrary.source, "seed"),
    eq(SCHEMA.imageLibrary.status, "active"),
  ];
  if (deck) {
    conditions.push(eq(SCHEMA.imageLibrary.deck, deck));
  }

  return (
    db
      .select({
        deck: SCHEMA.imageLibrary.deck,
        height: SCHEMA.imageLibrary.height,
        id: SCHEMA.imageLibrary.id,
        palette: SCHEMA.imageLibrary.palette,
        prompt: SCHEMA.imageLibrary.prompt,
        url: SCHEMA.imageLibrary.url,
        width: SCHEMA.imageLibrary.width,
      })
      .from(SCHEMA.imageLibrary)
      .where(and(...conditions))
      // Stable ordering so the synthetic timeline is deterministic per deck.
      .orderBy(asc(SCHEMA.imageLibrary.deck), asc(SCHEMA.imageLibrary.id))
  );
};

// Maps one deck's seed rows to a synthetic, chronologically-ordered frame set.
const rowsToFrames = (
  deck: string,
  rows: SeedRow[],
  now: number
): LibraryFrame[] => {
  const deckIndex = Math.max(0, DECK_KEYS.indexOf(deck as never));
  const capped = rows.slice(0, MAX_FRAMES_PER_DECK);
  const sessionEnd = now - deckIndex * SESSION_STAGGER_MS;
  const sessionStart = sessionEnd - (capped.length - 1) * FRAME_SPACING_MS;

  return capped.map((row, i) => ({
    anchorUrl: null,
    createdAt: new Date(sessionStart + i * FRAME_SPACING_MS),
    deck: row.deck,
    height: row.height,
    id: row.id,
    inspectorContext: null,
    palette: row.palette,
    prompt: row.prompt,
    sessionId: exampleSessionId(deck),
    tMs: i * FRAME_SPACING_MS,
    triggerReason: null,
    url: toAbsoluteUrl(row.url),
    width: row.width,
  }));
};

// One example session per non-empty seed deck, in DECKS order. Used as the
// sessions() fallback when the user has no real sessions.
export const buildExampleSessions = async (
  db: Database
): Promise<SessionSummary[]> => {
  const rows = await fetchSeedRows(db);
  if (rows.length === 0) {
    return [];
  }

  const byDeck = new Map<string, SeedRow[]>();
  for (const row of rows) {
    const bucket = byDeck.get(row.deck);
    if (bucket) {
      bucket.push(row);
    } else {
      byDeck.set(row.deck, [row]);
    }
  }

  const now = Date.now();
  const summaries: SessionSummary[] = [];
  // Iterate in DECKS order so the sidebar reads in a curated sequence.
  for (const deck of DECK_KEYS) {
    const deckRows = byDeck.get(deck);
    if (!deckRows || deckRows.length === 0) {
      continue;
    }
    const frames = rowsToFrames(deck, deckRows, now);
    const [first] = frames;
    const last = frames.at(-1);
    if (!first || !last) {
      continue;
    }
    summaries.push({
      durationMs: (frames.length - 1) * FRAME_SPACING_MS,
      firstFrameAt: first.createdAt,
      frameCount: frames.length,
      lastFrameAt: last.createdAt,
      sampleUrl: last.url,
      sessionId: exampleSessionId(deck),
    });
  }
  return summaries;
};

// Frames for a single example session. Used as the bySession() short-circuit
// when the requested sessionId is an example id.
export const buildExampleFrames = async (
  db: Database,
  deck: string
): Promise<LibraryFrame[]> => {
  const rows = await fetchSeedRows(db, deck);
  if (rows.length === 0) {
    return [];
  }
  return rowsToFrames(deck, rows, Date.now());
};
