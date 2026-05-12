import type { NowPlaying } from "@music-visualizer/shared";
import type { Logger } from "../lib/logger";
import { recognizeWithAudd, type AuddMatch } from "./audd-provider";

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
    if (!hit) return null;
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
    this.map.set(key, { track, at: Date.now() });
    while (this.map.size > CACHE_MAX) {
      const first = this.map.keys().next().value;
      if (!first) break;
      this.map.delete(first);
    }
  }
}

const trackCache = new TrackCache();

function identityKey(match: AuddMatch): string {
  return `${match.artist.toLowerCase()}|${match.title.toLowerCase()}`;
}

// Apple Music artwork URLs are templated with `{w}x{h}bb` (plus `.jpg`) so
// consumers can request an arbitrary size. We pick a comfortable default
// that still renders well as a reference image for FLUX.2-edit.
function expandAppleArtwork(url: string | undefined): string | undefined {
  if (!url) return undefined;
  return url.replace(/\{w\}/g, "600").replace(/\{h\}/g, "600");
}

function extractYear(s?: string): number | undefined {
  if (!s) return undefined;
  const m = s.match(/^(\d{4})/);
  if (!m) return undefined;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : undefined;
}

export interface RecognizeOutcome {
  track: NowPlaying | null;
  source: "audd" | "cache";
}

export async function recognizeClip(
  clipBase64: string,
  mimeType: string,
  logger: Logger,
): Promise<RecognizeOutcome> {
  let buf: Buffer;
  try {
    buf = Buffer.from(clipBase64, "base64");
  } catch (err) {
    logger.warn({ err }, "recognize: base64 decode failed");
    return { track: null, source: "audd" };
  }
  if (buf.byteLength < 4_000) {
    logger.debug({ size: buf.byteLength }, "recognize: clip too small, skipping");
    return { track: null, source: "audd" };
  }

  const match = await recognizeWithAudd(buf, mimeType, logger);
  if (!match) return { track: null, source: "audd" };

  const key = identityKey(match);
  const cached = trackCache.get(key);
  if (cached) {
    logger.debug({ key }, "recognize: cache hit");
    return { track: cached, source: "cache" };
  }

  const apple = match.apple_music;
  const genre = apple?.genreNames?.[0];
  const albumArtUrl = expandAppleArtwork(apple?.artwork?.url);

  const track: NowPlaying = {
    title: match.title,
    artist: match.artist,
    album: match.album || apple?.albumName,
    genre,
    releaseYear:
      extractYear(match.release_date) || extractYear(apple?.releaseDate),
    albumArtUrl,
    isrc: apple?.isrc,
    durationMs: apple?.durationInMillis,
    recognizedAt: Date.now(),
  };

  trackCache.set(key, track);
  return { track, source: "audd" };
}
