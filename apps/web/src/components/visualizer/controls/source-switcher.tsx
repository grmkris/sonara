"use client";

import { DECK_LOOK, DECKS, canSeeUnlistedDecks, isDeckUnlisted } from "@sonara/shared";
import type { DeckKey, FrameSetSummary } from "@sonara/shared";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  applyBuiltinSetLocally,
  startSetReplayById,
} from "@/lib/apply-source";
import { useSession } from "@/lib/auth-client";
import { rpcClient } from "@/lib/orpc";
import type { SessionSend } from "@/lib/session-actions";
import { cn } from "@/lib/utils";
import { useVisualizerStore } from "@/stores/visualizer";

interface SourceSwitcherProps {
  send: SessionSend;
  // "local": this device owns the canvas — picks start the client playback
  // here. "remote": a detached console driving another screen — picks travel
  // as source.set commands the screen applies and confirms.
  mode?: "local" | "remote";
  showSets?: boolean;
}

// The Now-Showing transport: one control naming what the canvas is showing
// (live / a set / idle) with a stop and a picker over every playable source.
// ONE concept — sets — in three groups: built-ins (origin builtin, the old
// decks; manifest-backed, offline-capable), recordings, and my sets. Every
// row is a set row; remote picks all travel the same control.setSource path.

const GROUP_HEADER =
  "px-3 pt-2 pb-1 font-mono text-[9px] uppercase tracking-[0.26em] text-[color:var(--stone)]";

// A pickable row: a fetched summary, or a client-native built-in fallback
// (anon / sets.list unavailable) that has no DB id — deckKey alone plays it
// locally; remote picks need the id, so id-less rows disable there.
interface SourceRow {
  deckKey: string | null;
  detail: string | null;
  id: string | null;
  look: FrameSetSummary["look"];
  name: string;
}

const rowFromSummary = (s: FrameSetSummary): SourceRow => ({
  deckKey: s.deckKey,
  detail: String(s.frameCount),
  id: s.id,
  look: s.look,
  name: s.name,
});

// Built-ins straight from the client-native DECKS registry — zero fetch, so
// anon and offline screens can always switch built-ins. Unlisted
// (show-specific) decks render only for allowlisted operators.
const fallbackBuiltins = (
  sessionData: { user?: { email?: string } } | null
): SourceRow[] => {
  const showUnlisted = canSeeUnlistedDecks(sessionData?.user?.email);
  return DECKS.filter((d) => showUnlisted || !isDeckUnlisted(d.key)).map(
    (d) => ({
      deckKey: d.key,
      detail: null,
      id: null,
      look: DECK_LOOK[d.key] ?? null,
      name: d.label,
    })
  );
};

const SetRows = ({
  activeDeckKey,
  activeSetId,
  disabled,
  onPick,
  rows,
}: {
  activeDeckKey: string | null;
  activeSetId: string | null;
  disabled?: (row: SourceRow) => boolean;
  onPick: (row: SourceRow) => void;
  rows: SourceRow[];
}) => (
  <ul>
    {rows.map((row) => {
      const active =
        (row.id !== null && activeSetId === row.id) ||
        (row.deckKey !== null && activeDeckKey === row.deckKey);
      const off = disabled?.(row) ?? false;
      return (
        <li key={row.id ?? row.deckKey ?? row.name}>
          <button
            type="button"
            disabled={off}
            onClick={() => onPick(row)}
            className={cn(
              "focus-ring flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left transition-colors hover:bg-[color:var(--paper)]/10",
              active && "bg-[color:var(--paper)]/10",
              off && "opacity-40"
            )}
          >
            <span className="truncate font-sans text-[12px] text-[color:var(--paper)]/90">
              {row.name}
            </span>
            {row.detail && (
              <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.16em] text-[color:var(--stone)]">
                {row.detail}
              </span>
            )}
          </button>
        </li>
      );
    })}
  </ul>
);

