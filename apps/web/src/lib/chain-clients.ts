import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";

// Reown's RPC is gas-tuned for deployless ERC-6492 verification via eth_call —
// needed to verify embedded-smart-wallet signatures (Safe v1.4.1) from Reown's
// social/email login flow. Generic RPCs cap eth_call gas too low to simulate
// Safe deployment + isValidSignature in one call.
//
// Reference: https://github.com/reown-com/appkit-web-examples (next-siwe-next-auth example)
const projectId = process.env.NEXT_PUBLIC_REOWN_PROJECT_ID ?? "";

const transport = http(
  `https://rpc.walletconnect.org/v1/?chainId=eip155:${mainnet.id}&projectId=${projectId}`,
  { timeout: 30_000, retryCount: 2 },
);

export const mainnetClient = createPublicClient({
  chain: mainnet,
  transport,
});
