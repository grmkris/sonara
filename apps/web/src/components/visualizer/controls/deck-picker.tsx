"use client";

import { DECK_LOOK, DECKS } from "@sonara/shared";
import type { DeckKey, SonaraSceneState } from "@sonara/shared";
import { useCallback } from "react";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useSession } from "@/lib/auth-client";
import type { SessionSend } from "@/lib/session-actions";
import { cn } from "@/lib/utils";
import { useVisualizerStore } from "@/stores/visualizer";

interface DeckPickerProps {
  send: SessionSend;
}

// "Start from a look" — the deck picker that replaces the old DEMO toggle.
// Decks are curated, pre-generated starter looks; clicking one starts the
// client-side demo loop (no fal, no credits). Once the user commits a
// prompt the session enters "Live" mode and frames stream from fal +
// persist to the library; clicking another deck flips back to playback.
//
// Internally still uses the demoMode/demoDeck slice + the demo.set WS
// action — a 10-file state rename is a deferred cleanup; the wire shape
// and underlying behaviour are unchanged.
export function DeckPicker({ send }: DeckPickerProps) {
  const { data: sessionData } = useSession();
  const isSignedIn = !!sessionData?.session;
  const demoMode = useVisualizerStore((s) => s.demoMode);
  const demoDeck = useVisualizerStore((s) => s.demoDeck);
  const setDemoMode = useVisualizerStore((s) => s.setDemoMode);
  const setDemoDeck = useVisualizerStore((s) => s.setDemoDeck);
  const setPreset = useVisualizerStore((s) => s.setPreset);
  const clearAnchor = useVisualizerStore((s) => s.clearAnchor);

  // Anonymous sessions are always on a deck (server-pinned demo mode);
  // for them, isLive is always false. Signed-in users go live when they
  // commit a prompt — demoMode flips off, isLive flips on.
  const isLive = isSignedIn && !demoMode;

  const onPickDeck = useCallback(
    (deck: string) => {
      if (!deck) {
        return;
      }
      const next = deck as DeckKey;
      setDemoDeck(next);

      // Apply the deck's look profile as a unit: render preset + default
      // reactivity intensity (cadence is read live from DECK_LOOK by the demo
      // loop). This is what makes Noir actually chill — it swaps the global
      // `rave` strobe for the no-invert `noir` preset and drops intensity, so
      // the whole vibe travels with the deck. Decks without a profile are
      // left as-is.
      const look = DECK_LOOK[next];
      if (look) {
        setPreset(look.preset);
        send({
          patch: { intensity: look.intensity } as Partial<SonaraSceneState>,
          type: "scene.patch",
        });
      }

      if (isLive) {
        // Click-while-live: switch BACK to deck playback. Clear any live
        // anchor + prompt so the server stops generating, then signal
        // demo-on. Mirrors the old `toggle(true)` body.
        clearAnchor();
        send({ type: "image.anchor.clear" });
        send({ patch: { prompt: "" }, type: "scene.patch" });
        setDemoMode(true);
      }
      // For anon + already-on-deck signed-in, just push the deck change.
      send({ deck: next, on: true, type: "demo.set" });
    },
    [isLive, send, setDemoDeck, setDemoMode, setPreset, clearAnchor]
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="font-sans text-[10px] uppercase tracking-[0.22em] text-[color:var(--stone)]">
          start from a look
        </span>
        {isLive && (
          <span
            className={cn(
              "ml-auto font-sans rounded-sm border px-1.5 py-0.5 text-[9px] uppercase tracking-[0.18em]",
              "border-[color:var(--paper)]/60 bg-[color:var(--paper)]/10 text-[color:var(--paper)]"
            )}
            aria-label="live generation active"
          >
            live · generating
          </span>
        )}
      </div>

      <ToggleGroup
        value={demoDeck ? [demoDeck] : []}
        onValueChange={(arr) => {
          // Base UI's ToggleGroup is array-based even in single-select mode
          // (`multiple={false}` is the default). Collapse to single-select by
          // taking the most-recently-toggled value. Empty array = deselect
          // (user clicked the already-active deck) — leave the previous deck
          // active rather than entering a no-deck state.
          const next = arr.at(-1);
          if (next) {
            onPickDeck(next);
          }
        }}
        spacing={6}
        aria-label="starter deck"
        className="flex flex-wrap justify-start gap-1.5"
      >
        {DECKS.map((d) => (
          <ToggleGroupItem
            key={d.key}
            value={d.key}
            aria-label={d.label}
            className={cn(
              "focus-ring font-sans h-auto rounded-sm border border-[color:var(--hairline)]/30 bg-transparent px-1.5 py-0.5 text-[10px] uppercase tracking-[0.14em] text-[color:var(--stone)] shadow-none transition-colors",
              "hover:bg-transparent hover:text-[color:var(--paper)] hover:border-[color:var(--paper)]/60",
              "data-pressed:bg-[color:var(--paper)] data-pressed:text-[color:var(--ink)] data-pressed:border-[color:var(--paper)]"
            )}
          >
            {d.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}
