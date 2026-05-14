"use client";

import { useCallback } from "react";
import { DECKS, type DeckKey } from "@sonara/shared";
import type { SessionSend } from "@/lib/session-actions";
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
  const demoMode = useVisualizerStore((s) => s.demoMode);
  const demoDeck = useVisualizerStore((s) => s.demoDeck);
  const setDemoMode = useVisualizerStore((s) => s.setDemoMode);
  const setDemoDeck = useVisualizerStore((s) => s.setDemoDeck);

  const toggle = useCallback(
    (next: boolean) => {
      if (!next) {
        setDemoMode(false);
        setDemoDeck(null);
        send({ type: "demo.set", on: false, deck: null });
        return;
      }
      const deck = demoDeck ?? (DECKS[0]?.key as DeckKey);
      setDemoMode(true);
      setDemoDeck(deck);
      send({ type: "demo.set", on: true, deck });
    },
    [demoDeck, send, setDemoMode, setDemoDeck],
  );

  const onPickDeck = useCallback(
    (deck: string) => {
      if (!deck) return;
      const next = deck as DeckKey;
      setDemoDeck(next);
      if (demoMode) send({ type: "demo.set", on: true, deck: next });
    },
    [demoMode, send, setDemoDeck],
  );

  return (
    <div className="flex flex-col gap-3">
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

      {!demoMode && (
        <span className="font-serif text-[11px] italic text-[color:var(--stone)]/85">
          turn demo on to pick a deck
        </span>
      )}

      <ToggleGroup
        type="single"
        value={demoDeck ?? ""}
        onValueChange={onPickDeck}
        spacing={6}
        disabled={!demoMode}
        aria-label="demo deck"
        className={cn(
          "flex flex-wrap justify-start gap-1.5 transition-opacity",
          !demoMode && "opacity-40",
        )}
      >
        {DECKS.map((d) => (
          <ToggleGroupItem
            key={d.key}
            value={d.key}
            disabled={!demoMode}
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
