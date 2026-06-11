"use client";

import {
  DECKS,
  canSeeUnlistedDecks,
  deckLabel,
  isDeckUnlisted,
} from "@sonara/shared";
import type { FrameSetSummary } from "@sonara/shared";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { usePickDeck } from "@/components/visualizer/controls/deck-picker";
import { startSetReplayById } from "@/lib/apply-source";
import { useSession } from "@/lib/auth-client";
import { rpcClient } from "@/lib/orpc";
import type { SessionSend } from "@/lib/session-actions";
import { cn } from "@/lib/utils";
import { useVisualizerStore } from "@/stores/visualizer";

interface SourceSwitcherProps {
  send: SessionSend;
  // "local": this device owns the canvas — set picks start the client replay
  // loop here. "remote": a detached console driving another screen — set
  // picks are hidden until the source.set bridge lands (W5); deck picks
  // already travel via the unified send (demo.set → control.setDemoMode).
  mode?: "local" | "remote";
  showSets?: boolean;
}

// The Now-Showing transport: one control naming what the canvas is showing
// (live / a deck / a set replay / idle) with a stop and a picker over every
// playable source. Replaces the bare DeckPicker slot in the controls panel —
// decks, recordings and curated cuts are all Sets now, switched from here.
//
// Deck picks go through usePickDeck so this and the standalone DeckPicker
// (still used on /control) stay behaviourally identical. Set picks mirror
// the ?set= replay path (set-playback-consumer): fetch the ordered frames,
// hand them to the set-playback slice, let useSetPlaybackLoop produce.

const GROUP_HEADER =
  "px-3 pt-2 pb-1 font-mono text-[9px] uppercase tracking-[0.26em] text-[color:var(--stone)]";

// Unlisted (show-specific) decks render only for allowlisted operators.
const visibleDecksFor = (sessionData: { user?: { email?: string } } | null) => {
  const showUnlisted = canSeeUnlistedDecks(sessionData?.user?.email);
  return DECKS.filter((d) => showUnlisted || !isDeckUnlisted(d.key));
};

const SetRows = ({
  active,
  onPick,
  sets,
}: {
  active: string | null;
  onPick: (s: FrameSetSummary) => void;
  sets: FrameSetSummary[];
}) => (
  <ul>
    {sets.map((s) => (
      <li key={s.id}>
        <button
          type="button"
          onClick={() => onPick(s)}
          className={cn(
            "focus-ring flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left transition-colors hover:bg-[color:var(--paper)]/10",
            active === s.id && "bg-[color:var(--paper)]/10"
          )}
        >
          <span className="truncate font-sans text-[12px] text-[color:var(--paper)]/90">
            {s.name}
          </span>
          <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.16em] text-[color:var(--stone)]">
            {s.frameCount}
          </span>
        </button>
      </li>
    ))}
  </ul>
);

