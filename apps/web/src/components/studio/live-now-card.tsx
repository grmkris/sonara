"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { rpcClient } from "@/lib/orpc";

// One-line awareness strip at the top of the studio rail: while one of YOUR
// sessions is live, link straight to its console (via /control, the resolver
// that picks the newest show). Renders nothing when idle — studio stays calm.

const POLL_MS = 5000;

export const LiveNowCard = () => {
  const [live, setLive] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async (): Promise<void> => {
      try {
        const { sessions } = await rpcClient.control.liveSessions();
        if (!cancelled) {
          setLive(sessions.length > 0);
        }
      } catch {
        // transient / auth hiccup — keep the last state, retry next tick.
      } finally {
        if (!cancelled) {
          timer = setTimeout(poll, POLL_MS);
        }
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, []);

  if (!live) {
    return null;
  }

  return (
    <Link
      href="/control"
      className="focus-ring flex items-center gap-2 border-b border-[color:var(--hairline)]/30 px-4 py-2.5 font-sans text-[10px] uppercase tracking-[0.22em] text-[color:var(--paper)]/85 transition-colors hover:bg-[color:var(--paper)]/5"
    >
      <span
        aria-hidden
        className="breath size-1.5 rounded-full bg-[color:var(--signal)]"
      />
      live now — open your console
    </Link>
  );
};
