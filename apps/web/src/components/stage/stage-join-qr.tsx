"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";

// The projector's join card: a scannable QR + room code + short URL, sized
// for a phone camera across a room. Host-toggled from /control (stage.status
// showQr) and deliberately INDEPENDENT of the hide-UI chrome toggle — the QR
// is part of the show, not part of the operator chrome.

export const StageJoinQr = ({ room }: { room: string }) => {
  const [qr, setQr] = useState<string | null>(null);
  const [url, setUrl] = useState("");

  useEffect(() => {
    const joinUrl = `${window.location.origin}/stage/${room}`;
    setUrl(joinUrl);
    let cancelled = false;
    void (async () => {
      const data = await QRCode.toDataURL(joinUrl, { margin: 1, width: 480 });
      if (!cancelled) {
        setQr(data);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [room]);

  if (!qr) {
    return null;
  }

  return (
    <div className="reveal pointer-events-none absolute bottom-32 right-4 z-20 flex flex-col items-center gap-2 md:bottom-36 md:right-10">
      <div aria-hidden className="paper-scrim absolute -inset-5 -z-10" />
      <p className="font-sans text-[10px] uppercase tracking-[0.26em] text-[color:var(--paper)]/85">
        scan to drive the visuals
      </p>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        alt={`scan to join stage ${room}`}
        className="size-44 rounded-sm border border-[color:var(--hairline)]/40 bg-white p-1.5 md:size-52"
        src={qr}
      />
      <p className="font-mono text-[20px] uppercase tracking-[0.3em] text-[color:var(--paper)]">
        {room}
      </p>
      <p className="font-mono text-[10px] lowercase tracking-[0.12em] text-[color:var(--stone)]">
        {url.replace(/^https?:\/\//u, "")}
      </p>
    </div>
  );
};
