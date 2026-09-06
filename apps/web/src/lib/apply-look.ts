import { InstrumentConfig } from "@sonara/shared";
import type { LookConfig } from "@sonara/shared";

import { useInstrumentStore } from "@/stores/instrument-store";
import { useVisualizerStore } from "@/stores/visualizer";

export const applySavedLook = (config: LookConfig): void => {
  const instrument = InstrumentConfig.safeParse(config);
  if (instrument.success) {
    useInstrumentStore.getState().setConfig(instrument.data);
    useInstrumentStore.getState().setEnabled(true);
  } else {
    useInstrumentStore.getState().setEnabled(false);
    useVisualizerStore
      .getState()
      .applyLookConfig(config as Record<string, number | number[]>);
  }
};
