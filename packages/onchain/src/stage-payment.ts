import { createPublicClient, http } from 'viem';
import type { Address } from 'viem';

import { monadTestnet } from "./chain";
import { sonaraStageAbi, usdcAbi } from "./stage";

// Read-side helpers for the USDC payment surface: what a prompt costs (the
// deployed contract is the single source of truth — no price constant to
// drift), and whether a payer can afford it. Used by the web stage page and
// the writers' lazy approve checks.

export interface StagePayment {
  // The USDC token the stage charges in.
  usdc: Address;
  // Where prompt payments land.
  treasury: Address;
  // Base price of one prompt, in 6-dec USDC units.
  promptPriceUnits: bigint;
}

// batch: true folds concurrent readContract calls (the Promise.all groups
// below) into ONE JSON-RPC batch request — these helpers run on audience
// phones where the venue shares a single rate-limited RPC budget.
const client = (rpcUrl?: string) =>
  createPublicClient({
    chain: monadTestnet,
    transport: http(rpcUrl ?? monadTestnet.rpcUrls.default.http[0], {
      batch: true,
    }),
  });

export const readStagePayment = async (opts: {
  contract: Address;
  rpcUrl?: string;
}): Promise<StagePayment> => {
  const pub = client(opts.rpcUrl);
  const stage = { abi: sonaraStageAbi, address: opts.contract } as const;
  const [usdc, treasury, promptPriceUnits] = await Promise.all([
    pub.readContract({ ...stage, functionName: "usdc" }),
    pub.readContract({ ...stage, functionName: "treasury" }),
    pub.readContract({ ...stage, functionName: "promptPriceUnits" }),
  ]);
  return { promptPriceUnits, treasury, usdc };
};

export const readUsdcBalance = (opts: {
  usdc: Address;
  owner: Address;
  rpcUrl?: string;
}): Promise<bigint> =>
  client(opts.rpcUrl).readContract({
    abi: usdcAbi,
    address: opts.usdc,
    args: [opts.owner],
    functionName: "balanceOf",
  });

export const readUsdcStatus = async (opts: {
  usdc: Address;
  owner: Address;
  spender: Address;
  rpcUrl?: string;
}): Promise<{ balanceUnits: bigint; allowanceUnits: bigint }> => {
  const pub = client(opts.rpcUrl);
  const token = { abi: usdcAbi, address: opts.usdc } as const;
  const [balanceUnits, allowanceUnits] = await Promise.all([
    pub.readContract({ ...token, args: [opts.owner], functionName: "balanceOf" }),
    pub.readContract({
      ...token,
      args: [opts.owner, opts.spender],
      functionName: "allowance",
    }),
  ]);
  return { allowanceUnits, balanceUnits };
};
