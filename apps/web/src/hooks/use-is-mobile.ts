"use client";

import { useEffect, useState } from "react";

// Tailwind's md breakpoint, as a hook. SSR-safe: first paint assumes
// desktop (false) and corrects after mount — callers gate MOBILE-ONLY
// chrome with it, so the worst case is a missing sheet for one frame.
const QUERY = "(max-width: 767px)";

export const useIsMobile = (): boolean => {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(QUERY);
    setIsMobile(mql.matches);
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isMobile;
};
