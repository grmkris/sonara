"use client";

import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { mainnet } from "wagmi/chains";
import { publicEnv } from "@/env";

export const projectId = publicEnv.NEXT_PUBLIC_REOWN_PROJECT_ID;
export const networks = [mainnet] as const;
export const chainIds = networks.map((n) => n.id);

export const wagmiAdapter = new WagmiAdapter({
  projectId,
  networks: [...networks],
});

export const wagmiConfig = wagmiAdapter.wagmiConfig;
