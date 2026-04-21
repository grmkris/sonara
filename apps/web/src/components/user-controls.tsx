"use client";

import { useEffect, useState } from "react";
import { useAppKit } from "@reown/appkit/react";
import { useAccount } from "wagmi";
import { WalletIcon, LogOutIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { signOut, useSession } from "@/lib/auth-client";
import { fetchReownIdentity } from "@/lib/reown-identity";

function shortAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function UserControls() {
  const { data: sessionData } = useSession();
  const isSignedIn = !!sessionData?.session;
  const { address } = useAccount();
  const { open } = useAppKit();
  const [identity, setIdentity] = useState<string | null>(null);

  // Resolve ENS / Reown profile name for the active wallet. Post-mount only;
  // falls back to short address on any failure.
  useEffect(() => {
    if (!address) {
      setIdentity(null);
      return;
    }
    let cancelled = false;
    void fetchReownIdentity(address).then((id) => {
      if (!cancelled) setIdentity(id.name);
    });
    return () => {
      cancelled = true;
    };
  }, [address]);

  if (!isSignedIn) {
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => open()}
        aria-label="connect wallet"
        className="pointer-events-auto"
      >
        <WalletIcon size={12} />
        connect
      </Button>
    );
  }

  const label = identity ?? (address ? shortAddress(address) : "signed in");

  return (
    <div className="pointer-events-auto flex items-center gap-2">
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--paper)]/80">
        {label}
      </span>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => {
          void signOut();
        }}
        aria-label="sign out"
        title="sign out"
      >
        <LogOutIcon size={12} />
      </Button>
    </div>
  );
}
