"use client";

import type { DeckKey } from "@sonara/shared";
import { useEffect } from "react";

import type { SessionSend } from "@/lib/session-actions";
import { useInstrumentStore } from "@/stores/instrument-store";
import { useVisualizerStore } from "@/stores/visualizer";
import type { VisualizerState } from "@/stores/visualizer";

// Companion of use-frame-reporter: reports WHAT is showing (live / set replay
// / idle) up to the server (source.report) so /control and any viewer can
// name the source, not just render its frames. deckKey rides along so the
// server can adopt client-native builtin picks (no setId known) into its
// authoritative source state.
//
// Mount this ONLY on the producer (/play), right next to useFrameReporter.
// The source only changes on transport switches (picking a deck/set, going
// live, stopping), so a plain changed-check is enough — no debounce. Dispatch
// is fire-and-forget; a dropped report self-heals on the next switch.

type ReportedSource = Extract<
  Parameters<SessionSend>[0],
  { type: "source.report" }
>["source"];

export const deriveSource = (s: VisualizerState): ReportedSource => {
  const { source } = s;
  const instrument = useInstrumentStore.getState();
  const hasDream =
    instrument.config.version === 2 ||
    instrument.config.a.world === "dream" ||
    instrument.config.b.world === "dream";
  if (instrument.enabled && !(hasDream && source.kind === "live")) {
    return {
      kind: "procedural",
      label:
        instrument.config.version === 2
          ? instrument.config.treatment
          : `${instrument.config.a.world} / ${instrument.config.b.world}`,
    };
  }
  switch (source.kind) {
    case "set": {
      return {
        deckKey: (source.deckKey as DeckKey | null) ?? undefined,
        kind: "set",
        label: source.name,
        setId: source.setId ?? undefined,
      };
    }
    case "live": {
      return { kind: "live", label: null };
    }
    default: {
      return { kind: "idle", label: null };
    }
  }
};

const sameSource = (a: ReportedSource, b: ReportedSource): boolean =>
  a.kind === b.kind &&
  a.label === b.label &&
  a.setId === b.setId &&
  a.deckKey === b.deckKey;

export const useSourceReporter = (send: SessionSend): void => {
  useEffect(() => {
    let lastReported: ReportedSource | null = null;
    const report = (source: ReportedSource): void => {
      if (lastReported && sameSource(lastReported, source)) {
        return;
      }
      lastReported = source;
      send({ source, type: "source.report" });
    };
    // Catch up on whatever is already showing when the hook mounts.
    report(deriveSource(useVisualizerStore.getState()));
    const unsub = useVisualizerStore.subscribe((s) => {
      report(deriveSource(s));
    });
    const unsubInstrument = useInstrumentStore.subscribe(() => {
      report(deriveSource(useVisualizerStore.getState()));
    });
    return () => {
      unsubInstrument();
      unsub();
    };
  }, [send]);
};
