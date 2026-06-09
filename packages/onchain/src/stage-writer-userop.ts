import { createPublicClient, http } from 'viem';
import type { Address, Hex } from 'viem';
import { entryPoint07Address } from "viem/account-abstraction";
import { privateKeyToAccount } from "viem/accounts";
import { createSmartAccountClient } from "permissionless";
import { toSafeSmartAccount } from "permissionless/accounts";
import { createPimlicoClient } from "permissionless/clients/pimlico";

import { monadTestnet, pimlicoUrl } from "./chain";
import { knobIndex, roomToBytes32, sonaraStageAbi, toFixedPoint } from './stage';
import type { StageKnob } from './stage';
import type { StageWriter } from "./stage-writer";

const deltaToFixed = (delta01: number): number =>
  Math.round(Math.max(-1, Math.min(1, delta01)) * 1000);

// Gasless backend: the burner is the *owner* of a Safe smart account; Pimlico
// bundles + sponsors the UserOp so the user pays zero gas, sees no popup, and
// needs no MON. This is the audience-phone path. NOTE: msg.sender inside the
// contract is the SMART ACCOUNT address (stable per burner — fine for the queue
// label / leaderboard), not the raw EOA.
//
// Pimlico's public endpoint does NOT sponsor for free: you need a (free) API
// key AND a gas sponsorship policy created in the Pimlico dashboard, whose id is
// passed as `sponsorshipPolicyId`. Without it the bundler returns "Sponsorship
// policy ID is required for this API key".
export const createUserOpStageWriter = async (opts: {
  ownerKey: Hex;
  contract: Address;
  pimlicoApiKey?: string;
  sponsorshipPolicyId?: string;
  rpcUrl?: string;
}): Promise<StageWriter> => {
  const owner = privateKeyToAccount(opts.ownerKey);
  const transport = http(opts.rpcUrl ?? monadTestnet.rpcUrls.default.http[0]);
  const publicClient = createPublicClient({ chain: monadTestnet, transport });

  const entryPoint = { address: entryPoint07Address, version: "0.7" } as const;
  const pimlico = createPimlicoClient({
    entryPoint,
    transport: http(pimlicoUrl(opts.pimlicoApiKey)),
  });

  const account = await toSafeSmartAccount({
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

  return {
    address: account.address,
    nudge: (room, knob: StageKnob, delta01) =>
      smart.writeContract({
        abi: sonaraStageAbi,
        address: opts.contract,
        args: [roomToBytes32(room), knobIndex(knob), deltaToFixed(delta01)],
        functionName: "nudge",
      }) as Promise<Hex>,
    prompt: (room, text, tipWei = 0n) =>
      smart.writeContract({
        abi: sonaraStageAbi,
        address: opts.contract,
        args: [roomToBytes32(room), text],
        functionName: "prompt",
        value: tipWei,
      }) as Promise<Hex>,
    set: (room, knob: StageKnob, value01) =>
      smart.writeContract({
        abi: sonaraStageAbi,
        address: opts.contract,
        args: [roomToBytes32(room), knobIndex(knob), toFixedPoint(value01)],
        functionName: "set",
      }) as Promise<Hex>,
  };
};
