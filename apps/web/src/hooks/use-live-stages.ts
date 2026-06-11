"use client";

import { useEffect, useState } from "react";
import type { AppRouterClient } from "server/rpc";

import { rpcClient } from "@/lib/orpc";

export type LiveStage = Awaited<
  ReturnType<AppRouterClient["control"]["stages"]>
>["stages"][number];

const POLL_MS = 5000;

// The caller's currently-live stages (screen attached somewhere), polled
// gently. Shared by studio's LiveNowCard and the "activate on <stage>"
// affordance — both follow the same 0/1/N rule as /control.
export const useLiveStages = (enabled = true): LiveStage[] => {
  const [stages, setStages] = useState<LiveStage[]>([]);

  useEffect(() => {
    if (!enabled) {
      setStages([]);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async (): Promise<void> => {
      try {
        const { stages: next } = await rpcClient.control.stages();
        if (!cancelled) {
          setStages(next.filter((s) => s.live));
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
  }, [enabled]);

  return stages;
};
