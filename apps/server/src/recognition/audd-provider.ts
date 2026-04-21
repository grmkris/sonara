import { z } from "zod";
import { env } from "../env";
import type { Logger } from "../lib/logger";

// Thin wrapper around the AudD recognize endpoint. Returns the raw result
// (plus the Spotify/Apple Music sub-objects if we asked for them) or null
// when AudD has no match or the API is unavailable. Networking errors are
// swallowed to null with a warn — recognition is a best-effort enhancement,
// not a hard dependency of a session.

const AUDD_URL = "https://api.audd.io/";

const AuddSpotifyImage = z.object({
  url: z.string().url(),
  width: z.number().optional(),
  height: z.number().optional(),
});

const AuddSpotifyAlbum = z
  .object({
    name: z.string().optional(),
    release_date: z.string().optional(),
    images: z.array(AuddSpotifyImage).optional(),
  })
  .partial();

const AuddSpotify = z
  .object({
    id: z.string().optional(),
    name: z.string().optional(),
    duration_ms: z.number().optional(),
    external_ids: z
      .object({ isrc: z.string().optional() })
      .partial()
      .optional(),
    album: AuddSpotifyAlbum.optional(),
    artists: z.array(z.object({ name: z.string() }).partial()).optional(),
  })
  .partial();

const AuddResult = z
  .object({
    artist: z.string(),
    title: z.string(),
    album: z.string().optional(),
    release_date: z.string().optional(),
    label: z.string().optional(),
    song_link: z.string().optional(),
    spotify: AuddSpotify.optional(),
  })
  .passthrough();

const AuddResponse = z.object({
  status: z.string(),
  result: AuddResult.nullable().optional(),
  error: z
    .object({ error_code: z.number(), error_message: z.string() })
    .partial()
    .optional(),
});

export type AuddMatch = z.infer<typeof AuddResult>;

export function isAuddConfigured(): boolean {
  return Boolean(env.AUDD_API_KEY);
}

export async function recognizeWithAudd(
  buf: Buffer,
  mimeType: string,
  logger: Logger,
  signal?: AbortSignal,
): Promise<AuddMatch | null> {
  const apiToken = env.AUDD_API_KEY;
  if (!apiToken) return null;

  const form = new FormData();
  form.append("api_token", apiToken);
  form.append("return", "spotify,apple_music");
  const uint = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  form.append(
    "file",
    new Blob([uint], { type: mimeType }),
    mimeType.includes("webm") ? "clip.webm" : "clip.audio",
  );

  let res: Response;
  try {
    res = await fetch(AUDD_URL, { method: "POST", body: form, signal });
  } catch (err) {
    logger.warn({ err }, "audd: fetch failed");
    return null;
  }
  if (!res.ok) {
    logger.warn({ status: res.status }, "audd: non-OK response");
    return null;
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch (err) {
    logger.warn({ err }, "audd: JSON parse failed");
    return null;
  }
  const parsed = AuddResponse.safeParse(body);
  if (!parsed.success) {
    logger.warn({ issues: parsed.error.issues }, "audd: response schema mismatch");
    return null;
  }
  if (parsed.data.status !== "success") {
    logger.warn({ error: parsed.data.error }, "audd: non-success status");
    return null;
  }
  return parsed.data.result ?? null;
}
