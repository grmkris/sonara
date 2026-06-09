import { createPublicClient, createWalletClient, http, maxUint256, parseGwei } from 'viem';
import type { Account, Address, Hex } from 'viem';
import { privateKeyToAccount } from "viem/accounts";

import {
  monadTestnet,
  TESTNET_MAX_FEE_GWEI,
  TESTNET_PRIORITY_FEE_GWEI,
} from "./chain";
import { knobIndex, roomToBytes32, sonaraStageAbi, toFixedPoint, usdcAbi } from './stage';
import type { StageKnob } from './stage';
import { readStagePayment, readUsdcStatus } from "./stage-payment";

// One write surface, two backends (see stage-writer-userop for the gasless
// browser path). Callers — the MCP agent, the drip fallback, the smoke test —
// don't care which signs; they just nudge/set/prompt a room.
export interface StageWriter {
  // The on-chain sender these txs originate from (EOA or smart account).
  readonly address: Address;
  // delta01 is a signed step in [-1, 1] (e.g. +0.12 for a "weirder" tap).
  nudge: (room: string, knob: StageKnob, delta01: number) => Promise<Hex>;
  // value01 is an absolute level in [0, 1] (e.g. an intensity slider).
  set: (room: string, knob: StageKnob, value01: number) => Promise<Hex>;
  // Prompts cost USDC: the contract pulls its base price + tipUnits (6-dec
  // USDC units) from the sender. tipUnits buys queue priority; omit/0 pays
  // just the base price. The writer handles the one-time USDC approve.
  prompt: (room: string, text: string, tipUnits?: bigint) => Promise<Hex>;
}

const deltaToFixed = (delta01: number): number =>
  Math.round(Math.max(-1, Math.min(1, delta01)) * 1000);

// Raw-EOA backend: a private key signs locally with client-side nonce tracking
// and a fixed gas bid, fire-and-forget (never await receipts, never refetch the
// nonce mid-burst — per Monad's high-frequency guidance). The burner must hold
// testnet MON for gas and USDC for prompts. Used by the MCP agent and the
// server-drip fallback.
export const createEoaStageWriter = (opts: {
  privateKey: Hex;
  contract: Address;
  rpcUrl?: string;
}): StageWriter => {
  const account: Account = privateKeyToAccount(opts.privateKey);
  const transport = http(opts.rpcUrl ?? monadTestnet.rpcUrls.default.http[0]);
  const wallet = createWalletClient({ account, chain: monadTestnet, transport });
  const pub = createPublicClient({ chain: monadTestnet, transport });

  // Reserve nonces atomically: the first caller fetches the pending count, then
  // every caller (including concurrent ones) gets a unique nonce via a sync
  // post-init increment. The init promise is shared so a burst can't double-read.
  let next: number | null = null;
  let init: Promise<void> | null = null;
  const reserveNonce = async (): Promise<number> => {
    if (next === null) {
      init ??= (async () => {
        next = await pub.getTransactionCount({
          address: account.address,
          blockTag: "pending",
        });
      })();
      await init;
    }
    // next is set by the resolved init promise.
    const n = next as number;
    next = n + 1;
    return n;
  };

  // Shared per-tx fields: fixed gas bid + a freshly reserved local nonce.
  const txDefaults = async () => ({
    account,
    chain: monadTestnet,
    gas: 120_000n,
    maxFeePerGas: parseGwei(TESTNET_MAX_FEE_GWEI.toString()),
    maxPriorityFeePerGas: parseGwei(TESTNET_PRIORITY_FEE_GWEI.toString()),
    nonce: await reserveNonce(),
  });

  // Before the first prompt, make sure the stage contract can pull our USDC.
  // The approve(max) is sent with its own reserved nonce, fire-and-forget —
  // nonce ordering guarantees it executes before the prompt tx that follows.
  // The shared promise makes a prompt burst approve at most once.
  let usdcReady: Promise<void> | null = null;
  const ensureAllowance = (): Promise<void> => {
    usdcReady ??= (async () => {
      const payment = await readStagePayment({
        contract: opts.contract,
        rpcUrl: opts.rpcUrl,
      });
      const { allowanceUnits } = await readUsdcStatus({
        owner: account.address,
        rpcUrl: opts.rpcUrl,
        spender: opts.contract,
        usdc: payment.usdc,
      });
      // Treat anything above half of max as "approved forever".
      if (allowanceUnits >= maxUint256 / 2n) {
        return;
      }
      await wallet.writeContract({
        ...(await txDefaults()),
        abi: usdcAbi,
        address: payment.usdc,
        args: [opts.contract, maxUint256],
        functionName: "approve",
      });
    })();
    return usdcReady;
  };

  return {
    address: account.address,
    nudge: async (room, knob, delta01) =>
      wallet.writeContract({
        ...(await txDefaults()),
        abi: sonaraStageAbi,
        address: opts.contract,
        args: [roomToBytes32(room), knobIndex(knob), deltaToFixed(delta01)],
        functionName: "nudge",
      }),
    prompt: async (room, text, tipUnits = 0n) => {
      await ensureAllowance();
      return wallet.writeContract({
        ...(await txDefaults()),
        abi: sonaraStageAbi,
        address: opts.contract,
        args: [roomToBytes32(room), text, tipUnits],
        functionName: "prompt",
      });
    },
    set: async (room, knob, value01) =>
      wallet.writeContract({
        ...(await txDefaults()),
        abi: sonaraStageAbi,
        address: opts.contract,
        args: [roomToBytes32(room), knobIndex(knob), toFixedPoint(value01)],
        functionName: "set",
      }),
  };
};
