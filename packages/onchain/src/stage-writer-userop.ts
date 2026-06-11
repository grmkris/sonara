import { createPublicClient, encodeFunctionData, http, maxUint256 } from 'viem';
import type { Address, Hex } from 'viem';
import { entryPoint07Address } from "viem/account-abstraction";
import { privateKeyToAccount } from "viem/accounts";
import { createSmartAccountClient } from "permissionless";
import { toSafeSmartAccount } from "permissionless/accounts";
import { createPimlicoClient } from "permissionless/clients/pimlico";

import { monadTestnet, pimlicoUrl } from "./chain";
import { knobIndex, roomToBytes32, sonaraStageAbi, toFixedPoint, usdcAbi } from './stage';
import type { StageKnob } from './stage';
import { readStagePayment, readUsdcStatus } from "./stage-payment";
import type { StageWriter } from "./stage-writer";

const deltaToFixed = (delta01: number): number =>
  Math.round(Math.max(-1, Math.min(1, delta01)) * 1000);

// Gasless backend: the burner is the *owner* of a Safe smart account; Pimlico
// bundles + sponsors the UserOp so the user pays zero gas, sees no popup, and
// needs no MON. This is the audience-phone path. NOTE: msg.sender inside the
// contract is the SMART ACCOUNT address (stable per burner — fine for the queue
// label / leaderboard), not the raw EOA. Prompts cost USDC, which the smart
// account must hold; the first prompt batches the one-time USDC approve into
// the same sponsored UserOp, so paying never needs MON either.
//
// Pimlico's public endpoint does NOT sponsor for free: you need a (free) API
// key AND a gas sponsorship policy created in the Pimlico dashboard, whose id is
// passed as `sponsorshipPolicyId`. Without it the bundler returns "Sponsorship
// policy ID is required for this API key". If the policy restricts callable
// targets, it must allow the USDC token too (for that batched approve).
export const createUserOpStageWriter = async (opts: {
  ownerKey: Hex;
  contract: Address;
  pimlicoApiKey?: string;
  sponsorshipPolicyId?: string;
  rpcUrl?: string;
  // Known smart-account address for this owner (e.g. cached from a previous
  // visit) — passing it skips the on-chain derivation reads entirely.
  address?: Address;
}): Promise<StageWriter> => {
  const owner = privateKeyToAccount(opts.ownerKey);
  // batch: true folds the derivation's concurrent reads into one request —
  // this runs on audience phones sharing one rate-limited RPC budget.
  const transport = http(opts.rpcUrl ?? monadTestnet.rpcUrls.default.http[0], {
    batch: true,
  });
  const publicClient = createPublicClient({ chain: monadTestnet, transport });

  const entryPoint = { address: entryPoint07Address, version: "0.7" } as const;
  const pimlico = createPimlicoClient({
    entryPoint,
    transport: http(pimlicoUrl(opts.pimlicoApiKey)),
  });

  const account = await toSafeSmartAccount({
    address: opts.address,
    client: publicClient,
    entryPoint,
    owners: [owner],
    version: "1.4.1",
  });

  const smart = createSmartAccountClient({
    account,
    bundlerTransport: http(pimlicoUrl(opts.pimlicoApiKey)),
    chain: monadTestnet,
    paymaster: pimlico,
    paymasterContext: opts.sponsorshipPolicyId
      ? { sponsorshipPolicyId: opts.sponsorshipPolicyId }
      : undefined,
    userOperation: {
      // Use Pimlico's gas-price oracle so the UserOp always meets the current
      // network floor (Monad testnet base fee moves; a hardcoded bid underpays).
      estimateFeesPerGas: async () => {
        const prices = await pimlico.getUserOperationGasPrice();
        return prices.fast;
      },
    },
  });

  // Payment config (which USDC token) — immutable on the contract, read once.
  let payment: ReturnType<typeof readStagePayment> | null = null;
  const paymentInfo = () => {
    payment ??= readStagePayment({ contract: opts.contract, rpcUrl: opts.rpcUrl });
    return payment;
  };

  // Whether the stage contract can already pull the smart account's USDC.
  // Checked once (shared promise — a prompt burst reads at most once); after
  // we batch an approve(max) we assume it lands and stop prepending it.
  let allowanceOk: Promise<boolean> | null = null;
  const hasAllowance = (): Promise<boolean> => {
    allowanceOk ??= (async () => {
      const { usdc } = await paymentInfo();
      const { allowanceUnits } = await readUsdcStatus({
        owner: account.address,
        rpcUrl: opts.rpcUrl,
        spender: opts.contract,
        usdc,
      });
      return allowanceUnits >= maxUint256 / 2n;
    })();
    return allowanceOk;
  };

  return {
    address: account.address,
    nudge: (room, knob: StageKnob, delta01) =>
      smart.writeContract({
        abi: sonaraStageAbi,
        address: opts.contract,
        args: [roomToBytes32(room), knobIndex(knob), deltaToFixed(delta01)],
        functionName: "nudge",
      }) as Promise<Hex>,
    prompt: async (room, text, tipUnits = 0n) => {
      const promptCall = {
        data: encodeFunctionData({
          abi: sonaraStageAbi,
          args: [roomToBytes32(room), text, tipUnits],
          functionName: "prompt",
        }),
        to: opts.contract,
      };
      const approved = await hasAllowance();
      const { usdc } = await paymentInfo();
      const calls = approved
        ? [promptCall]
        : [
            {
              data: encodeFunctionData({
                abi: usdcAbi,
                args: [opts.contract, maxUint256],
                functionName: "approve",
              }),
              to: usdc,
            },
            promptCall,
          ];
      const hash = await smart.sendUserOperation({ calls });
      if (!approved) {
        allowanceOk = Promise.resolve(true);
      }
      return hash;
    },
    set: (room, knob: StageKnob, value01) =>
      smart.writeContract({
        abi: sonaraStageAbi,
        address: opts.contract,
        args: [roomToBytes32(room), knobIndex(knob), toFixedPoint(value01)],
        functionName: "set",
      }) as Promise<Hex>,
  };
};
