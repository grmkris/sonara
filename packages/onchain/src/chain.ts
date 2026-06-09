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

// Circle-issued (native, not bridged) USDC. 6 decimals on both networks.
// Sources: developers.circle.com/stablecoins/usdc-contract-addresses.
export const MONAD_TESTNET_USDC =
  "0x534b2f3A21130d7a60830c2Df862319e593943A3" as const;
export const MONAD_MAINNET_USDC =
  "0x754704Bc059F8C67012fEd69BC8A327a5aafb603" as const;
export const USDC_DECIMALS = 6;

// Pimlico bundler + paymaster for Monad testnet. The public endpoint sponsors
// testnet UserOps for free with no API key; pass a key to lift the public
// rate limit (recommended before a live demo). One URL serves both the bundler
// and paymaster RPC methods.
export const pimlicoUrl = (apiKey?: string): string =>
  apiKey
    ? `https://api.pimlico.io/v2/${MONAD_TESTNET_ID}/rpc?apikey=${apiKey}`
    : `https://public.pimlico.io/v2/${MONAD_TESTNET_ID}/rpc`;

// Fixed gas bid for testnet so we never block on eth_estimateGas / eth_gasPrice
// mid-burst. The base fee observed on testnet is ~100 gwei (higher than the
// docs' 50); 200 gives headroom for fluctuation. Testnet gas is ~free.
export const TESTNET_MAX_FEE_GWEI = 200n;
export const TESTNET_PRIORITY_FEE_GWEI = 2n;
