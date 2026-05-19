"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { SonaraCanvas } from "@/components/visualizer/canvas/sonara-canvas";
import { useWsSession } from "@/hooks/use-ws-session";
import { useAudioFeatures, type AudioSource } from "@/hooks/use-audio-features";
import { useVisualizerStore } from "@/stores/visualizer";
import { getDemoTrack } from "@/lib/demo-audio";

// Landing page. Same SonaraCanvas the visualiser uses, mounted as a
// fixed backplate so it stays visible while marketing copy scrolls over
// it. Anon WS session pins the server to demo-library mode, and the
// state() snapshot hydrates demoMode + demoDeck on connect — that's
// what makes the audio + frames actually start without any toggle.

export default function LandingPage() {
  const send = useWsSession();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [audioSource, setAudioSource] = useState<AudioSource>({ type: "none" });

  // Demo-audio auto-play. Mirrors the effect in music-source.tsx but
  // headless: no file picker, no mic toggle, just a hidden <audio>. The
  // server pushed demoMode=true via the state() snapshot, the store
  // received it, and this effect fires.
  const demoMode = useVisualizerStore((s) => s.demoMode);
  const demoDeck = useVisualizerStore((s) => s.demoDeck);
  useEffect(() => {
    const el = audioRef.current;
    if (!el || !demoMode) return;
    const track = getDemoTrack(demoDeck);
    if (el.src.endsWith(track.url)) return;
    el.src = track.url;
    el.loop = true;
    el.crossOrigin = "anonymous";
    void el.play().catch(() => undefined);
    setAudioSource({ type: "element", element: el });
  }, [demoMode, demoDeck]);

  // Browsers block <audio> autoplay until the visitor has interacted with
  // the page. Retry on the first pointerdown anywhere on the landing —
  // after that the audio-reactive shader can do its job.
  useEffect(() => {
    const retry = () => {
      const el = audioRef.current;
      if (el && el.paused) void el.play().catch(() => undefined);
      window.removeEventListener("pointerdown", retry);
    };
    window.addEventListener("pointerdown", retry, { once: true });
    return () => window.removeEventListener("pointerdown", retry);
  }, []);

  // Audio features → store (drives the shader's audio-reactive uniforms)
  // + WS at 5 Hz. The 5 Hz forward goes to an anon Session that ignores
  // most of it; the 60 Hz store write is what makes the visuals feel
  // alive on the landing.
  useAudioFeatures(audioSource, send);

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
      {/* Hidden demo-audio element. Source attached by the effect above. */}
      <audio ref={audioRef} className="hidden" aria-hidden />

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
              className="wordmark font-serif italic leading-[0.95] text-[color:var(--paper)]"
              style={{
                fontSize: "clamp(56px, 9vw, 128px)",
                fontWeight: 500,
              }}
            >
              music,
              <br />
              made visible.
            </h1>
            <p className="font-sans max-w-[38ch] text-[15px] leading-relaxed text-[color:var(--paper)]/85 md:text-[16px]">
              a browser-based visualiser that listens to what you play and
              paints what it hears — in realtime, at 60 frames a second.
            </p>
            <div className="flex flex-wrap items-center gap-5 pt-2">
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
            <p className="font-mono mt-2 text-[10px] uppercase tracking-[0.24em] text-[color:var(--stone)]">
              no install · works in chrome · webgl2
            </p>
          </div>
        </section>

        {/* Capability band */}
        <section className="relative border-t border-[color:var(--hairline)]/25 bg-[color:var(--ink)]/85 px-6 py-12 backdrop-blur-sm md:px-12 md:py-16">
          <div className="grid gap-10 md:grid-cols-3 md:gap-8">
            <Capability
              eyebrow="01 listen"
              hook="from any sound"
              body="share a browser tab, plug a mic, or drop in an audio file. song-recognition adds the artist and title automatically."
            />
            <Capability
              eyebrow="02 speak"
              hook="from your voice"
              body="describe what you want — by voice or by typing — across four fields: subject, environment, mood, palette. one click commits."
            />
            <Capability
              eyebrow="03 watch"
              hook="at sixty frames a second"
              body="a webgl2 displacement shader carries continuity between ai-generated keyframes. twenty-one presets, a kuwahara painterly pass, audio-reactive throughout."
            />
          </div>
        </section>

        {/* Discovery strip — surfaces the hotkeys that used to clutter
           the visualiser chrome. */}
        <section className="relative border-t border-[color:var(--hairline)]/25 bg-[color:var(--ink)]/85 px-6 py-6 backdrop-blur-sm md:px-12">
          <p className="font-mono flex flex-wrap items-center gap-x-6 gap-y-2 text-[10px] uppercase tracking-[0.24em] text-[color:var(--stone)]">
            <span>
              <span className="text-[color:var(--paper)]">f</span> fullscreen
            </span>
            <span>
              <span className="text-[color:var(--paper)]">h</span> hide ui
            </span>
            <span>
              <span className="text-[color:var(--paper)]">r</span> record
            </span>
            <span>
              <span className="text-[color:var(--paper)]">⌫</span> reset
            </span>
          </p>
        </section>

        {/* Footer */}
        <footer className="relative border-t border-[color:var(--hairline)]/25 bg-[color:var(--ink)]/85 px-6 py-6 backdrop-blur-sm md:px-12">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <span className="font-serif text-[22px] italic text-[color:var(--paper)]/85">
              sonara
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
