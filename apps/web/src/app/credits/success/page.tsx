"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { rpcClient } from "@/lib/orpc";

// Poll cadence + ceiling. Dodo webhook delivery is async — the user lands
// here before the credit row is updated. Poll the balance for up to ~20s.
const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 20_000;

export default function CheckoutSuccessPage() {
  const router = useRouter();
  const [status, setStatus] = useState<"waiting" | "credited" | "timeout">(
    "waiting",
  );
  const initialFrames = useRef<number | null>(null);

  useEffect(() => {
    const startedAt = Date.now();
    let cancelled = false;

    const poll = async (): Promise<void> => {
      try {
        const { frames } = await rpcClient.credits.getBalance();
        if (cancelled) return;
        if (initialFrames.current === null) {
          initialFrames.current = frames;
        } else if (frames > initialFrames.current) {
          setStatus("credited");
          toast.success(`+${frames - initialFrames.current} frames credited`);
          setTimeout(() => {
            if (!cancelled) router.push("/");
          }, 1200);
          return;
        }
      } catch {
        // ignore transient errors; keep polling
      }
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        if (!cancelled) setStatus("timeout");
        return;
      }
      setTimeout(poll, POLL_INTERVAL_MS);
    };

    void poll();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[color:var(--ink)] p-8">
      <div className="flex w-full max-w-sm flex-col gap-4 border border-[color:var(--hairline)]/50 bg-[color:var(--ink)]/95 p-6 text-center">
        <h1 className="font-mono text-[11px] uppercase tracking-[0.28em] text-[color:var(--stone)]">
          payment received
        </h1>
        {status === "waiting" ? (
          <p className="font-sans text-[12px] leading-relaxed text-[color:var(--paper)]/80">
            Crediting your account. This usually takes a few seconds…
          </p>
        ) : status === "credited" ? (
          <p className="font-sans text-[12px] leading-relaxed text-[color:var(--paper)]">
            Frames credited — back to the visualizer.
          </p>
        ) : (
          <>
            <p className="font-sans text-[12px] leading-relaxed text-[color:var(--paper)]/80">
              Payment confirmed but credits haven&apos;t shown up yet. They
              should arrive shortly. If not, contact support.
            </p>
            <button
              type="button"
              className="font-mono text-[11px] uppercase tracking-[0.2em] text-[color:var(--signal)] underline"
              onClick={() => router.push("/")}
            >
              back to visualizer
            </button>
          </>
        )}
      </div>
    </main>
  );
}
