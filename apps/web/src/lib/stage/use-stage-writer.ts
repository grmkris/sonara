"use client";

import { createUserOpStageWriter, readStagePayment, readUsdcStatus } from '@sonara/onchain';
import type { StagePayment, StageWriter } from '@sonara/onchain';
import { useCallback, useEffect, useState } from "react";
import { isAddress } from "viem";
import type { Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { publicEnv } from "../../env";
import { getOrCreateBurnerKey } from "./burner";

const BALANCE_POLL_MS = 15_000;

// Optional dedicated RPC (Alchemy) — per-key rate limits instead of the
// public endpoint's 15 req/s per IP, which one venue wifi exhausts.
const RPC_URL = publicEnv.NEXT_PUBLIC_MONAD_RPC || undefined;

// Init backoff (ms) when the RPC throttles the smart-account derivation —
// without this one rate-limited read left the page dead on "linking…".
const INIT_RETRY_DELAYS = [1000, 2000, 4000, 8000, 12_000];

// Smart-account addresses are deterministic per burner owner (Safe 1.4.1) —
// cache them so repeat visits skip the on-chain derivation reads entirely.
const aaCacheKey = (ownerAddress: string): string =>
  `sonara.stage.aa.v1-safe141.${ownerAddress.toLowerCase()}`;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

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
      // Cached smart-account address (deterministic per burner OWNER) lets
      // the writer skip its derivation reads — repeat visits link instantly.
      const ownerKey = getOrCreateBurnerKey();
      const cacheKey = aaCacheKey(privateKeyToAccount(ownerKey).address);
      const cached = window.localStorage.getItem(cacheKey);
      let lastError: unknown = null;
      for (let attempt = 0; attempt <= INIT_RETRY_DELAYS.length; attempt += 1) {
        try {
          const writer = await createUserOpStageWriter({
            address:
              cached && isAddress(cached) ? (cached as Address) : undefined,
            contract,
            ownerKey,
            pimlicoApiKey: publicEnv.NEXT_PUBLIC_PIMLICO_API_KEY || undefined,
            rpcUrl: RPC_URL,
            sponsorshipPolicyId:
              publicEnv.NEXT_PUBLIC_PIMLICO_SPONSORSHIP_POLICY_ID || undefined,
          });
          window.localStorage.setItem(cacheKey, writer.address);
          if (!cancelled) {
            setState({
              address: writer.address,
              error: null,
              ready: true,
              writer,
            });
          }
          return;
        } catch (error: unknown) {
          // Usually the RPC throttling the derivation burst (15 req/s per IP
          // on the public endpoint) — back off and retry; the UI keeps
          // showing "linking…" until we give up for real.
          lastError = error;
          const delay = INIT_RETRY_DELAYS[attempt];
          if (delay === undefined || cancelled) {
            break;
          }
          await sleep(delay + Math.random() * 500);
          if (cancelled) {
            return;
          }
        }
      }
      if (!cancelled) {
        setState({
          address: null,
          error:
            lastError instanceof Error ? lastError.message : "wallet init failed",
          ready: true,
          writer: null,
        });
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
        // A locked/backgrounded phone shouldn't spend the room's shared RPC
        // budget — skip the tick entirely; spendLocally keeps the UI honest.
        if (document.hidden) {
          return;
        }
        let info = payment;
        if (!info) {
          info = await readStagePayment({ contract, rpcUrl: RPC_URL });
          if (cancelled) {
            return;
          }
          setPayment(info);
        }
        const { balanceUnits: balance } = await readUsdcStatus({
          owner: owner as Address,
          rpcUrl: RPC_URL,
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
