"use client";

import { formatUsdc } from "@sonara/onchain";
import { useEffect, useState } from "react";

import { publicEnv } from "@/env";
import { useStageFeed } from "@/lib/stage/use-stage-feed";
import { useVisualizerStore } from "@/stores/visualizer";

import { AddressGlyph, shortAddress } from "./address-glyph";
import { BlockPulse } from "./block-pulse";
import { Seismograph } from "./seismograph";
import { StageJoinQr } from "./stage-join-qr";
import { TxTicker } from "./tx-ticker";

// The projector's Monad wire overlay — the layer the room (and the judges)
// watch. Mounts only while this session's crowd stage is open (stageRoom in
// the store, fed by stage.status): a teleprinter tx ticker + seismograph
// bottom-left, the block odometer under the wordmark cluster, and a
// "sent by 0x…" credit when a queued prompt takes the screen. Entirely
// pointer-transparent (tx links re-enable their own events) and deliberately
// IGNORES the hide-UI chrome toggle — the wire is part of the show.

const CREDIT_HOLD_MS = 6000;

interface PromptCredit {
  text: string;
  tip: string;
  who: string;
}

const NowPlayingCredit = ({ credit }: { credit: PromptCredit }) => (
  <div
    className="wire-print pointer-events-none absolute inset-x-0 bottom-40 z-20 mx-auto flex w-fit max-w-[70vw] flex-col items-center gap-1.5 text-center md:bottom-44"
    key={`${credit.who}-${credit.text}`}
  >
    <p className="text-legible line-clamp-2 font-serif text-[17px] italic leading-snug text-[color:var(--paper)]/90">
      “{credit.text}”
    </p>
    <p className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.26em] text-[color:var(--stone)]">
      sent by
      <AddressGlyph address={credit.who} size={10} />
      <span className="text-[color:var(--paper)]/75">
        {shortAddress(credit.who)}
      </span>
      {credit.tip !== "0" && (
        <span className="text-[color:var(--signal)]">
          · +{formatUsdc(BigInt(credit.tip)).replace(/\.0+$|(\.\d*?)0+$/u, "$1")}{" "}
          USDC
        </span>
      )}
    </p>
  </div>
);

const StageWireInner = ({ room }: { room: string }) => {
  const feed = useStageFeed(room);
  const showQr = useVisualizerStore((s) => s.stageShowQr);

  // Hold a credit card for a few seconds whenever a new prompt takes the
  // screen; identity is who+text so re-plays of the same prompt don't flash.
  const [credit, setCredit] = useState<PromptCredit | null>(null);
  const playing = feed.queue.nowPlaying;
  const playingKey = playing ? `${playing.who}-${playing.text}` : null;
  useEffect(() => {
    if (!playingKey || !playing) {
      return;
    }
    setCredit({ text: playing.text, tip: playing.tip, who: playing.who });
    const timer = setTimeout(() => setCredit(null), CREDIT_HOLD_MS);
    return () => clearTimeout(timer);
    // playingKey is the identity; `playing` only changes alongside it.
    // oxlint-disable-next-line exhaustive-deps
  }, [playingKey]);

  return (
    <>
      {/* The whole wire is show-layer, not operator chrome: hiding the UI
         (h) keeps the QR, ticker, odometer and credits up — incoming txs ARE
         the show. Only the host's /control QR toggle and the stage closing
         remove anything. */}
      {showQr && <StageJoinQr room={room} />}
      <div aria-hidden className="pointer-events-none absolute inset-0 z-20">
      {/* Block odometer — just under the wordmark cluster. */}
      <BlockPulse
        blockNumber={feed.blockNumber}
        className="absolute left-4 top-[120px] md:left-10 md:top-[132px]"
      />

      {/* The wire: ticker + room pulse, bottom-left above the audio strip. */}
      <div className="absolute bottom-32 left-4 flex w-[340px] max-w-[80vw] flex-col gap-2 md:bottom-36 md:left-10">
        <div aria-hidden className="paper-scrim absolute -inset-4 -z-10" />
        <TxTicker events={feed.activity} max={6} />
        <Seismograph height={22} ring={feed.ring} />
        <p className="font-mono text-[9px] uppercase tracking-[0.26em] text-[color:var(--stone)] tabular-nums">
          wire · {feed.txCount} tx · room {room}
        </p>
      </div>

        {credit && <NowPlayingCredit credit={credit} />}
      </div>
    </>
  );
};

export const StageWire = () => {
  const room = useVisualizerStore((s) => s.stageRoom);
  if (!publicEnv.NEXT_PUBLIC_SONARA_STAGE_CONTRACT || !room) {
    return null;
  }
  return <StageWireInner room={room} />;
};
