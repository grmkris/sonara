"use client";

import { createUserOpStageWriter, readStagePayment, readUsdcStatus } from '@sonara/onchain';
import type { StagePayment, StageWriter } from '@sonara/onchain';
import { useCallback, useEffect, useState } from "react";
import { isAddress } from "viem";
import type { Address } from "viem";

import { publicEnv } from "../../env";
import { getOrCreateBurnerKey } from "./burner";

const BALANCE_POLL_MS = 5000;

export interface StageWriterState {
  writer: StageWriter | null;
  // The smart-account address (msg.sender on-chain) once the account resolves.
  address: string | null;
  error: string | null;
  ready: boolean;
  // What a prompt costs + which USDC token, read off the contract (null until
  // loaded). Taps stay free; only prompt() pulls USDC.
  payment: StagePayment | null;
  // The smart account's USDC balance (6-dec units), polled while mounted.
  balanceUnits: bigint | null;
  // Optimistically reflect a payment before the next poll catches up.
  spendLocally: (units: bigint) => void;
}

// Builds the gasless (Pimlico-sponsored) on-chain writer for the audience page.
// Smart-account derivation is async, so the writer lands a beat after mount.
export const useStageWriter = (): StageWriterState => {
  const [state, setState] = useState<
    Pick<StageWriterState, "writer" | "address" | "error" | "ready">
  >({
    address: null,
    error: null,
    ready: false,
    writer: null,
  });
  const [payment, setPayment] = useState<StagePayment | null>(null);
  const [balanceUnits, setBalanceUnits] = useState<bigint | null>(null);

  const contract = publicEnv.NEXT_PUBLIC_SONARA_STAGE_CONTRACT;

  useEffect(() => {
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
          pimlicoApiKey: publicEnv.NEXT_PUBLIC_PIMLICO_API_KEY || undefined,
          sponsorshipPolicyId:
            publicEnv.NEXT_PUBLIC_PIMLICO_SPONSORSHIP_POLICY_ID || undefined,
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
  }, [contract]);

  // Load the payment config once, then poll the USDC balance so the page can
  // gate the prompt button and drive the funding panel.
  useEffect(() => {
    const owner = state.address;
    if (!(contract && isAddress(contract) && owner)) {
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async (): Promise<void> => {
      try {
        let info = payment;
        if (!info) {
          info = await readStagePayment({ contract });
          if (cancelled) {
            return;
          }
          setPayment(info);
        }
        const { balanceUnits: balance } = await readUsdcStatus({
          owner: owner as Address,
          spender: contract,
          usdc: info.usdc,
        });
        if (!cancelled) {
          setBalanceUnits(balance);
        }
      } catch {
        // transient RPC hiccup — keep the last known balance, retry next tick.
      } finally {
        if (!cancelled) {
          timer = setTimeout(poll, BALANCE_POLL_MS);
        }
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
    // payment is read via closure on the first tick and cached in state; we
    // intentionally don't restart the loop when it lands.
    // oxlint-disable-next-line exhaustive-deps
  }, [contract, state.address]);

  const spendLocally = useCallback((units: bigint) => {
    setBalanceUnits((b) => {
      if (b === null) {
        return b;
      }
      const next = b - units;
      return next > 0n ? next : 0n;
    });
  }, []);

  return { ...state, balanceUnits, payment, spendLocally };
};
