"use client";

import Link from "next/link";
import type { ReactNode } from "react";

// Shown when an unauthenticated visitor reaches an auth-gated surface
// (/studio, /stages). The defaults carry the studio copy; /stages passes its
// own. Single CTA to /login, quiet copy in line with the rest of the chrome.
const STUDIO_HEADING = (
  <>
    sign in to browse
    <br />
    your library.
  </>
);

export const AnonCta = ({
  surface = "studio",
  heading = STUDIO_HEADING,
  body = "The studio is where every frame you've generated lives, grouped by session, with the prompt, seed, audio mood, and song that was playing when it landed.",
  next = "/studio",
}: {
  surface?: string;
  heading?: ReactNode;
  body?: string;
  next?: string;
}) => (
  <main className="relative flex min-h-svh items-center justify-center bg-[color:var(--ink)] px-6 text-[color:var(--paper)]">
    <div className="flex max-w-[480px] flex-col items-start gap-5">
      <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-[color:var(--stone)]">
        {surface}
      </span>
      <h1
        className="font-serif italic leading-[1.0] text-[color:var(--paper)]"
        style={{ fontSize: "clamp(32px, 5vw, 56px)", fontWeight: 500 }}
      >
        {heading}
      </h1>
      <p className="font-sans text-[14px] leading-relaxed text-[color:var(--paper)]/85">
        {body}
      </p>
      <div className="flex flex-wrap items-center gap-5 pt-3">
        <Link
          href={`/login?next=${next}`}
          className="focus-ring font-sans border border-[color:var(--paper)]/70 px-5 py-2.5 text-[11px] uppercase tracking-[0.24em] text-[color:var(--paper)] transition-colors hover:bg-[color:var(--paper)] hover:text-[color:var(--ink)]"
        >
          sign in
        </Link>
        <Link
          href="/play"
          className="focus-ring font-sans text-[11px] uppercase tracking-[0.24em] text-[color:var(--stone)] underline-offset-4 transition-colors hover:text-[color:var(--paper)] hover:underline"
        >
          back to /play
        </Link>
      </div>
    </div>
  </main>
);
