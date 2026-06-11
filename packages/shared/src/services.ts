// Single source of truth for *which environment we're in* and the public URLs
// that vary per environment. `APP_ENV` (server) / `NEXT_PUBLIC_APP_ENV` (web)
// is the only env var that changes between local / dev.sonara.fm / sonara.fm —
// every per-environment URL is derived from SERVICE_URLS[appEnv], so a deploy
// configures one value instead of a scattered set of URL vars.
//
// Sonara's Caddy gateway makes the browser see a single origin, so this map is
// intentionally tiny (web / ws / apiInternal). Browser RPC uses
// window.location.origin directly; only SSR needs the internal address.
import { z } from "zod";

export const ENVIRONMENTS = ["local", "dev", "prod"] as const;
export const Environment = z.enum(ENVIRONMENTS);
export type Environment = z.infer<typeof Environment>;

export interface ServiceUrls {
  /** Public origin (the Caddy gateway) — browser + the server's self-reference. */
  web: string;
  /** Public WebSocket origin (same gateway, /ws path). */
  ws: string;
  /** Server-internal RPC base used during web SSR (no window → can't use the
   *  gateway origin). dev & prod are identical: Railway's internal DNS is
   *  scoped per environment. */
  apiInternal: string;
}

export const SERVICE_URLS: Record<Environment, ServiceUrls> = {
  dev: {
    apiInternal: "http://server.railway.internal:4471",
    web: "https://dev.sonara.fm",
    ws: "wss://dev.sonara.fm/ws",
  },
  local: {
    apiInternal: "http://localhost:4471",
    web: "http://localhost:4470",
    ws: "ws://localhost:4470/ws",
  },
  prod: {
    apiInternal: "http://server.railway.internal:4471",
    web: "https://sonara.fm",
    ws: "wss://sonara.fm/ws",
  },
} as const;

/** Dodo runs in live mode only on prod; local + dev use test mode. */
export const dodoModeForEnv = (e: Environment): "live_mode" | "test_mode" =>
  e === "prod" ? "live_mode" : "test_mode";
