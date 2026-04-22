import { createPublicClient, http } from "viem";
import { base, mainnet } from "viem/chains";
import { publicEnv } from "@/env";

// Reown's RPC is gas-tuned for deployless ERC-6492 verification via eth_call —
// needed to verify embedded-smart-wallet signatures (Safe v1.4.1) from Reown's
// social/email login flow. Generic RPCs cap eth_call gas too low to simulate
// Safe deployment + isValidSignature in one call. Pattern from the Reown
// Next.js SIWE example.
const projectId = publicEnv.NEXT_PUBLIC_REOWN_PROJECT_ID;

function reownRpc(chainId: number): ReturnType<typeof http> {
  return http(
    `https://rpc.walletconnect.org/v1/?chainId=eip155:${chainId}&projectId=${projectId}`,
    { timeout: 30_000, retryCount: 2 },
  );
}

export const mainnetClient = createPublicClient({
  chain: mainnet,
  transport: reownRpc(mainnet.id),
});

// Used by /api/credits/confirm for USDC receipt verification on Base.
// Same Reown-tuned endpoint, chainId=8453.
export const baseClient = createPublicClient({
  chain: base,
  transport: reownRpc(base.id),
});
