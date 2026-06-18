import type { NowPlaying } from "@sonara/shared";

import type { Logger } from "../lib/logger";
import { recognizeWithAudd } from "./audd-provider";
import type { AuddMatch } from "./audd-provider";

// AudD is the only provider. The `return=apple_music` flag bundles genre,
// album art, ISRC, and release date into the single request, so there is no
// second HTTP call and no second API key. Per-song mood/tempo is derived
// from the live audio analysis pipeline (valence, arousal, BPM), not from
// any catalog API.
//
// Future enrichment (not wired): AudD also bundles `deezer` and `musicbrainz`
// sub-objects behind additional `return=` flags (still "just AudD"). Last.fm
// getInfo, TheAudioDB, and Discogs are external options if richer track
// taxonomy ever becomes useful.

const CACHE_TTL_MS = 10 * 60_000;
const CACHE_MAX = 64;

interface CacheEntry {
  track: NowPlaying;
  at: number;
}

class TrackCache {
  private map = new Map<string, CacheEntry>();
  get(key: string): NowPlaying | null {
    const hit = this.map.get(key);
    if (!hit) {
      return null;
    }
    if (Date.now() - hit.at > CACHE_TTL_MS) {
      this.map.delete(key);
      return null;
    }
    // Touch for LRU.
    this.map.delete(key);
    this.map.set(key, hit);
    return hit.track;
  }
  set(key: string, track: NowPlaying): void {
    this.map.set(key, { at: Date.now(), track });
    while (this.map.size > CACHE_MAX) {
      const first = this.map.keys().next().value;
      if (!first) {
        break;
      }
      this.map.delete(first);
    }
  }
}

const trackCache = new TrackCache();

const identityKey = (match: AuddMatch): string =>
  `${match.artist.toLowerCase()}|${match.title.toLowerCase()}`;

// Apple Music artwork URLs are templated with `{w}x{h}bb` (plus `.jpg`) so
// consumers can request an arbitrary size. We pick a comfortable default
// that still renders well as a reference image for FLUX.2-edit.
const expandAppleArtwork = (url: string | undefined): string | undefined => {
  if (!url) {
    return undefined;
  }
  return url.replaceAll("{w}", "600").replaceAll("{h}", "600");
};

const extractYear = (s?: string): number | undefined => {
  if (!s) {
    return undefined;
  }
  const m = s.match(/^(?<year>\d{4})/u);
  if (!m) {
    return undefined;
  }
  const n = Number(m.groups?.year);
  return Number.isFinite(n) ? n : undefined;
};

export interface RecognizeOutcome {
  track: NowPlaying | null;
  source: "audd" | "cache";
}

export const recognizeClip = async (
  clipBase64: string,
  mimeType: string,
  logger: Logger
): Promise<RecognizeOutcome> => {
  let buf: Buffer;
  try {
    buf = Buffer.from(clipBase64, "base64");
  } catch (error) {
    logger.warn({ error }, "recognize: base64 decode failed");
    return { source: "audd", track: null };
  }
  if (buf.byteLength < 4000) {
    logger.debug(
      { size: buf.byteLength },
      "recognize: clip too small, skipping"
    );
    return { source: "audd", track: null };
  }

  const match = await recognizeWithAudd(buf, mimeType, logger);
  if (!match) {
    return { source: "audd", track: null };
  }

  const key = identityKey(match);
  const cached = trackCache.get(key);
  if (cached) {
    logger.debug({ key }, "recognize: cache hit");
    return { source: "cache", track: cached };
  }

  const apple = match.apple_music;
  const genre = apple?.genreNames?.[0];
  const albumArtUrl = expandAppleArtwork(apple?.artwork?.url);

  const track: NowPlaying = {
    album: match.album || apple?.albumName,
    albumArtUrl,
    artist: match.artist,
    durationMs: apple?.durationInMillis,
    genre,
    isrc: apple?.isrc,
    recognizedAt: Date.now(),
    releaseYear:
      extractYear(match.release_date) || extractYear(apple?.releaseDate),
    title: match.title,
  };

  trackCache.set(key, track);
  return { source: "audd", track };
};
