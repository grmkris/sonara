"use client";

import { useEffect, useState } from "react";
import { useVisualizerStore } from "@/stores/visualizer";
import { cn } from "@/lib/utils";

// Promotion overlay for the live showcase. Independent of the chrome's hide
// toggle so the brand stays visible during a clean fullscreen show (when the
// top-left wordmark is hidden) — that's when promotion matters most:
//   - a subtle persistent "sonara.fm" corner mark, shown while the chrome is
//     hidden (the chrome's own wordmark covers the brand when it's visible), and
//   - a "sonara.fm" promo card that fades in over the visuals every few minutes.
const CARD_PERIOD_MS = 4 * 60_000; // recurring card every ~4 min
const CARD_VISIBLE_MS = 7_000; // hold ~7s
const FIRST_DELAY_MS = 45_000; // first card ~45s after load

export function PromoOverlay() {
  const uiVisible = useVisualizerStore((s) => s.uiVisible);
  const [cardOn, setCardOn] = useState(false);

  useEffect(() => {
    let hideTimer: ReturnType<typeof setTimeout> | null = null;
    const show = () => {
      setCardOn(true);
      hideTimer = setTimeout(() => setCardOn(false), CARD_VISIBLE_MS);
    };
    const first = setTimeout(show, FIRST_DELAY_MS);
    const interval = setInterval(show, CARD_PERIOD_MS);
    return () => {
      clearTimeout(first);
      clearInterval(interval);
      if (hideTimer) clearTimeout(hideTimer);
    };
  }, []);

  return (
    <>
      {/* Persistent subtle corner mark — only while the chrome (and its own
          wordmark) is hidden, so the brand never disappears during a show. */}
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute bottom-4 right-4 z-30 select-none font-serif text-[11px] italic tracking-tight text-[color:var(--paper)]/40 transition-opacity duration-700 md:bottom-6 md:right-8 md:text-[13px]",
          uiVisible ? "opacity-0" : "opacity-100",
        )}
      >
        sonara.fm
      </div>

      {/* Periodic promo card, fades in over the visuals. */}
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-x-0 bottom-[14%] z-30 flex justify-center transition-opacity duration-1000",
          cardOn ? "opacity-100" : "opacity-0",
        )}
      >
        <div className="rounded-md border border-[color:var(--paper)]/15 bg-[color:var(--ink)]/40 px-6 py-3 text-center backdrop-blur-sm">
          <div className="font-serif text-2xl italic tracking-tight text-[color:var(--paper)] md:text-3xl">
            sonara.fm
          </div>
          <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.28em] text-[color:var(--paper)]/70">
            live music visuals
          </div>
        </div>
      </div>
    </>
  );
}
