import { createPublicClient, createWalletClient, http, parseGwei } from 'viem';
import type { Account, Address, Hex } from 'viem';
import { privateKeyToAccount } from "viem/accounts";

import {
  monadTestnet,
  TESTNET_MAX_FEE_GWEI,
  TESTNET_PRIORITY_FEE_GWEI,
} from "./chain";
import { usdcAbi } from "./stage";

// A server-held EOA that pushes USDC around — the transport under the stage
// airdrop faucet (apps/server/onchain/stage-faucet). Same fire-and-forget +
// local-nonce discipline as the stage writer; the key must hold testnet MON
// for gas and the USDC it hands out.
export interface UsdcSender {
  readonly address: Address;
  transfer: (to: Address, units: bigint) => Promise<Hex>;
  balanceUnits: () => Promise<bigint>;
}

export const createUsdcSender = (opts: {
  privateKey: Hex;
  usdc: Address;
  rpcUrl?: string;
}): UsdcSender => {
  const account: Account = privateKeyToAccount(opts.privateKey);
  const transport = http(opts.rpcUrl ?? monadTestnet.rpcUrls.default.http[0]);
  const wallet = createWalletClient({ account, chain: monadTestnet, transport });
  const pub = createPublicClient({ chain: monadTestnet, transport });

  // Same atomic nonce reservation as stage-writer: one shared init read, then
  // sync increments, so concurrent drips never collide.
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
    const n = next as number;
    next = n + 1;
    return n;
  };

  return {
    address: account.address,
    balanceUnits: () =>
      pub.readContract({
        abi: usdcAbi,
        address: opts.usdc,
        args: [account.address],
        functionName: "balanceOf",
      }),
    transfer: async (to, units) =>
      wallet.writeContract({
        abi: usdcAbi,
        account,
        address: opts.usdc,
        args: [to, units],
        chain: monadTestnet,
        functionName: "transfer",
        gas: 120_000n,
        maxFeePerGas: parseGwei(TESTNET_MAX_FEE_GWEI.toString()),
        maxPriorityFeePerGas: parseGwei(TESTNET_PRIORITY_FEE_GWEI.toString()),
        nonce: await reserveNonce(),
      }),
  };
};