export const SourceSwitcher = ({
  send,
  mode = "local",
  showSets = mode === "local",
}: SourceSwitcherProps) => {
  const { data: sessionData } = useSession();
  const isSignedIn = !!sessionData?.session;
  const source = useVisualizerStore((s) => s.source);
  const stopToIdle = useVisualizerStore((s) => s.stopToIdle);

  const [open, setOpen] = useState(false);
  const [sets, setSets] = useState<FrameSetSummary[] | null>(null);
  const [loading, setLoading] = useState(false);

  let label = "idle";
  if (source.kind === "set") {
    label = source.name ?? "set";
  } else if (source.kind === "live") {
    label = "live";
  }
  const stoppable = source.kind === "set";

  // ■ stop → idle canvas (holds the last frame). Local: the source reporter
  // tells the server. Remote: the command travels to the screen; the local
  // stop is just the optimistic pill (the snapshot poll confirms).
  const onStop = () => {
    if (mode === "remote") {
      send({ source: { kind: "idle" }, type: "source.set" });
    }
    stopToIdle();
  };

  // The full list loads lazily on every open so a just-finished take shows up
  // without a page reload. Built-ins arrive with real set ids here; on
  // failure (or anon) the DECKS fallback below keeps built-ins pickable.
  const loadSets = async () => {
    setLoading(true);
    try {
      const { sets: rows } = await rpcClient.sets.list({});
      setSets(rows);
    } catch {
      setSets(null);
      if (isSignedIn) {
        toast.error("couldn't load your sets");
      }
    } finally {
      setLoading(false);
    }
  };

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next && isSignedIn) {
      void loadSets();
    }
  };

  const onPick = (row: SourceRow) => {
    setOpen(false);
    if (mode === "remote") {
      // The screen applies it (source.set event) and confirms via
      // source.report — never start a local replay on the console device.
      // SetRows disables id-less fallback rows in remote mode.
      if (row.id) {
        send({
          source: { kind: "set", label: row.name, setId: row.id },
          type: "source.set",
        });
      }
      return;
    }
    if (row.deckKey) {
      // Built-in: manifest-direct, no fetch — the offline path.
      applyBuiltinSetLocally(
        {
          deckKey: row.deckKey as DeckKey,
          look: row.look,
          name: row.name,
          setId: row.id,
        },
        send
      );
      return;
    }
    if (row.id) {
      void startSetReplayById(row.id, send);
    }
  };

  const fetched = sets ?? [];
  const builtinRows =
    sets === null
      ? fallbackBuiltins(sessionData)
      : fetched.filter((s) => s.origin === "builtin").map(rowFromSummary);
  const recordings = fetched
    .filter((s) => s.origin === "recording")
    .map(rowFromSummary);
  const cuts = fetched
    .filter((s) => s.origin === "curated")
    .map(rowFromSummary);

  const activeSetId = source.kind === "set" ? source.setId : null;
  const activeDeckKey = source.kind === "set" ? source.deckKey : null;
  const remoteDisabled =
    mode === "remote" ? (row: SourceRow) => row.id === null : undefined;

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
          <div className="pb-1">
            <div className={GROUP_HEADER}>built-ins</div>
            <div className="max-h-[160px] overflow-y-auto">
              <SetRows
                activeDeckKey={activeDeckKey}
                activeSetId={activeSetId}
                disabled={remoteDisabled}
                onPick={onPick}
                rows={builtinRows}
              />
            </div>
          </div>

          {isSignedIn &&
            showSets &&
            (loading && fetched.length === 0 ? (
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
                        activeDeckKey={activeDeckKey}
                        activeSetId={activeSetId}
                        onPick={onPick}
                        rows={recordings}
                      />
                    </div>
                  </div>
                )}
                {cuts.length > 0 && (
                  <div className="border-t border-[color:var(--hairline)]/30 pb-1">
                    <div className={GROUP_HEADER}>my sets</div>
                    <div className="max-h-[160px] overflow-y-auto">
                      <SetRows
                        activeDeckKey={activeDeckKey}
                        activeSetId={activeSetId}
                        onPick={onPick}
                        rows={cuts}
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
