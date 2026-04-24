"use client";

import { type ReactNode } from "react";
import { createAppKit } from "@reown/appkit/react";
import { WagmiProvider } from "wagmi";
import { QueryClientProvider } from "@tanstack/react-query";
import { getQueryClient } from "@/lib/query-client";
import {
  wagmiAdapter,
  wagmiConfig,
  projectId,
  networks,
} from "@/lib/wagmi-config";
import { siweConfig } from "@/lib/siwe-config";

// Always register the AppKit singleton on module load so `useAppKit()` has
// something to read in every consumer. Fall back to a placeholder projectId
// in local dev — the modal will refuse to connect without a real one, but
// the hook call in UserControls no longer throws.
const effectiveProjectId =
  projectId || "0000000000000000000000000000000000";
if (!projectId && typeof window !== "undefined") {
  console.warn(
    "[wallet] NEXT_PUBLIC_REOWN_PROJECT_ID is not set — connect flow will fail until it is",
  );
}
createAppKit({
  adapters: [wagmiAdapter],
  projectId: effectiveProjectId,
  networks: [...networks],
  metadata: {
    name: "Dream Visualizer",
    description: "Realtime AI visuals driven by music",
    url:
      typeof window !== "undefined"
        ? window.location.origin
        : "http://localhost:4470",
    icons: [],
  },
  features: {
    analytics: false,
    socials: ["google", "github", "apple", "discord", "x"],
    email: true,
  },
  siweConfig,
});

export function Web3Provider({ children }: { children: ReactNode }) {
  const queryClient = getQueryClient();
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
