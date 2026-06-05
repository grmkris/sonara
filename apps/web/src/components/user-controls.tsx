"use client";

import { LogInIcon, LogOutIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { UsagePanel } from "@/components/usage-panel";
import { signOut, useSession } from "@/lib/auth-client";

export function UserControls() {
  const { data: sessionData } = useSession();
  const isSignedIn = !!sessionData?.session;
  const [panelOpen, setPanelOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  // Close popover on outside click.
  useEffect(() => {
    if (!panelOpen) {
      return;
    }
    const onDown = (e: MouseEvent) => {
      if (!popoverRef.current) {
        return;
      }
      if (!popoverRef.current.contains(e.target as Node)) {
        setPanelOpen(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [panelOpen]);

  if (!isSignedIn) {
    return (
      <Button
        asChild
        variant="ghost"
        size="sm"
        aria-label="sign in"
        className="pointer-events-auto"
      >
        <Link href="/login">
          <LogInIcon size={12} />
          sign in
        </Link>
      </Button>
    );
  }

  const label = sessionData?.user?.email ?? "signed in";

  return (
    <div className="pointer-events-auto relative flex items-center gap-2">
      <button
        type="button"
        onClick={() => setPanelOpen((v) => !v)}
        className="focus-ring hidden font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--paper)]/80 transition-colors hover:text-[color:var(--paper)] sm:inline"
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
        <div ref={popoverRef} className="absolute right-0 top-full z-40 mt-3">
          <UsagePanel onClose={() => setPanelOpen(false)} />
        </div>
      ) : null}
    </div>
  );
}
