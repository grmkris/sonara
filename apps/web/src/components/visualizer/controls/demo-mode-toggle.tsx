"use client";

import { useCallback } from "react";
import { DECKS, type DeckKey } from "@sonara/shared";
import type { SessionSend } from "@/lib/session-actions";
import { useSession } from "@/lib/auth-client";
import { Switch } from "@/components/ui/switch";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group";
import { DemoBadge } from "@/components/visualizer/controls/demo-badge";
import { useVisualizerStore } from "@/stores/visualizer";
import { cn } from "@/lib/utils";

interface DemoModeToggleProps {
  send: SessionSend;
}

// DEMO mode switch + deck picker. When demo mode is on, the server pulls
// pre-generated frames from image_library instead of calling fal. Off by
// default; persisted in localStorage.
export function DemoModeToggle({ send }: DemoModeToggleProps) {
  const { data: sessionData } = useSession();
  const isSignedIn = !!sessionData?.session;
  const demoMode = useVisualizerStore((s) => s.demoMode);
  const demoDeck = useVisualizerStore((s) => s.demoDeck);
  const setDemoMode = useVisualizerStore((s) => s.setDemoMode);
  const setDemoDeck = useVisualizerStore((s) => s.setDemoDeck);
  const clearAnchor = useVisualizerStore((s) => s.clearAnchor);

  // Anonymous sessions are server-pinned to demo mode: the on/off Switch
  // and the "vs paid" badges don't apply. Deck picker stays usable so the
  // visitor can swap themes. (The server picks a random deck at connect;
  // when the user clicks a chip the client takes over the selection.)
  const demoEffectivelyOn = isSignedIn ? demoMode : true;

  const toggle = useCallback(
    (next: boolean) => {
      if (!next) {
        // Demo off → live. Generation starts when the user types a scene
        // (PromptInput.goLive) or pins an anchor; until then the last frame
        // holds. No prompt to clear here.
        setDemoMode(false);
        setDemoDeck(null);
        send({ type: "demo.set", on: false, deck: null });
        return;
      }
      // Back to deck. Resume the free client demo loop AND clear any live
      // scene + anchor, otherwise the server keeps generating (its periodic
      // fires whenever a prompt is set) and would fight the demo loop.
      const deck = demoDeck ?? (DECKS[0]?.key as DeckKey);
      setDemoMode(true);
      setDemoDeck(deck);
      clearAnchor();
      send({ type: "image.anchor.clear" });
      send({ type: "scene.patch", patch: { prompt: "" } });
      send({ type: "demo.set", on: true, deck });
    },
    [demoDeck, send, setDemoMode, setDemoDeck, clearAnchor],
  );

  const onPickDeck = useCallback(
    (deck: string) => {
      if (!deck) return;
      const next = deck as DeckKey;
      setDemoDeck(next);
      // Anon sessions are pinned to demo mode server-side, so a deck click
      // always pushes `on: true` regardless of the local demoMode flag.
      if (demoEffectivelyOn) {
        send({ type: "demo.set", on: true, deck: next });
      }
    },
    [demoEffectivelyOn, send, setDemoDeck],
  );

  return (
    <div className="flex flex-col gap-3">
      {isSignedIn && (
        <div className="flex items-center gap-3">
          <Switch
            size="sm"
            checked={demoMode}
            onCheckedChange={toggle}
            aria-label="toggle demo mode"
            className={cn(
              "focus-ring data-[state=checked]:bg-[color:var(--paper)] data-[state=unchecked]:bg-[color:var(--hairline)]/30",
              "[&_[data-slot=switch-thumb]]:bg-[color:var(--ink)]",
            )}
          />
          <span
            className={cn(
              "font-sans text-[10px] uppercase tracking-[0.22em] transition-colors",
              demoMode
                ? "text-[color:var(--paper)]"
                : "text-[color:var(--stone)]",
            )}
          >
            demo
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <DemoBadge
              label="no fal"
              tooltip="demo mode skips the fal generation api"
              active={demoMode}
            />
            <DemoBadge
              label="no credits"
              tooltip="demo frames don't debit your credit balance"
              active={demoMode}
            />
          </div>
        </div>
      )}

      {isSignedIn && !demoMode && (
        <span className="font-serif text-[11px] italic text-[color:var(--stone)]/85">
          turn demo on to pick a deck
        </span>
      )}

      {!isSignedIn && (
        <span className="font-serif text-[11px] italic text-[color:var(--stone)]/85">
          demo · pick a deck
        </span>
      )}

      <ToggleGroup
        type="single"
        value={demoDeck ?? ""}
        onValueChange={onPickDeck}
        spacing={6}
        disabled={!demoEffectivelyOn}
        aria-label="demo deck"
        className={cn(
          "flex flex-wrap justify-start gap-1.5 transition-opacity",
          !demoEffectivelyOn && "opacity-40",
        )}
      >
        {DECKS.map((d) => (
          <ToggleGroupItem
            key={d.key}
            value={d.key}
            disabled={!demoEffectivelyOn}
            aria-label={d.label}
            className={cn(
              "focus-ring font-sans h-auto rounded-sm border border-[color:var(--hairline)]/30 bg-transparent px-1.5 py-0.5 text-[10px] uppercase tracking-[0.14em] text-[color:var(--stone)] shadow-none transition-colors",
              "hover:bg-transparent hover:text-[color:var(--paper)] hover:border-[color:var(--paper)]/60",
              "data-[state=on]:bg-[color:var(--paper)] data-[state=on]:text-[color:var(--ink)] data-[state=on]:border-[color:var(--paper)]",
            )}
          >
            {d.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}
