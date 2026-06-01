"use client";

import Link from "next/link";

// Shown to signed-in users who have no generated frames yet. The library
// only fills as you generate — anon demo playback doesn't count.
export function EmptyState() {
  return (
    <div className="flex h-full flex-col items-start justify-center gap-5 px-10 py-16">
      <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-[color:var(--stone)]">
        no library yet
      </span>
      <h2
        className="font-serif italic leading-[1.05] text-[color:var(--paper)]"
        style={{ fontSize: "clamp(28px, 4vw, 44px)", fontWeight: 500 }}
      >
        your library fills as
        <br />
        you generate.
      </h2>
      <p className="font-sans max-w-[44ch] text-[14px] leading-relaxed text-[color:var(--paper)]/80">
        Head to <span className="italic">/play</span>, bring sound, and type a
        scene. Every frame the visualiser generates lands here with its prompt,
        seed, and the audio mood it captured.
      </p>
      <Link
        href="/play"
        className="focus-ring font-sans mt-2 border border-[color:var(--paper)]/70 px-5 py-2.5 text-[11px] uppercase tracking-[0.24em] text-[color:var(--paper)] transition-colors hover:bg-[color:var(--paper)] hover:text-[color:var(--ink)]"
      >
        open /play
      </Link>
    </div>
  );
}
