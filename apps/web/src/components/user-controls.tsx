"use client";

import { useEffect, useRef, useState } from "react";
import { useAppKit } from "@reown/appkit/react";
import { useAccount } from "wagmi";
import { WalletIcon, LogOutIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { signOut, useSession } from "@/lib/auth-client";
import { fetchReownIdentity } from "@/lib/reown-identity";
import { UsagePanel } from "@/components/usage-panel";

function shortAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function UserControls() {
  const { data: sessionData } = useSession();
  const isSignedIn = !!sessionData?.session;
  const { address } = useAccount();
  const { open } = useAppKit();
  const [identity, setIdentity] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  // Resolve ENS / Reown profile name for the active wallet.
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

  // Close popover on outside click.
  useEffect(() => {
    if (!panelOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!popoverRef.current) return;
      if (!popoverRef.current.contains(e.target as Node)) setPanelOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [panelOpen]);

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
    <div className="pointer-events-auto relative flex items-center gap-2">
      <button
        type="button"
        onClick={() => setPanelOpen((v) => !v)}
        className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--paper)]/80 transition-colors hover:text-[color:var(--paper)]"
        aria-label="open usage panel"
      >
        {label}
      </button>
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
      {panelOpen ? (
        <div
          ref={popoverRef}
          className="absolute right-0 top-full z-40 mt-3"
        >
          <UsagePanel onClose={() => setPanelOpen(false)} />
        </div>
      ) : null}
    </div>
  );
}
