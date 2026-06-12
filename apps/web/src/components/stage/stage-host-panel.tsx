"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { rpcClient } from "@/lib/orpc";
import { useStageFeed } from "@/lib/stage/use-stage-feed";

import { Seismograph } from "./seismograph";
import { TapTicker } from "./tap-ticker";

import type { ControlTarget } from "@/lib/control-actions";

// Owner-side stage control on the console: open this stage to the crowd
// (stage-keyed targets use the stage's PERMANENT code — printable QR; legacy
// run targets mint a per-gig code), show the QR people scan to drive the
// visuals from their phones, and watch the wire — live activity ticker, room
// pulse, per-kind counts — climb. Opens/closes via stage.open/close; live
// state rides the public /ws/stage feed (no polling).

export const StageHostPanel = ({
  target,
  initialRoom = null,
}: {
  target: ControlTarget | null;
  // Server-truth room (store.stageRoom via the stage.status push) — re-syncs
  // the panel when it remounts inside a sheet. The panel's own open/close
  // actions still update local state optimistically.
  initialRoom?: string | null;
}) => {
  const [room, setRoom] = useState<string | null>(initialRoom);
  // Track server truth while mounted (open/close from another device, or the
  // stage.status echo of our own action).
  useEffect(() => {
    setRoom(initialRoom);
  }, [initialRoom]);
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [stageUrl, setStageUrl] = useState("");
  // Mirrors the projector's join-QR overlay (stage.open defaults it on).
  const [displayQr, setDisplayQr] = useState(true);

  const feed = useStageFeed(room);
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

  if (!target) {
    return null;
  }

  const open = async () => {
    setBusy(true);
    try {
      const { room: minted } = await rpcClient.stage.open({
        ...target,
        allowPrompts: true,
      });
      setRoom(minted);
      setDisplayQr(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "couldn't open stage");
    } finally {
      setBusy(false);
    }
  };

  const close = async () => {
    setBusy(true);
    try {
      await rpcClient.stage.close(target);
      setRoom(null);
    } catch {
      // best-effort
    } finally {
      setBusy(false);
    }
  };

  // Toggle the join QR on the projector (the audience scans the big screen).
  const toggleDisplayQr = async () => {
    const next = !displayQr;
    setDisplayQr(next);
    try {
      await rpcClient.stage.setQr({ ...target, show: next });
    } catch (error) {
      setDisplayQr(!next);
      toast.error(
        error instanceof Error ? error.message : "couldn't toggle the QR"
      );
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-sm border border-[color:var(--hairline)]/25 p-4">
      <div className="flex items-center justify-between">
        <span className="font-sans text-[9px] uppercase tracking-[0.26em] text-[color:var(--stone)]">
          crowd stage
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
                {feed.tapCount} crowd taps · {feed.queue.upNext.length} queued
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

          {/* The wire — last few crowd actions + the room's pulse. */}
          {feed.activity.length > 0 && (
            <div className="flex flex-col gap-2 border-t border-[color:var(--hairline)]/20 pt-3">
              <TapTicker dense events={feed.activity} max={5} />
              <Seismograph height={20} ring={feed.ring} />
            </div>
          )}

          {/* Join QR on the projector — the audience scans the big screen,
              so the host shows it to fill the room and hides it for a clean
              canvas once everyone is in. */}
          <button
            className="focus-ring flex items-center justify-between gap-3 rounded-sm border border-[color:var(--hairline)]/30 px-3 py-2 text-left transition-colors hover:border-[color:var(--paper)]/40"
            onClick={toggleDisplayQr}
            type="button"
          >
            <span className="font-sans text-[10px] uppercase tracking-[0.2em] text-[color:var(--paper)]/85">
              join qr on display
            </span>
            <span
              className={
                displayQr
                  ? "shrink-0 font-mono text-[9px] uppercase tracking-[0.2em] text-[color:var(--signal)]"
                  : "shrink-0 font-mono text-[9px] uppercase tracking-[0.2em] text-[color:var(--stone)]"
              }
            >
              {displayQr ? "shown" : "hidden"}
            </span>
          </button>

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
