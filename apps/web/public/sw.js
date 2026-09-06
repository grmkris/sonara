/* Sonara offline service worker (hand-rolled — no build-tool coupling, works
 * regardless of the Next bundler). Runtime-caches the app shell, build assets,
 * and demo library images so the visualiser loads and the demo loops on
 * slow/no internet after a first online visit. Demo frame-driving is already
 * client-native (use-demo-frame-loop), so once assets are cached the whole
 * show runs with the network down. */
const VERSION = "v4";
const NAV_CACHE = `sonara-nav-${VERSION}`;
const ASSET_CACHE = `sonara-assets-${VERSION}`;
// Library images are content-addressed + immutable — keep across deploys so a
// web deploy never wipes the (large) cached deck.
const LIB_CACHE = "sonara-library";
const KEEP = new Set([NAV_CACHE, ASSET_CACHE, LIB_CACHE]);

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith("sonara-") && !KEEP.has(k))
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

// oxlint-disable-next-line func-style, no-implicit-globals -- classic service-worker script: hoisted global helper used by event handlers below
async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) {
    return hit;
  }
  const res = await fetch(req);
  if (res.ok) {
    void cache.put(req, res.clone());
  }
  return res;
}

// oxlint-disable-next-line func-style, no-implicit-globals -- classic service-worker script: hoisted global helper used by event handlers below
async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  const revalidate = async () => {
    try {
      const res = await fetch(req);
      if (res.ok) {
        void cache.put(req, res.clone());
      }
      return res;
    } catch {
      return hit;
    }
  };
  // Kick off revalidation but don't await it when we have a cached hit — the
  // stale response is returned immediately while the fetch updates the cache.
  const fetching = revalidate();
  return hit || fetching;
}

// oxlint-disable-next-line func-style, no-implicit-globals -- classic service-worker script: hoisted global helper used by event handlers below
async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res.ok) {
      void cache.put(req, res.clone());
    }
    return res;
  } catch (error) {
    const hit = await cache.match(req);
    if (hit) {
      return hit;
    }
    const fallback = await cache.match("/play");
    if (fallback) {
      return fallback;
    }
    throw error;
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") {
    return;
  }
  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) {
    return;
  }
  const p = url.pathname;
  // Turbopack encodes each worker's module list in its URL fragment. Cache
  // matching ignores that fragment, but a cached Response.url can replace
  // self.location and start a different worker (or a previous build's code).
  // Let the browser handle worker entrypoints; their imported chunks remain
  // cacheable below. See FetchEvent.respondWith's final-URL semantics.
  if (req.destination === "worker" || p.includes("turbopack-worker-")) {
    return;
  }
  // Never intercept realtime / API — let them hit the network and fail
  // gracefully offline (the demo loop is client-native and doesn't need them).
  if (p.startsWith("/rpc") || p.startsWith("/api") || p.startsWith("/ws")) {
    return;
  }

  if (req.mode === "navigate") {
    event.respondWith(networkFirst(req, NAV_CACHE));
    return;
  }
  if (p.startsWith("/library/")) {
    event.respondWith(
      p.endsWith("manifest.json")
        ? staleWhileRevalidate(req, LIB_CACHE)
        : cacheFirst(req, LIB_CACHE)
    );
    return;
  }
  if (p.startsWith("/_next/") || p.startsWith("/audio/")) {
    event.respondWith(cacheFirst(req, ASSET_CACHE));
  }
});
