"use client";

// Shown when a curated reel has no frames yet. Reels are filled from the
// inspector's "add to reel" action on any session frame.
export const ReelEmptyDraft = () => (
  <div className="flex h-full flex-col items-start justify-center gap-5 px-10 py-16">
    <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-[color:var(--stone)]">
      empty reel
    </span>
    <h2
      className="font-serif italic leading-[1.05] text-[color:var(--paper)]"
      style={{ fontSize: "clamp(24px, 3.4vw, 38px)", fontWeight: 500 }}
    >
      add frames to
      <br />
      build this reel.
    </h2>
    <p className="font-sans max-w-[44ch] text-[14px] leading-relaxed text-[color:var(--paper)]/80">
      Open the <span className="italic">sessions</span> tab, pick any frame, and
      use <span className="italic">add to reel</span> in the inspector. Frames
      can come from any session and play back in the order you arrange them.
    </p>
  </div>
);
