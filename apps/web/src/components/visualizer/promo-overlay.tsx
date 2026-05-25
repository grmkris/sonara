"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { useVisualizerStore } from "@/stores/visualizer";
import { cn } from "@/lib/utils";

// Promotion overlay for the live showcase. Independent of the chrome's hide
// toggle so the brand stays on screen during a clean fullscreen show (when the
// top-left wordmark is hidden) — that's when promotion matters most:
//   - a subtle persistent "sonara.fm" corner mark while the chrome is hidden, and
//   - a credit card that fades in over the visuals every few minutes. On the
//     event (cyborg) deck it's CO-BRANDED: "music by sonicite" (their gradient
//     logo) over "visuals by sonara.fm" (whose underline pulses to the music).
const CARD_PERIOD_MS = 210_000; // recurring card every ~3.5 min
const CARD_VISIBLE_MS = 8_000; // hold ~8s
const FIRST_DELAY_MS = 22_000; // first card ~22s after load
const EASE = "cubic-bezier(0.16, 1, 0.3, 1)";

export function PromoOverlay() {
  const uiVisible = useVisualizerStore((s) => s.uiVisible);
  const demoDeck = useVisualizerStore((s) => s.demoDeck);
  const [cardOn, setCardOn] = useState(false);
  // Live RMS → CSS var on the sonara wordmark so its underline breathes to the
  // music (same treatment as the chrome Logotype). Driven via a ref so it
  // updates at frame rate without re-rendering.
  const ampRef = useRef<HTMLSpanElement | null>(null);

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

  useEffect(() => {
    const unsub = useVisualizerStore.subscribe((s, prev) => {
      if (s.audio.rms === prev.audio.rms) return;
      const el = ampRef.current;
      if (!el) return;
      const amp = Math.max(0, Math.min(1, s.audio.rms));
      el.style.setProperty("--amp", amp.toFixed(3));
    });
    return () => unsub();
  }, []);

  const coBrand = demoDeck === "cyborg";

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

      {/* Credit card. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-[13%] z-30 flex justify-center px-4"
      >
        <div
          className={cn(
            "w-[min(20rem,84vw)] rounded-lg border border-[color:var(--paper)]/12 bg-[color:var(--ink)]/55 px-7 py-6 text-center shadow-[0_18px_60px_-20px_rgba(0,0,0,0.7)] backdrop-blur-md",
            "transition-[opacity,transform,filter] duration-[1100ms]",
          )}
          style={{
            transitionTimingFunction: EASE,
            opacity: cardOn ? 1 : 0,
            transform: cardOn ? "translateY(0)" : "translateY(14px)",
            filter: cardOn ? "blur(0)" : "blur(3px)",
          }}
        >
          {coBrand ? (
            <>
              <Eyebrow>music by</Eyebrow>
              <img
                src="/brand/sonicite.webp"
                alt="sonicite"
                width={600}
                height={165}
                className="mx-auto mt-2.5 w-[12.5rem] max-w-full rounded-md ring-1 ring-[color:var(--paper)]/10"
              />
              <Divider />
              <Eyebrow>visuals by</Eyebrow>
              <span
                ref={ampRef}
                className="wordmark mt-1.5 inline-block font-serif text-[1.7rem] italic leading-none tracking-tight text-[color:var(--paper)]"
              >
                sonara.fm
              </span>
            </>
          ) : (
            <>
              <span className="font-serif text-3xl italic tracking-tight text-[color:var(--paper)]">
                sonara.fm
              </span>
              <div className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.28em] text-[color:var(--paper)]/70">
                live music visuals
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <div className="font-mono text-[9px] uppercase tracking-[0.3em] text-[color:var(--stone)]">
      {children}
    </div>
  );
}

function Divider() {
  return (
    <div
      aria-hidden
      className="mx-auto my-4 h-px w-12 bg-[color:var(--paper)]/15"
    />
  );
}
