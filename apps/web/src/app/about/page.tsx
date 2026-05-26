"use client";

import { Mail } from "lucide-react";
import { CanvasBackplate } from "@/components/canvas-backplate";
import { SiteFooter } from "@/components/site-footer";

// About page. Same fixed canvas backplate as the landing (via CanvasBackplate),
// with the intro + what-it-is + maker copy scrolling over it in a z-10 column.

const CONTACT_LINK =
  "focus-ring font-sans inline-flex items-center gap-2 border border-[color:var(--paper)]/70 px-4 py-2.5 text-[11px] uppercase tracking-[0.24em] text-[color:var(--paper)] transition-colors hover:bg-[color:var(--paper)] hover:text-[color:var(--ink)]";

export default function AboutPage() {
  return (
    <main className="relative min-h-svh overflow-x-hidden bg-[color:var(--ink)] text-[color:var(--paper)]">
      <CanvasBackplate />

      <div className="relative z-10 flex min-h-svh flex-col">
        {/* Intro */}
        <section className="relative flex flex-1 items-end px-6 pb-10 pt-20 md:items-center md:px-12 md:pt-28">
          <div
            aria-hidden
            className="paper-scrim pointer-events-none absolute inset-x-0 bottom-0 top-1/4 -z-10"
          />
          <div className="text-legible flex max-w-[720px] flex-col gap-6">
            <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-[color:var(--stone)]">
              about
            </span>
            <h1
              className="reveal wordmark font-serif italic leading-[1.0] text-[color:var(--paper)]"
              style={{ fontSize: "clamp(40px, 7vw, 88px)", fontWeight: 500 }}
            >
              the visualiser
              <br />
              that listens.
            </h1>
            <p className="reveal reveal-1 font-sans max-w-[44ch] text-[15px] leading-relaxed text-[color:var(--paper)]/85 md:text-[16px]">
              Sonara turns your music into moving art, right in your web browser.
              Play anything and it paints pictures that shift and flow along with
              the sound, as it happens — nothing to download, nothing to set up.
            </p>
          </div>
        </section>

        {/* What it is */}
        <section className="relative border-t border-[color:var(--hairline)]/25 px-6 py-14 md:px-12 md:py-20">
          <div className="text-legible flex max-w-[760px] flex-col gap-6">
            <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-[color:var(--stone)]">
              what it is
            </span>
            <h2
              className="font-serif italic leading-[1.05] text-[color:var(--paper)]"
              style={{ fontSize: "clamp(28px, 4.5vw, 48px)" }}
            >
              it paints what
              <br />
              it hears.
            </h2>
            <div className="flex flex-col gap-4 font-sans text-[15px] leading-relaxed text-[color:var(--paper)]/80 md:text-[16px]">
              <p>
                Play a song, sing into your mic, or drop in a track — Sonara
                listens, and it even recognises what's playing. Or just tell it a
                mood in your own words, or show it a picture, and the visuals
                follow your lead.
              </p>
              <p>
                The picture never sits still and never repeats itself — it moves
                with every beat and breathes with the room.
              </p>
              <p>
                Start from one of the ready-made looks with a single click. When
                you want to make it your own, take the controls and steer it
                live — the visuals carry on right from there.
              </p>
            </div>
          </div>
        </section>

        {/* Made by */}
        <section className="relative border-t border-[color:var(--hairline)]/25 px-6 py-14 md:px-12 md:py-20">
          <div className="text-legible flex max-w-[760px] flex-col gap-6">
            <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-[color:var(--stone)]">
              made by
            </span>
            <h2
              className="font-serif italic leading-[1.05] text-[color:var(--paper)]"
              style={{ fontSize: "clamp(28px, 4.5vw, 48px)" }}
            >
              built by Kristjan Grm.
            </h2>
            <p className="font-sans max-w-[52ch] text-[15px] leading-relaxed text-[color:var(--paper)]/80 md:text-[16px]">
              An independent developer building playful things where music and AI
              meet. Say hello, follow along, or peek behind the scenes.
            </p>
            <div className="flex flex-wrap items-center gap-4 pt-2">
              <a
                href="mailto:kristjan.grm1@gmail.com"
                className={CONTACT_LINK}
                aria-label="email Kristjan"
              >
                <Mail size={14} aria-hidden />
                email
              </a>
              <a
                href="https://github.com/grmkris"
                target="_blank"
                rel="noopener noreferrer"
                className={CONTACT_LINK}
                aria-label="Kristjan on GitHub"
              >
                <GithubGlyph />
                grmkris
              </a>
              <a
                href="https://x.com/_krisgg"
                target="_blank"
                rel="noopener noreferrer"
                className={CONTACT_LINK}
                aria-label="Kristjan on X"
              >
                <XGlyph />
                _krisgg
              </a>
            </div>
          </div>
        </section>

        <SiteFooter />
      </div>
    </main>
  );
}

// Brand marks aren't in lucide-react, so we inline them. currentColor lets them
// invert with the chip's paper→ink hover.
function GithubGlyph() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      focusable="false"
    >
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

function XGlyph() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      focusable="false"
    >
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}
