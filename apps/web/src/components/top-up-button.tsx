"use client";

import { useState } from "react";
import { usePay } from "@reown/appkit-pay/react";
import { baseUSDC } from "@reown/appkit-pay";
import { toast } from "sonner";
import { PACKS, type Pack } from "@music-visualizer/shared";
import { publicEnv } from "@/env";
import { rpcClient } from "@/lib/orpc";

const RECIPIENT = publicEnv.NEXT_PUBLIC_PAY_RECIPIENT_BASE;
// Chain is embedded in `baseUSDC.network` (`eip155:8453`); server expects 8453.
const BASE_CHAIN_ID = 8453;

interface TopUpButtonProps {
  onCredited?: (result: { frames: number }) => void;
}

/**
 * Pay-with-wallet top-up. User clicks a pack, signs a USDC transfer on Base
 * via their connected wallet (Reown AppKit Pay), then the tx hash is posted
 * to /api/credits/confirm for viem-verified on-chain credit.
 */
export function TopUpButton({ onCredited }: TopUpButtonProps) {
  const [busy, setBusy] = useState<Pack["id"] | null>(null);
  const [pendingPack, setPendingPack] = useState<Pack | null>(null);

  const { open } = usePay({
    onSuccess: async (result) => {
      // Reown's PayResult is just the tx hash string (or undefined).
      const txHash = typeof result === "string" ? result : null;
      const pack = pendingPack;
      if (!txHash || !pack) {
        setBusy(null);
        setPendingPack(null);
        toast.error("Payment completed but no tx hash received");
        return;
      }
      try {
        const json = await rpcClient.credits.confirmTopUp({
          txHash,
          chainId: BASE_CHAIN_ID,
          packId: pack.id,
        });
        toast.success(
          "idempotent" in json && json.idempotent
            ? "already credited"
            : `+${pack.frames} frames`,
        );
        onCredited?.({ frames: pack.frames });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "confirm failed", {
          duration: 6000,
        });
      } finally {
        setBusy(null);
        setPendingPack(null);
      }
    },
    onError: (err) => {
      setBusy(null);
      setPendingPack(null);
      // AppKitPayErrorMessage is a string union (e.g. "Invalid payment
      // configuration"), not an Error instance.
      toast.error(typeof err === "string" ? err : "payment failed");
    },
  });

  if (!RECIPIENT) {
    return (
      <p className="font-sans text-[10px] leading-relaxed text-[color:var(--signal)]">
        top-ups unavailable (NEXT_PUBLIC_PAY_RECIPIENT_BASE not set)
      </p>
    );
  }

  const handleBuy = async (pack: Pack) => {
    setBusy(pack.id);
    setPendingPack(pack);
    try {
      await open({
        paymentAsset: baseUSDC,
        recipient: RECIPIENT,
        amount: pack.usd,
      });
    } catch (err) {
      setBusy(null);
      setPendingPack(null);
      toast.error(err instanceof Error ? err.message : "could not open pay");
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
          waiting for wallet…
        </span>
      ) : null}
    </div>
  );
}
