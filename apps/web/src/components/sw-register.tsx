"use client";

import { useEffect } from "react";

// The default deck we want cached for offline playback.
const PREFETCH_DECK = "liquid";

interface NetworkInformation {
  saveData?: boolean;
  effectiveType?: string;
}

// Registers the offline service worker (production only) and, once it's
// controlling the page, background-prefetches the full showcase deck while on a
// decent connection — so "open it once on wifi, then it works in the basement".
export function SwRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      return;
    }
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }
    navigator.serviceWorker
      .register("/sw.js")
      .then(() => navigator.serviceWorker.ready)
      .then(() => {
        if (!navigator.onLine) {
          return;
        }
        const conn = (
          navigator as Navigator & {
            connection?: NetworkInformation;
          }
        ).connection;
        // Skip the ~30 MB prefetch on metered / very slow links; runtime
        // caching still captures whatever frames actually play.
        if (conn?.saveData) {
          return;
        }
        if (conn?.effectiveType && /(^|-)(2g|slow)/.test(conn.effectiveType)) {
          return;
        }
        // Give the live demo a head start, then prefetch the rest.
        setTimeout(prefetchDeck, 8000);
      })
      .catch(() => {
        /* registration failures are non-fatal */
      });
  }, []);

  return null;
}

async function prefetchDeck(): Promise<void> {
  try {
    const res = await fetch(`/library/${PREFETCH_DECK}/manifest.json`);
    if (!res.ok) {
      return;
    }
    const data = (await res.json()) as { frames?: string[] };
    const urls = Array.isArray(data.frames) ? data.frames : [];
    const ctrl = navigator.serviceWorker.controller;
    if (urls.length > 0 && ctrl) {
      ctrl.postMessage({ type: "PREFETCH_DECK", urls });
    }
  } catch {
    /* ignore */
  }
}
