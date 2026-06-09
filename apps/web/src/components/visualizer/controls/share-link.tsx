"use client";

import {
  LiveSessionIdSchema,
  typeIdFromUuid,
  typeIdToUuid,
} from "@sonara/shared/typeid";
import { Share2 } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

// Share affordance on /play (signed-in only): the permalink to THIS
// performance's recording set — /s/<set_id>. The set id is derivable client
// side because a recording set reuses its live session's uuid (see
// sets-architecture.md), and the durable liveSessionId already lives in
// sessionStorage. Live now, replay forever after — the link never dies.

const LIVE_SESSION_STORAGE_KEY = "sonara.liveSessionId";

// The recording set's id from the tab's durable liveSessionId. Validate on
// read — a corrupted value would mint a dead link. Null = nothing to share
// (no session storage yet, or garbage).
const readSetId = (): string | null => {
  if (typeof window === "undefined") {
    return null;
  }
  const raw = window.sessionStorage.getItem(LIVE_SESSION_STORAGE_KEY);
  const parsed = raw ? LiveSessionIdSchema.safeParse(raw) : null;
  if (!parsed?.success) {
    return null;
  }
  return typeIdFromUuid("frameSet", typeIdToUuid(parsed.data).uuid);
};

export const ShareLink = () => {
  const [setId, setSetId] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [qr, setQr] = useState<string | null>(null);

  // sessionStorage isn't readable during SSR — resolve after mount (decides
  // whether the button renders at all), then re-resolve on every open so a
  // "new session" mid-visit shares the fresh set, not the old one.
  useEffect(() => {
    setSetId(readSetId());
  }, []);

  const onOpenChange = (open: boolean) => {
    if (!open) {
      return;
    }
    const next = readSetId();
    setSetId(next);
    if (!next) {
      return;
    }
    const nextUrl = `${window.location.origin}/s/${next}`;
    setUrl(nextUrl);
    void (async () => {
      setQr(await QRCode.toDataURL(nextUrl, { margin: 1, width: 240 }));
    })();
  };

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("link copied");
    } catch {
      toast.error("couldn't copy — long-press to copy");
    }
  };

  if (!setId) {
    return null;
  }

  return (
    <Popover onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="share this set"
          title="share — live now, replay later"
          className="focus-ring flex items-center text-[color:var(--stone)] transition-colors hover:text-[color:var(--paper)]"
        >
          <Share2 className="size-4" strokeWidth={1.5} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-64 rounded-sm border-[color:var(--hairline)]/30 bg-[color:var(--ink)]/95 p-4 text-[color:var(--paper)] backdrop-blur-md"
      >
        <div className="flex flex-col gap-3">
          {qr && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              alt="scan to watch this set"
              className="mx-auto size-40 rounded-sm bg-white p-1"
              src={qr}
            />
          )}
          {url && (
            <button
              type="button"
              onClick={copy}
              className="focus-ring flex items-center justify-between gap-3 rounded-sm border border-[color:var(--hairline)]/30 px-3 py-2 text-left transition-colors hover:border-[color:var(--paper)]/40"
            >
              <span className="break-all font-mono text-[10px] text-[color:var(--paper)]/80">
                {url}
              </span>
              <span className="shrink-0 font-sans text-[9px] uppercase tracking-[0.2em] text-[color:var(--stone)]">
                copy
              </span>
            </button>
          )}
          <p className="font-sans text-[9px] uppercase leading-relaxed tracking-[0.2em] text-[color:var(--stone)]">
            anyone with the link can watch — now live, later the replay
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
};
