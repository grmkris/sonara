"use client";

import { Suspense, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { SonaraCanvas } from "@/components/visualizer/canvas/sonara-canvas";
import { useWsSession } from "@/hooks/use-ws-session";
import { useDemoFrameLoop } from "@/hooks/use-demo-frame-loop";
import { useVisualizerStore } from "@/stores/visualizer";

// Landing page. Same SonaraCanvas the visualiser uses, mounted as a
// fixed backplate so it stays visible while marketing copy scrolls over
// it. Demo is client-native: useDemoFrameLoop() cycles a deck's static
// frames into the canvas (with the displacement-shader transitions) — no
// server/WS frames and no audio. The backplate cycles silently on its own
// cadence; audio-reactivity is a /play concern once the visitor brings sound.
// The effect below self-starts demo so signed-in/offline visitors (who get no
// anon WS pin) still see the backplate instead of black.

export default function LandingPage() {
  useWsSession();
  useDemoFrameLoop();

  // Self-start demo on the landing regardless of auth/connectivity. The anon
  // WS snapshot sets these for most visitors, but signed-in or offline
  // visitors get no anon pin — without this the backplate would be black.
  // Only fills gaps (won't override a deck the snapshot already chose).
  useEffect(() => {
    const st = useVisualizerStore.getState();
    if (!st.demoMode) st.setDemoMode(true);
    if (!st.demoDeck) st.setDemoDeck("liquid");
  }, []);

  return (
    <main className="relative min-h-svh overflow-x-hidden bg-[color:var(--ink)] text-[color:var(--paper)]">
      {/* Old `/?record=…` share-link redirect. Lives inside a Suspense
         boundary because useSearchParams() triggers CSR-bailout otherwise
         and the whole page falls off the prerender path. */}
      <Suspense fallback={null}>
        <OldShareLinkRedirect />
      </Suspense>
      {/* Canvas backplate. Fixed so it stays visible as the visitor
         scrolls; everything below sits in a z-10 column on top. */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <SonaraCanvas />
      </div>
      <div aria-hidden className="grain-overlay" />

      <div className="relative z-10 flex min-h-svh flex-col">
        {/* Fold */}
        <section className="relative flex flex-1 items-end px-6 pb-10 pt-16 md:items-center md:px-12 md:pt-24">
          {/* Paper scrim feathers the canvas so the headline reads
             cleanly against any frame. */}
          <div
            aria-hidden
            className="paper-scrim pointer-events-none absolute inset-x-0 bottom-0 top-1/4 -z-10"
          />
          <div className="flex max-w-[680px] flex-col gap-6">
            <h1
              className="reveal wordmark font-serif italic leading-[0.95] text-[color:var(--paper)]"
              style={{
                fontSize: "clamp(56px, 9vw, 128px)",
                fontWeight: 500,
              }}
            >
              music,
              <br />
              made visible.
            </h1>
            <p
              className="reveal reveal-1 font-sans max-w-[38ch] text-[15px] leading-relaxed text-[color:var(--paper)]/85 md:text-[16px]"
            >
              it listens to whatever you're playing and paints what it hears, as
              it happens.
            </p>
            <div className="reveal reveal-2 flex flex-wrap items-center gap-5 pt-2">
              <Link
                href="/play"
                className="focus-ring font-sans border border-[color:var(--paper)]/70 px-5 py-2.5 text-[11px] uppercase tracking-[0.24em] text-[color:var(--paper)] transition-colors hover:bg-[color:var(--paper)] hover:text-[color:var(--ink)]"
              >
                open the visualiser
              </Link>
              <Link
                href="/login"
                className="focus-ring font-sans text-[11px] uppercase tracking-[0.24em] text-[color:var(--stone)] underline-offset-4 transition-colors hover:text-[color:var(--paper)] hover:underline"
              >
                sign in
              </Link>
            </div>
          </div>
        </section>

        {/* Capability band */}
        <section className="relative border-t border-[color:var(--hairline)]/25 bg-[color:var(--ink)]/85 px-6 py-12 backdrop-blur-sm md:px-12 md:py-16">
          <div className="grid gap-10 md:grid-cols-3 md:gap-8">
            <Capability
              eyebrow="01 listen"
              hook="any sound"
              body="share a tab, open the mic, or drop in a track. it knows the song, too."
            />
            <Capability
              eyebrow="02 speak"
              hook="in your words"
              body="say it or type it; the scene composes itself."
            />
            <Capability
              eyebrow="03 show"
              hook="an image"
              body="hand it a picture and it carries that look through."
            />
          </div>
        </section>

        {/* Footer */}
        <footer className="relative border-t border-[color:var(--hairline)]/25 bg-[color:var(--ink)]/85 px-6 py-6 backdrop-blur-sm md:px-12">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <span className="font-serif text-[22px] italic text-[color:var(--paper)]/85">
              sonara.fm
            </span>
            <nav className="font-mono flex items-center gap-5 text-[10px] uppercase tracking-[0.24em] text-[color:var(--stone)]">
              <Link
                href="/play"
                className="transition-colors hover:text-[color:var(--paper)]"
              >
                play
              </Link>
              <Link
                href="/login"
                className="transition-colors hover:text-[color:var(--paper)]"
              >
                sign in
              </Link>
            </nav>
          </div>
        </footer>
      </div>
    </main>
  );
}

function OldShareLinkRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();
  useEffect(() => {
    if (searchParams.get("record") !== null) {
      const qs = searchParams.toString();
      router.replace(`/play${qs ? `?${qs}` : ""}`);
    }
  }, [router, searchParams]);
  return null;
}

function Capability({
  eyebrow,
  hook,
  body,
}: {
  eyebrow: string;
  hook: string;
  body: string;
}) {
  return (
    <div className="flex flex-col gap-3 md:border-r md:border-[color:var(--hairline)]/25 md:pr-8 md:last:border-r-0">
      <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-[color:var(--stone)]">
        {eyebrow}
      </span>
      <span className="font-serif text-[28px] italic leading-tight text-[color:var(--paper)] md:text-[32px]">
        {hook}
      </span>
      <p className="font-sans text-[14px] leading-relaxed text-[color:var(--paper)]/80">
        {body}
      </p>
    </div>
  );
}
