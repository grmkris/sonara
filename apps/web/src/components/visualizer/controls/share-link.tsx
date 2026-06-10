"use client";

import {
  LiveSessionIdSchema,
  typeIdFromUuid,
  typeIdToUuid,
} from "@sonara/shared/typeid";
import { Share2 } from "lucide-react";
import QRCode from "qrcode";
import { useState } from "react";
import { toast } from "sonner";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useVisualizerStore } from "@/stores/visualizer";

// Share affordance on /play (signed-in only): the permalink to THIS
// performance's recording set — /s/<set_id>. The set id is derivable client
// side because a recording set reuses its live session's uuid (see
// sets-architecture.md). Run identity is server-owned: it arrives via the
// `run.started` event into the store, so the link tracks "new set" swaps
// automatically and renders nothing before the first connect (correct —
// there is no set to share yet). Live now, replay forever after.

const copy = async (text: string): Promise<void> => {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("link copied");
  } catch {
    toast.error("couldn't copy — long-press to copy");
  }
};

const setIdFromRun = (liveRun: string | null): string | null => {
  const parsed = liveRun ? LiveSessionIdSchema.safeParse(liveRun) : null;
  if (!parsed?.success) {
    return null;
  }
  return typeIdFromUuid("frameSet", typeIdToUuid(parsed.data).uuid);
};

// stageCode (when the screen knows its stage) makes the PERMANENT crowd URL
// the headline share — printable once, survives every set — with this set's
// replay permalink as the secondary copy row.
export const ShareLink = ({ stageCode = null }: { stageCode?: string | null }) => {
  const liveRun = useVisualizerStore((s) => s.liveRun);
  const setId = setIdFromRun(liveRun);
  const [url, setUrl] = useState("");
  const [qr, setQr] = useState<string | null>(null);

  const onOpenChange = (open: boolean) => {
    if (!(open && setId)) {
      return;
    }
    // QR + primary row: the stage's crowd page when available (permanent),
    // else this set's permalink (legacy runs).
    const nextUrl = stageCode
      ? `${window.location.origin}/stage/${stageCode}`
      : `${window.location.origin}/s/${setId}`;
    setUrl(nextUrl);
    void (async () => {
      setQr(await QRCode.toDataURL(nextUrl, { margin: 1, width: 240 }));
    })();
  };

  const replayUrl =
    typeof window === "undefined" || !setId
      ? ""
      : `${window.location.origin}/s/${setId}`;

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
              onClick={() => void copy(url)}
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
          {stageCode && replayUrl && (
            <button
              type="button"
              onClick={() => void copy(replayUrl)}
              className="focus-ring flex items-center justify-between gap-3 rounded-sm border border-[color:var(--hairline)]/30 px-3 py-2 text-left transition-colors hover:border-[color:var(--paper)]/40"
            >
              <span className="break-all font-mono text-[10px] text-[color:var(--stone)]">
                this set&apos;s replay link
              </span>
              <span className="shrink-0 font-sans text-[9px] uppercase tracking-[0.2em] text-[color:var(--stone)]">
                copy
              </span>
            </button>
          )}
          <p className="font-sans text-[9px] uppercase leading-relaxed tracking-[0.2em] text-[color:var(--stone)]">
            {stageCode
              ? "your stage's permanent link — print it once"
              : "anyone with the link can watch — now live, later the replay"}
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
};
