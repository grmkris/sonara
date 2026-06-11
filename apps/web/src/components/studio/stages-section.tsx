"use client";

import { useCallback, useEffect, useState } from "react";
import type { AppRouterClient } from "server/rpc";

import { StageManager } from "@/components/control/stage-manager";
import { rpcClient } from "@/lib/orpc";

// The stages manager's home: stages are account objects like sets, so they
// live in the library. One fetch on mount + refresh after mutations — no
// polling (liveness dots refresh on revisit; LiveNowCard carries the live
// awareness up top).

type StageEntry = Awaited<
  ReturnType<AppRouterClient["control"]["stages"]>
>["stages"][number];

export const StagesSection = () => {
  const [stages, setStages] = useState<StageEntry[]>([]);
  const [nonce, setNonce] = useState(0);
  const onChanged = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { stages: next } = await rpcClient.control.stages();
        if (!cancelled) {
          setStages(next);
        }
      } catch {
        // anon / transient — section stays empty
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  if (stages.length === 0) {
    return null;
  }

  return (
    <div className="border-t border-[color:var(--hairline)]/30 px-4 py-4">
      <StageManager stages={stages} onChanged={onChanged} />
    </div>
  );
};
