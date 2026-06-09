"use client";

import { createUserOpStageWriter } from '@sonara/onchain';
import type { StageWriter } from '@sonara/onchain';
import { useEffect, useState } from "react";
import { isAddress } from "viem";

import { publicEnv } from "../../env";
import { getOrCreateBurnerKey } from "./burner";

export interface StageWriterState {
  writer: StageWriter | null;
  // The smart-account address (msg.sender on-chain) once the account resolves.
  address: string | null;
  error: string | null;
  ready: boolean;
}

// Builds the gasless (Pimlico-sponsored) on-chain writer for the audience page.
// Smart-account derivation is async, so the writer lands a beat after mount.
export const useStageWriter = (): StageWriterState => {
  const [state, setState] = useState<StageWriterState>({
    address: null,
    error: null,
    ready: false,
    writer: null,
  });

  useEffect(() => {
    const contract = publicEnv.NEXT_PUBLIC_SONARA_STAGE_CONTRACT;
    if (!(contract && isAddress(contract))) {
      setState((s) => ({ ...s, error: "stage not configured", ready: true }));
      return;
    }
    let cancelled = false;
    const init = async (): Promise<void> => {
      try {
        const writer = await createUserOpStageWriter({
          contract,
          ownerKey: getOrCreateBurnerKey(),
        });
        if (!cancelled) {
          setState({ address: writer.address, error: null, ready: true, writer });
        }
      } catch (error: unknown) {
        if (!cancelled) {
          setState({
            address: null,
            error: error instanceof Error ? error.message : "wallet init failed",
            ready: true,
            writer: null,
          });
        }
      }
    };
    void init();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
};
