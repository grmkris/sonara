"use client";

import { useEffect } from "react";

// Cache what the listener actually uses. Startup no longer downloads an
// unrelated image deck; the procedural surface needs no library assets.
export const SwRegister = () => {
  useEffect(() => {
    if (
      process.env.NODE_ENV !== "production" ||
      !("serviceWorker" in navigator)
    ) {
      return;
    }
    const register = async () => {
      try {
        await navigator.serviceWorker.register("/sw.js", {
          updateViaCache: "none",
        });
      } catch {
        /* Offline caching is optional. */
      }
    };
    void register();
  }, []);
  return null;
};
