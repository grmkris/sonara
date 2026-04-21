import { z } from "zod";
import type { SpotifyAudioFeatures } from "@music-visualizer/shared";
import { env } from "../env";
import type { Logger } from "../lib/logger";

// Spotify Web API client-credentials flow. Gives us the audio-features
// object (energy, valence, danceability, tempo, acousticness, instrumentalness,
// key, mode) keyed by Spotify track id. Optional — if creds are missing we
// simply return null and the recognition pipeline degrades gracefully.

const TOKEN_URL = "https://accounts.spotify.com/api/token";
const FEATURES_URL = "https://api.spotify.com/v1/audio-features";

const TokenResponse = z.object({
  access_token: z.string(),
  expires_in: z.number(),
});

const FeaturesResponse = z.object({
  energy: z.number(),
  valence: z.number(),
  danceability: z.number(),
  acousticness: z.number(),
  instrumentalness: z.number(),
  tempo: z.number(),
  mode: z.number(),
  key: z.number(),
});

let cachedToken: { token: string; expiresAt: number } | null = null;

export function isSpotifyConfigured(): boolean {
  return Boolean(env.SPOTIFY_CLIENT_ID && env.SPOTIFY_CLIENT_SECRET);
}

async function getToken(logger: Logger): Promise<string | null> {
  const id = env.SPOTIFY_CLIENT_ID;
  const secret = env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) return null;

  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.token;
  }

  const basic = Buffer.from(`${id}:${secret}`).toString("base64");
  let res: Response;
  try {
    res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
  } catch (err) {
    logger.warn({ err }, "spotify: token fetch failed");
    return null;
  }
  if (!res.ok) {
    logger.warn({ status: res.status }, "spotify: token non-OK");
    return null;
  }
  const parsed = TokenResponse.safeParse(await res.json().catch(() => null));
  if (!parsed.success) {
    logger.warn("spotify: token schema mismatch");
    return null;
  }
  cachedToken = {
    token: parsed.data.access_token,
    expiresAt: Date.now() + parsed.data.expires_in * 1000,
  };
  return cachedToken.token;
}

export async function fetchSpotifyFeatures(
  spotifyTrackId: string,
  logger: Logger,
  signal?: AbortSignal,
): Promise<SpotifyAudioFeatures | null> {
  const token = await getToken(logger);
  if (!token) return null;
  let res: Response;
  try {
    res = await fetch(`${FEATURES_URL}/${encodeURIComponent(spotifyTrackId)}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal,
    });
  } catch (err) {
    logger.warn({ err }, "spotify: features fetch failed");
    return null;
  }
  if (!res.ok) {
    if (res.status === 401) cachedToken = null;
    logger.warn({ status: res.status }, "spotify: features non-OK");
    return null;
  }
  const parsed = FeaturesResponse.safeParse(await res.json().catch(() => null));
  if (!parsed.success) {
    logger.warn("spotify: features schema mismatch");
    return null;
  }
  const f = parsed.data;
  return {
    energy: clamp01(f.energy),
    valence: clamp01(f.valence),
    danceability: clamp01(f.danceability),
    acousticness: clamp01(f.acousticness),
    instrumentalness: clamp01(f.instrumentalness),
    tempo: Math.max(1, f.tempo),
    mode: f.mode,
    key: f.key,
  };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}
