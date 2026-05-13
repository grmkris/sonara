"use client";

import { useState } from "react";
import { toast } from "sonner";
import { PACKS, type Pack } from "@music-visualizer/shared";
import { rpcClient } from "@/lib/orpc";

interface TopUpButtonProps {
  onCredited?: (result: { frames: number }) => void;
}

/**
 * Dodo Payments checkout redirect. Click a pack → server creates a Dodo
 * checkout session → window navigates to the hosted checkout page. The
 * webhook handler (apps/web/src/server/dodo-webhook.ts) credits frames on
 * `payment.succeeded`. After redirect back to /credits/success the panel
 * re-fetches the balance.
 */
export function TopUpButton({ onCredited: _ }: TopUpButtonProps) {
  const [busy, setBusy] = useState<Pack["id"] | null>(null);

  const handleBuy = async (pack: Pack) => {
    setBusy(pack.id);
    try {
      const { checkoutUrl } = await rpcClient.credits.createCheckout({
        packId: pack.id,
      });
      window.location.href = checkoutUrl;
    } catch (err) {
      setBusy(null);
      toast.error(err instanceof Error ? err.message : "checkout failed");
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="font-sans text-[10px] uppercase tracking-[0.28em] text-[color:var(--stone)]">
        top up
      </span>
      <div className="flex flex-col gap-1.5">
        {PACKS.map((pack) => (
          <button
            key={pack.id}
            type="button"
            disabled={busy !== null}
            onClick={() => {
              void handleBuy(pack);
            }}
            className="flex items-baseline justify-between gap-3 border border-[color:var(--hairline)]/40 px-3 py-2 font-mono text-[11px] tracking-[0.14em] text-[color:var(--paper)]/85 transition-colors hover:border-[color:var(--paper)] hover:text-[color:var(--paper)] disabled:opacity-40"
          >
            <span className="uppercase">{pack.id}</span>
            <span className="text-[color:var(--stone)]">
              {pack.frames.toLocaleString()}f
            </span>
            <span className="nums">${pack.usd}</span>
          </button>
        ))}
      </div>
      {busy ? (
        <span className="font-sans text-[10px] uppercase tracking-[0.28em] text-[color:var(--stone)]/70">
          redirecting to checkout…
        </span>
      ) : null}
    </div>
  );
}
