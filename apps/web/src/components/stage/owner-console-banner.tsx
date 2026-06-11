"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { rpcClient } from "@/lib/orpc";

// Pairing without typing: when the OWNER scans their own crowd QR (or opens
// the crowd URL), offer the jump to the console. Renders nothing for the
// actual crowd — one resolveStage call decides.
export const OwnerConsoleBanner = ({ code }: { code: string }) => {
  const [isOwner, setIsOwner] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { stage } = await rpcClient.control.resolveStage({ code });
        if (!cancelled && stage?.isOwner) {
          setIsOwner(true);
        }
      } catch {
        // anon / transient — stay hidden
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code]);

  if (!isOwner) {
    return null;
  }

  return (
    <Link
      href={`/stage/${code}/console`}
      className="focus-ring -mx-5 -mt-7 mb-4 flex items-center justify-center gap-2 border-b border-[color:var(--hairline)]/30 bg-[color:var(--paper)]/5 px-5 py-2.5 font-sans text-[10px] uppercase tracking-[0.22em] text-[color:var(--paper)]/85 transition-colors hover:bg-[color:var(--paper)]/10"
    >
      <span
        aria-hidden
        className="breath size-1.5 rounded-full bg-[color:var(--signal)]"
      />
      this is your stage — open the console
    </Link>
  );
};
