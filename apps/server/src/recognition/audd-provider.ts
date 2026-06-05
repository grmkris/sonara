import { z } from "zod";

import { env } from "../env";
import type { Logger } from "../lib/logger";

// Thin wrapper around the AudD recognize endpoint. Returns the raw match
// (with the Apple Music sub-object when AudD can find one) or null when
// AudD has no match or the API is unavailable. Networking errors are
// swallowed to null with a warn.

const AUDD_URL = "https://api.audd.io/";

const AuddAppleMusicArtwork = z
  .object({
    bgColor: z.string().optional(),
    height: z.number().optional(),
    textColor1: z.string().optional(),
    textColor2: z.string().optional(),
    url: z.string(),
    width: z.number().optional(),
  })
  .partial();

const AuddAppleMusic = z
  .object({
    albumName: z.string().optional(),
    artwork: AuddAppleMusicArtwork.optional(),
    durationInMillis: z.number().optional(),
    genreNames: z.array(z.string()).optional(),
    isrc: z.string().optional(),
    releaseDate: z.string().optional(),
    url: z.string().optional(),
  })
  .partial();

const AuddResult = z
  .object({
    album: z.string().optional(),
    apple_music: AuddAppleMusic.optional(),
    artist: z.string(),
    label: z.string().optional(),
    release_date: z.string().optional(),
    song_link: z.string().optional(),
    title: z.string(),
  })
  .passthrough();

const AuddResponse = z.object({
  error: z
    .object({ error_code: z.number(), error_message: z.string() })
    .partial()
    .optional(),
  result: AuddResult.nullable().optional(),
  status: z.string(),
});

export type AuddMatch = z.infer<typeof AuddResult>;

export async function recognizeWithAudd(
  buf: Buffer,
  mimeType: string,
  logger: Logger,
  signal?: AbortSignal
): Promise<AuddMatch | null> {
  const form = new FormData();
  form.append("api_token", env.AUDD_API_KEY);
  form.append("return", "apple_music");
  const uint = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  form.append(
    "file",
    new Blob([uint], { type: mimeType }),
    mimeType.includes("webm") ? "clip.webm" : "clip.audio"
  );

  let res: Response;
  try {
    res = await fetch(AUDD_URL, { body: form, method: "POST", signal });
  } catch (error) {
    logger.warn({ error }, "audd: fetch failed");
    return null;
  }
  if (!res.ok) {
    logger.warn({ status: res.status }, "audd: non-OK response");
    return null;
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch (error) {
    logger.warn({ error }, "audd: JSON parse failed");
    return null;
  }
  const parsed = AuddResponse.safeParse(body);
  if (!parsed.success) {
    logger.warn(
      { issues: parsed.error.issues },
      "audd: response schema mismatch"
    );
    return null;
  }
  if (parsed.data.status !== "success") {
    logger.warn({ error: parsed.data.error }, "audd: non-success status");
    return null;
  }
  return parsed.data.result ?? null;
}
