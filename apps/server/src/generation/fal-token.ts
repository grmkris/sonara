import { env } from "../env";

// Cached fal realtime auth-token provider.
//
// fal's DEFAULT token provider re-fetches a temp token whenever the connection
// re-authenticates, and (verified in the SDK source) it does NOT refresh in the
// background — so on a long-lived server connection it re-auths mid-session,
// adding ~1s per frame and logging the `token provider deprecated` warning each
// time. We instead cache the token per fal app (owner/alias) for most of its
// 120s lifetime and reuse it across ALL sessions/pools, so the warm websocket
// actually stays warm. Passed to `fal.realtime.connect({ tokenProvider })`.

const TOKEN_EXPIRATION_SECONDS = 120;
// Refetch a little before the server-side 120s expiry to avoid a stale token.
const TOKEN_TTL_MS = 100_000;
const FAL_TOKEN_URL = "https://rest.fal.ai/tokens/";

interface CachedToken {
  token: string;
  fetchedAt: number;
}

const cache = new Map<string, CachedToken>();
const inflight = new Map<string, Promise<string>>();

// The SDK passes the full app path (e.g. "fal-ai/fast-lightning-sdxl/realtime");
// the token's `allowed_apps` wants the owner/alias ("fal-ai/fast-lightning-sdxl").
const toAlias = (app: string): string => {
  const parts = app.split("/").filter((p) => p.length > 0);
  if (parts.length >= 2) {
    return `${parts[0]}/${parts[1]}`;
  }
  return app;
};

const fetchToken = async (alias: string): Promise<string> => {
  const res = await fetch(FAL_TOKEN_URL, {
    body: JSON.stringify({
      allowed_apps: [alias],
      token_expiration: TOKEN_EXPIRATION_SECONDS,
    }),
    headers: {
      Accept: "application/json",
      Authorization: `Key ${env.FAL_KEY}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  if (!res.ok) {
    throw new Error(`fal token fetch failed: ${res.status}`);
  }
  const data: unknown = await res.json();
  if (typeof data === "string") {
    return data;
  }
  // Older proxy versions wrap the token as { detail: "<token>" }.
  if (data !== null && typeof data === "object" && "detail" in data) {
    const { detail } = data as { detail: unknown };
    if (typeof detail === "string") {
      return detail;
    }
  }
  throw new Error("fal token: unexpected response shape");
};

export const cachedTokenProvider = (app: string): Promise<string> => {
  const alias = toAlias(app);
  const hit = cache.get(alias);
  if (hit && Date.now() - hit.fetchedAt < TOKEN_TTL_MS) {
    return Promise.resolve(hit.token);
  }
  const existing = inflight.get(alias);
  if (existing) {
    return existing;
  }
  // Stash the in-flight promise BEFORE awaiting so concurrent connects share a
  // single token fetch. The async IIFE keeps this an await chain (no .then).
  const pending = (async (): Promise<string> => {
    try {
      const token = await fetchToken(alias);
      cache.set(alias, { fetchedAt: Date.now(), token });
      return token;
    } finally {
      inflight.delete(alias);
    }
  })();
  inflight.set(alias, pending);
  return pending;
};

export const TOKEN_EXPIRATION_SECONDS_CONST = TOKEN_EXPIRATION_SECONDS;
