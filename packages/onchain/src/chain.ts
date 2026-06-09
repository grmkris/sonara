import { defineChain } from "viem";

// Monad testnet. Chain id 10143, 400ms blocks, ~800ms finality. Gas is a fixed
// 50 gwei base + 2 gwei priority on testnet — we hardcode 52 gwei rather than
// fetching it (see stage-writer), matching Monad's high-frequency guidance.
export const MONAD_TESTNET_ID = 10_143 as const;

export const monadTestnet = defineChain({
  blockExplorers: {
    default: { name: "MonadScan", url: "https://testnet.monadscan.com" },
  },
  id: MONAD_TESTNET_ID,
  name: "Monad Testnet",
  nativeCurrency: { decimals: 18, name: "MON", symbol: "MON" },
  rpcUrls: {
    default: {
      http: ["https://testnet-rpc.monad.xyz"],
      webSocket: ["wss://testnet-rpc.monad.xyz"],
    },
  },
  testnet: true,
});

// Pimlico bundler + paymaster for Monad testnet. The public endpoint sponsors
// testnet UserOps for free with no API key; pass a key to lift the public
// rate limit (recommended before a live demo). One URL serves both the bundler
// and paymaster RPC methods.
export const pimlicoUrl = (apiKey?: string): string =>
  apiKey
    ? `https://api.pimlico.io/v2/${MONAD_TESTNET_ID}/rpc?apikey=${apiKey}`
    : `https://public.pimlico.io/v2/${MONAD_TESTNET_ID}/rpc`;

// Fixed gas bid for testnet (50 gwei base + 2 gwei priority). Used by the EOA
// write path so we never block on eth_estimateGas / eth_gasPrice mid-burst.
export const TESTNET_MAX_FEE_GWEI = 52n;
export const TESTNET_PRIORITY_FEE_GWEI = 2n;
