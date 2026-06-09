"use client";

import { formatUsdc } from "@sonara/onchain";
import type { LiveSessionId } from "@sonara/shared/typeid";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { publicEnv } from "@/env";
import { rpcClient } from "@/lib/orpc";
import { useStageFeed } from "@/lib/stage/use-stage-feed";

import { Seismograph } from "./seismograph";
import { TxTicker } from "./tx-ticker";

// Owner-side stage control on the operator remote: open this live session to
// the crowd (mints a room code), show the QR people scan to drive the visuals
// over Monad txs, and watch the wire — live tx ticker, room pulse, per-kind
// counts — climb. Opens/closes via control.openStage/closeStage; live state
// rides the public /ws/stage feed (no polling).

export const StageHostPanel = ({
  liveSessionId,
}: {
  liveSessionId: LiveSessionId | null;
}) => {
  const configured = !!publicEnv.NEXT_PUBLIC_SONARA_STAGE_CONTRACT;
  const [room, setRoom] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [stageUrl, setStageUrl] = useState("");

  const feed = useStageFeed(room);
  const revenueUnits = BigInt(feed.revenueUnits);
  const nowPlaying = feed.queue.nowPlaying?.text ?? null;

  // Build the shareable URL + QR once a room is minted.
  useEffect(() => {
    if (!room || typeof window === "undefined") {
      setQr(null);
      setStageUrl("");
      return;
    }
    const url = `${window.location.origin}/stage/${room}`;
    setStageUrl(url);
    void (async () => {
      setQr(await QRCode.toDataURL(url, { margin: 1, width: 320 }));
    })();
  }, [room]);

  const copyLink = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(stageUrl);
      toast.success("link copied");
    } catch {
      toast.error("couldn't copy — long-press to copy");
    }
  };

  if (!configured || !liveSessionId) {
    return null;
  }

  const open = async () => {
    setBusy(true);
    try {
      const { room: minted } = await rpcClient.control.openStage({
        allowPrompts: true,
        liveSessionId,
      });
      setRoom(minted);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "couldn't open stage");
    } finally {
      setBusy(false);
    }
  };

  const close = async () => {
    setBusy(true);
    try {
      await rpcClient.control.closeStage({ liveSessionId });
      setRoom(null);
    } catch {
      // best-effort
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-sm border border-[color:var(--hairline)]/25 p-4">
      <div className="flex items-center justify-between">
        <span className="font-sans text-[9px] uppercase tracking-[0.26em] text-[color:var(--stone)]">
          crowd stage · monad
        </span>
        {room ? (
          <Button onClick={close} size="sm" variant="ghost" disabled={busy}>
            <span className="font-sans text-[10px] uppercase tracking-[0.2em]">
              close
            </span>
          </Button>
        ) : (
          <Button onClick={open} size="sm" disabled={busy}>
            <span className="font-sans text-[10px] uppercase tracking-[0.2em]">
              open to crowd
            </span>
          </Button>
        )}
      </div>

      {room && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-4">
            {qr && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                alt="scan to join the stage"
                className="size-28 rounded-sm bg-white p-1"
                src={qr}
              />
            )}
            <div className="flex flex-col gap-1">
              <span className="font-mono text-[26px] uppercase tracking-[0.2em] text-[color:var(--paper)]">
                {room}
              </span>
              <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-[color:var(--stone)]">
                {feed.txCount} on-chain taps · {feed.queue.upNext.length}{" "}
                queued
                {revenueUnits > 0n && ` · ${formatUsdc(revenueUnits)} usdc`}
              </span>
              <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-[color:var(--stone)] tabular-nums">
                {feed.kindCounts.nudge} nudges · {feed.kindCounts.set} sets ·{" "}
                {feed.kindCounts.prompt} prompts
              </span>
              {nowPlaying && (
                <span className="line-clamp-1 font-serif text-[12px] italic text-[color:var(--paper)]/80">
                  {nowPlaying}
                </span>
              )}
            </div>
          </div>

          {/* The wire — last few on-chain actions + the room's pulse. */}
          {feed.activity.length > 0 && (
            <div className="flex flex-col gap-2 border-t border-[color:var(--hairline)]/20 pt-3">
              <TxTicker dense events={feed.activity} max={5} />
              <Seismograph height={20} ring={feed.ring} />
            </div>
          )}

          {/* Shareable link (tap to copy) — for anyone who can't scan. */}
          {stageUrl && (
            <button
              className="focus-ring flex items-center justify-between gap-3 rounded-sm border border-[color:var(--hairline)]/30 px-3 py-2 text-left transition-colors hover:border-[color:var(--paper)]/40"
              onClick={copyLink}
              type="button"
            >
              <span className="break-all font-mono text-[11px] text-[color:var(--paper)]/80">
                {stageUrl}
              </span>
              <span className="shrink-0 font-sans text-[9px] uppercase tracking-[0.2em] text-[color:var(--stone)]">
                copy
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  );
};
