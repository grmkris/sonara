"use client";

import { useEffect, useState } from "react";

import { useStageFeed } from "@/lib/stage/use-stage-feed";
import { useVisualizerStore } from "@/stores/visualizer";

import { HandleGlyph } from "./handle-glyph";
import { Seismograph } from "./seismograph";
import { StageJoinQr } from "./stage-join-qr";
import { TapTicker } from "./tap-ticker";

// The projector's crowd wire overlay — the layer the room watches. Mounts
// only while this session's crowd stage is open (stageRoom in the store, fed
// by stage.status): a teleprinter activity ticker + seismograph bottom-left,
// and a "sent by K7QX" credit when a queued prompt takes the screen.
// Entirely pointer-transparent. The wire is PROJECTOR furniture: it shows
// when the operator chrome is hidden and steps aside while the chrome is up
// (the operator has the stage sheet; the big join QR would z-fight the
// rail). The feed socket stays mounted either way so nothing is missed.

const CREDIT_HOLD_MS = 6000;

interface PromptCredit {
  text: string;
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
      <HandleGlyph size={10} who={credit.who} />
      <span className="text-[color:var(--paper)]/75">{credit.who}</span>
    </p>
  </div>
);

const StageWireInner = ({ room }: { room: string }) => {
  const feed = useStageFeed(room);
  const showQr = useVisualizerStore((s) => s.stageShowQr);
  const uiVisible = useVisualizerStore((s) => s.uiVisible);

  // Hold a credit card for a few seconds whenever a new prompt takes the
  // screen; identity is who+text so re-plays of the same prompt don't flash.
  const [credit, setCredit] = useState<PromptCredit | null>(null);
  const playing = feed.queue.nowPlaying;
  const playingKey = playing ? `${playing.who}-${playing.text}` : null;
  useEffect(() => {
    if (!playingKey || !playing) {
      return;
    }
    setCredit({ text: playing.text, who: playing.who });
    const timer = setTimeout(() => setCredit(null), CREDIT_HOLD_MS);
    return () => clearTimeout(timer);
    // playingKey is the identity; `playing` only changes alongside it.
    // oxlint-disable-next-line exhaustive-deps
  }, [playingKey]);

  if (uiVisible) {
    return null;
  }

  return (
    <>
      {showQr && <StageJoinQr room={room} />}
      <div aria-hidden className="pointer-events-none absolute inset-0 z-20">
        {/* The wire: ticker + room pulse, bottom-left above the audio strip. */}
        <div className="absolute bottom-32 left-4 flex w-[340px] max-w-[80vw] flex-col gap-2 md:bottom-36 md:left-10">
          <div aria-hidden className="paper-scrim absolute -inset-4 -z-10" />
          <TapTicker events={feed.activity} max={6} />
          <Seismograph height={22} ring={feed.ring} />
          <p className="font-mono text-[9px] uppercase tracking-[0.26em] text-[color:var(--stone)] tabular-nums">
            wire · {feed.tapCount} taps · room {room}
          </p>
        </div>

        {credit && <NowPlayingCredit credit={credit} />}
      </div>
    </>
  );
};

export const StageWire = () => {
  const room = useVisualizerStore((s) => s.stageRoom);
  if (!room) {
    return null;
  }
  return <StageWireInner room={room} />;
};
