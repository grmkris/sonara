"use client";

import Link from "next/link";

// Shared footer for the marketing pages (landing + about). No opaque panel /
// blur — it sits over the uniform canvas backplate like the rest of the page,
// with a hairline rule and a soft text halo for legibility.
export function SiteFooter() {
  return (
    <footer className="text-legible relative border-t border-[color:var(--hairline)]/25 px-6 py-6 md:px-12">
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
            href="/about"
            className="transition-colors hover:text-[color:var(--paper)]"
          >
            about
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
  );
}
