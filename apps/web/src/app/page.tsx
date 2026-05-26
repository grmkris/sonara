"use client";

import { Suspense, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CanvasBackplate } from "@/components/canvas-backplate";
import { SiteFooter } from "@/components/site-footer";

// Landing page. The fixed canvas backplate (+ grain + uniform veil) and its
// demo self-start live in <CanvasBackplate />, shared with /about. Marketing
// copy scrolls over it in a z-10 column. Audio-reactivity is a /play concern
// once the visitor brings sound.

export default function LandingPage() {
  return (
    <main className="relative min-h-svh overflow-x-hidden bg-[color:var(--ink)] text-[color:var(--paper)]">
      {/* Old `/?record=…` share-link redirect. Lives inside a Suspense
         boundary because useSearchParams() triggers CSR-bailout otherwise
         and the whole page falls off the prerender path. */}
      <Suspense fallback={null}>
        <OldShareLinkRedirect />
      </Suspense>
      {/* Canvas backplate (fixed) + grain + uniform veil. Everything below
         sits in a z-10 column on top. */}
      <CanvasBackplate />

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
        <section className="relative border-t border-[color:var(--hairline)]/25 px-6 py-12 md:px-12 md:py-16">
          <div className="text-legible grid gap-10 md:grid-cols-3 md:gap-8">
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

        {/* Story / about band — a short promotional bio of what Sonara is. */}
        <section className="relative border-t border-[color:var(--hairline)]/25 px-6 py-14 md:px-12 md:py-20">
          <div className="text-legible flex max-w-[760px] flex-col gap-6">
            <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-[color:var(--stone)]">
              what it is
            </span>
            <h2
              className="font-serif italic leading-[1.05] text-[color:var(--paper)]"
              style={{ fontSize: "clamp(30px, 5vw, 56px)" }}
            >
              a visualiser that
              <br />
              actually listens.
            </h2>
            <div className="flex flex-col gap-4 font-sans text-[15px] leading-relaxed text-[color:var(--paper)]/80 md:text-[16px]">
              <p>
                Sonara turns sound into moving image, live. Open a tab, a mic,
                or a track and it paints what it hears — frame after frame, in
                time with the music, at sixty a second. Tell it a mood in your
                own words, or hand it a picture, and the scene bends that way.
              </p>
              <p>
                Under the hood, AI keyframes meet a real-time shader: FLUX.2
                imagines the looks, a WebGL2 displacement field flows between
                them, and the live audio drives every ripple. The picture never
                freezes and never repeats — it breathes with the room.
              </p>
              <p>
                Born in the browser, made for the floor. Curated starter decks
                get you moving in a click; when you're ready, take it live and
                the scene picks up right where the deck left off. No install, no
                rig — just{" "}
                <span className="font-serif italic text-[color:var(--paper)]">
                  sonara.fm
                </span>{" "}
                and whatever you're playing.
              </p>
            </div>
          </div>
        </section>

        <SiteFooter />
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
