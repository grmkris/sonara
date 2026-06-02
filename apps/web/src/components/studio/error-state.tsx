"use client";

// Shown when a library fetch fails — distinct from EmptyState so a transient
// network/500 error doesn't masquerade as "you have no library yet". Offers a
// retry that re-runs the failed request.
export function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex h-full flex-col items-start justify-center gap-5 px-10 py-16">
      <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-[color:var(--stone)]">
        couldn’t load
      </span>
      <h2
        className="font-serif italic leading-[1.05] text-[color:var(--paper)]"
        style={{ fontSize: "clamp(28px, 4vw, 44px)", fontWeight: 500 }}
      >
        something went
        <br />
        sideways.
      </h2>
      <p className="font-sans max-w-[44ch] text-[14px] leading-relaxed text-[color:var(--paper)]/80">
        We couldn’t reach your library just now. This is usually a passing
        network blip — try again.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="focus-ring font-sans mt-2 border border-[color:var(--paper)]/70 px-5 py-2.5 text-[11px] uppercase tracking-[0.24em] text-[color:var(--paper)] transition-colors hover:bg-[color:var(--paper)] hover:text-[color:var(--ink)]"
      >
        retry
      </button>
    </div>
  );
}
