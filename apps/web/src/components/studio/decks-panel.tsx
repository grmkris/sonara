"use client";

import type { FrameSetSummary } from "@sonara/shared";
import { Play } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { ActivateOnStage } from "@/components/studio/activate-on-stage";
import { rpcClient } from "@/lib/orpc";

// Read-only center pane for the studio's "decks" tab: the builtin sets
// (system-owned, immutable) with their baked looks, previewable on /play and
// activatable on a stage like any other set. Self-contained — fetches its
// own list and skips the page's selection/drag machinery entirely.
export const DecksPanel = () => {
  const [decks, setDecks] = useState<FrameSetSummary[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const { sets } = await rpcClient.sets.list({ origin: "builtin" });
        if (!cancelled) {
          setDecks(sets);
        }
      } catch {
        if (!cancelled) {
          setFailed(true);
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  if (failed) {
    return (
      <div className="px-10 py-16 font-sans text-[10px] uppercase tracking-[0.22em] text-[color:var(--stone)]">
        couldn't load the decks
      </div>
    );
  }
  if (decks === null) {
    return (
      <div className="px-10 py-16 font-sans text-[10px] uppercase tracking-[0.22em] text-[color:var(--stone)]">
        loading…
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto px-6 py-6 md:px-10">
      <p className="mb-6 max-w-[60ch] font-sans text-[11px] leading-relaxed text-[color:var(--stone)]">
        the shipped decks — curated, pre-generated sets with a baked look
        (preset · reactivity · pacing). they're system-owned and read-only:
        preview one on /play, or push it to a stage.
      </p>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {decks.map((d) => (
          <li
            key={d.id}
            className="flex flex-col gap-3 border border-[color:var(--hairline)]/30 p-3"
          >
            <div className="flex items-center gap-3">
              {d.coverUrl ? (
                // biome-ignore lint/performance/noImgElement: origin-relative library covers; next/image adds nothing here.
                <img
                  src={d.coverUrl}
                  alt=""
                  className="size-14 shrink-0 object-cover"
                />
              ) : (
                <div className="size-14 shrink-0 bg-[color:var(--paper)]/5" />
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate font-sans text-[12px] text-[color:var(--paper)]/90">
                  {d.name}
                </div>
                <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-[color:var(--stone)]">
                  {d.frameCount} frames
                  {d.look ? ` · ${d.look.preset.replaceAll("_", " ")}` : ""}
                  {d.visibility === "unlisted" ? " · unlisted" : ""}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <ActivateOnStage setId={d.id} />
              <Link
                href={`/play?set=${encodeURIComponent(d.id)}`}
                className="focus-ring font-sans inline-flex items-center gap-1.5 border border-[color:var(--hairline)]/40 px-3 py-1.5 text-[10px] uppercase tracking-[0.22em] text-[color:var(--paper)]/85 transition-colors hover:border-[color:var(--paper)]/70 hover:text-[color:var(--paper)]"
              >
                <Play className="size-3" strokeWidth={1.5} />
                preview
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
};