export const SourceSwitcher = ({
  send,
  mode = "local",
  showSets = mode === "local",
}: SourceSwitcherProps) => {
  const { data: sessionData } = useSession();
  const isSignedIn = !!sessionData?.session;
  const visibleDecks = visibleDecksFor(sessionData);
  const source = useVisualizerStore((s) => s.source);
  const stopToIdle = useVisualizerStore((s) => s.stopToIdle);
  const pickDeck = usePickDeck(send);

  const [open, setOpen] = useState(false);
  const [sets, setSets] = useState<FrameSetSummary[]>([]);
  const [loading, setLoading] = useState(false);

  // One source, one label — the unified slice replaced the old precedence
  // dance across three state fields.
  let label = "idle";
  if (source.kind === "set") {
    label = source.name ?? "set";
  } else if (source.kind === "deck") {
    label = deckLabel(source.deck);
  } else if (source.kind === "live") {
    label = "live";
  }
  const stoppable = source.kind === "set" || source.kind === "deck";

  // ■ stop → idle canvas (holds the last frame). The source reporter tells
  // the server.
  const onStop = () => {
    stopToIdle();
  };

  // Recordings + cuts load lazily on every open so a just-finished take shows
  // up without a page reload. Builtins are dropped — the decks group renders
  // from DECKS (client-native manifests, no fetch needed to play them).
  const loadSets = async () => {
    setLoading(true);
    try {
      const { sets: rows } = await rpcClient.sets.list({});
      setSets(rows.filter((s) => s.origin !== "builtin"));
    } catch {
      toast.error("couldn't load your sets");
    } finally {
      setLoading(false);
    }
  };

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next && isSignedIn && showSets) {
      void loadSets();
    }
  };

  const onPickDeck = (deck: string) => {
    setOpen(false);
    // setSource is the single transition — leaving a replay for a deck is
    // just the next source.
    pickDeck(deck);
  };

  const onPickSet = async (summary: FrameSetSummary) => {
    setOpen(false);
    if (mode === "remote") {
      // The screen applies it (source.set event) and confirms via
      // source.report — never start a local replay on the console device.
      send({
        source: { kind: "set", label: summary.name, setId: summary.id },
        type: "source.set",
      });
      return;
    }
    await startSetReplayById(summary.id, send);
  };

  const recordings = sets.filter((s) => s.origin === "recording");
  const cuts = sets.filter((s) => s.origin === "curated");

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="font-sans text-[10px] uppercase tracking-[0.22em] text-[color:var(--stone)]">
          now showing
        </span>
        {stoppable && (
          <button
            type="button"
            onClick={onStop}
            aria-label="stop playback"
            className="focus-ring ml-auto font-sans text-[10px] uppercase tracking-[0.22em] text-[color:var(--stone)] transition-colors hover:text-[color:var(--paper)]"
          >
            ■ stop
          </button>
        )}
      </div>

      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="switch source"
            className="focus-ring flex w-full items-center justify-between gap-2 rounded-sm border border-[color:var(--hairline)]/30 px-2 py-1.5 font-sans text-[11px] uppercase tracking-[0.18em] text-[color:var(--paper)]/90 transition-colors hover:border-[color:var(--paper)]/60"
          >
            <span className="truncate">{label}</span>
            <ChevronDown
              className="size-3 shrink-0 text-[color:var(--stone)]"
              strokeWidth={1.5}
            />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          side="bottom"
          className="w-64 rounded-sm border-[color:var(--hairline)]/40 bg-[color:var(--ink)]/95 p-0 text-[color:var(--paper)] backdrop-blur-md"
        >
          <div className={GROUP_HEADER}>decks</div>
          <div className="flex flex-wrap gap-1.5 px-3 pb-2">
            {visibleDecks.map((d) => (
              <button
                key={d.key}
                type="button"
                onClick={() => onPickDeck(d.key)}
                className={cn(
                  "focus-ring font-sans rounded-sm border border-[color:var(--hairline)]/30 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.14em] text-[color:var(--stone)] transition-colors",
                  "hover:border-[color:var(--paper)]/60 hover:text-[color:var(--paper)]",
                  source.kind === "deck" &&
                    source.deck === d.key &&
                    "border-[color:var(--paper)] bg-[color:var(--paper)] text-[color:var(--ink)]"
                )}
              >
                {d.label}
              </button>
            ))}
          </div>

          {isSignedIn &&
            showSets &&
            (loading && sets.length === 0 ? (
              <div className="border-t border-[color:var(--hairline)]/30 px-3 py-3 font-sans text-[10px] uppercase tracking-[0.22em] text-[color:var(--stone)]">
                loading…
              </div>
            ) : (
              <>
                {recordings.length > 0 && (
                  <div className="border-t border-[color:var(--hairline)]/30 pb-1">
                    <div className={GROUP_HEADER}>recordings</div>
                    <div className="max-h-[160px] overflow-y-auto">
                      <SetRows
                        active={source.kind === "set" ? source.setId : null}
                        onPick={(s) => void onPickSet(s)}
                        sets={recordings}
                      />
                    </div>
                  </div>
                )}
                {cuts.length > 0 && (
                  <div className="border-t border-[color:var(--hairline)]/30 pb-1">
                    <div className={GROUP_HEADER}>my sets</div>
                    <div className="max-h-[160px] overflow-y-auto">
                      <SetRows
                        active={source.kind === "set" ? source.setId : null}
                        onPick={(s) => void onPickSet(s)}
                        sets={cuts}
                      />
                    </div>
                  </div>
                )}
              </>
            ))}
        </PopoverContent>
      </Popover>
    </div>
  );
};
