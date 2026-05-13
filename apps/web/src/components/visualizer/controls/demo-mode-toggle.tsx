"use client";

import { useCallback } from "react";
import { DECKS, type DeckKey } from "@music-visualizer/shared";
import type { SessionSend } from "@/lib/session-actions";
import { useVisualizerStore } from "@/stores/visualizer";
import { cn } from "@/lib/utils";

interface DemoModeToggleProps {
  send: SessionSend;
}

// DEMO mode switch + deck picker. When demo mode is on, the server pulls
// pre-generated frames from image_library instead of calling fal. Off by
// default; persisted in localStorage. Deck chips appear only when demo is
// on — they share styling with SceneTemplatePicker by design (one visual
// language for "pick from a curated set").
export function DemoModeToggle({ send }: DemoModeToggleProps) {
  const demoMode = useVisualizerStore((s) => s.demoMode);
  const demoDeck = useVisualizerStore((s) => s.demoDeck);
  const setDemoMode = useVisualizerStore((s) => s.setDemoMode);
  const setDemoDeck = useVisualizerStore((s) => s.setDemoDeck);

  const toggle = useCallback(() => {
    if (demoMode) {
      setDemoMode(false);
      setDemoDeck(null);
      send({ type: "demo.set", on: false, deck: null });
    } else {
      const deck = demoDeck ?? (DECKS[0]?.key as DeckKey);
      setDemoMode(true);
      setDemoDeck(deck);
      send({ type: "demo.set", on: true, deck });
    }
  }, [demoMode, demoDeck, send, setDemoMode, setDemoDeck]);

  const onPickDeck = useCallback(
    (deck: DeckKey) => {
      setDemoDeck(deck);
      if (demoMode) send({ type: "demo.set", on: true, deck });
    },
    [demoMode, send, setDemoDeck],
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline gap-3">
        <button
          type="button"
          onClick={toggle}
          className={cn(
            "font-sans text-[10px] uppercase tracking-[0.22em] transition-colors border-b px-1.5 py-0.5",
            demoMode
              ? "text-[color:var(--paper)] border-[color:var(--paper)]"
              : "text-[color:var(--stone)] border-[color:var(--hairline)]/30 hover:text-[color:var(--paper)] hover:border-[color:var(--paper)]/60",
          )}
        >
          demo {demoMode ? "on" : "off"}
        </button>
        {demoMode && (
          <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-[color:var(--stone)]">
            library — no fal · no credits
          </span>
        )}
      </div>

      {demoMode && (
        <div className="flex flex-wrap gap-1.5">
          {DECKS.map((d) => {
            const active = demoDeck === d.key;
            return (
              <button
                key={d.key}
                type="button"
                onClick={() => onPickDeck(d.key)}
                className={cn(
                  "font-sans text-[10px] uppercase tracking-[0.14em] transition-colors border-b px-1.5 py-0.5",
                  active
                    ? "text-[color:var(--paper)] border-[color:var(--paper)]"
                    : "text-[color:var(--stone)] border-[color:var(--hairline)]/30 hover:text-[color:var(--paper)] hover:border-[color:var(--paper)]/60",
                )}
              >
                {d.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
