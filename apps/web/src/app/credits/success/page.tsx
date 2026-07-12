"use client";

import { useRouter, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { Suspense, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { rpcClient } from "@/lib/orpc";

// Poll cadence + ceiling for the webhook-race fallback. The primary path is
// confirm-on-return (credits.confirmTopUp with the payment_id Dodo appends to
// the return_url) which settles immediately; polling only matters for legacy
// redirects without the param or a transient confirm failure.
const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 20_000;

type Status = "waiting" | "credited" | "failed" | "timeout";

const CheckoutSuccessContent = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const paymentId = searchParams.get("payment_id");
  const [status, setStatus] = useState<Status>("waiting");
  const initialFrames = useRef<number | null>(null);
  const confirmFired = useRef(false);

  useEffect(() => {
    const startedAt = Date.now();
    const cancelled = { current: false };

    const goToPlaySoon = (cancelledRef: { current: boolean }) => {
      setTimeout(() => {
        if (!cancelledRef.current) {
          router.push("/play");
        }
      }, 1200);
    };

    // Primary: reconcile against Dodo by payment id, server-side. Credits
    // apply through the same idempotent ledger write as the webhook.
    const confirm = async (): Promise<boolean> => {
      if (!paymentId || confirmFired.current) {
        return false;
      }
      confirmFired.current = true;
      try {
        const result = await rpcClient.credits.confirmTopUp({ paymentId });
        if (cancelled.current) {
          return true;
        }
        if (result.credited) {
          setStatus("credited");
          toast.success(`+${result.frames} frames credited`);
          goToPlaySoon(cancelled);
          return true;
        }
        if (result.status === "failed" || result.status === "cancelled") {
          setStatus("failed");
          return true;
        }
        // Still processing → fall through to polling.
        return false;
      } catch {
        // Confirm unavailable → fall through to polling.
        return false;
      }
    };

    const poll = async (): Promise<void> => {
      try {
        const { frames } = await rpcClient.credits.getBalance();
        if (cancelled.current) {
          return;
        }
        if (initialFrames.current === null) {
          initialFrames.current = frames;
        } else if (frames > initialFrames.current) {
          setStatus("credited");
          toast.success(`+${frames - initialFrames.current} frames credited`);
          goToPlaySoon(cancelled);
          return;
        }
      } catch {
        // ignore transient errors; keep polling
      }
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        if (!cancelled.current) {
          setStatus("timeout");
        }
        return;
      }
      setTimeout(() => void poll(), POLL_INTERVAL_MS);
    };

    void (async () => {
      const settled = await confirm();
      if (!(settled || cancelled.current)) {
        void poll();
      }
    })();
    return () => {
      cancelled.current = true;
    };
  }, [paymentId, router]);

  let statusBody: ReactNode;
  if (status === "waiting") {
    statusBody = (
      <p className="font-sans text-[12px] leading-relaxed text-[color:var(--paper)]/80">
        Crediting your account. This usually takes a few seconds…
      </p>
    );
  } else if (status === "credited") {
    statusBody = (
      <p className="font-sans text-[12px] leading-relaxed text-[color:var(--paper)]">
        Frames credited — back to the visualizer.
      </p>
    );
  } else if (status === "failed") {
    statusBody = (
      <>
        <p className="font-sans text-[12px] leading-relaxed text-[color:var(--paper)]/80">
          The payment didn&apos;t go through — nothing was charged. You can try
          again from the credits panel.
        </p>
        <button
          type="button"
          className="font-mono text-[11px] uppercase tracking-[0.2em] text-[color:var(--signal)] underline"
          onClick={() => router.push("/play")}
        >
          back to visualiser
        </button>
      </>
    );
  } else {
    statusBody = (
      <>
        <p className="font-sans text-[12px] leading-relaxed text-[color:var(--paper)]/80">
          Payment confirmed but credits haven&apos;t shown up yet. They should
          arrive shortly. If not, contact support.
        </p>
        <button
          type="button"
          className="font-mono text-[11px] uppercase tracking-[0.2em] text-[color:var(--signal)] underline"
          onClick={() => router.push("/play")}
        >
          back to visualiser
        </button>
      </>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[color:var(--ink)] p-8">
      <div className="flex w-full max-w-sm flex-col gap-4 border border-[color:var(--hairline)]/50 bg-[color:var(--ink)]/95 p-6 text-center">
        <h1 className="font-mono text-[11px] uppercase tracking-[0.28em] text-[color:var(--stone)]">
          {status === "failed" ? "payment failed" : "payment received"}
        </h1>
        {statusBody}
      </div>
    </main>
  );
};

export default function CheckoutSuccessPage() {
  return (
    <Suspense fallback={null}>
      <CheckoutSuccessContent />
    </Suspense>
  );
}
