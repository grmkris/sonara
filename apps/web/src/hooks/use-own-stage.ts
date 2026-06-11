"use client";

import { useEffect, useState } from "react";

import { rpcClient } from "@/lib/orpc";

export interface OwnStage {
  code: string;
  name: string;
  stageId: string;
}

// Which of MY stages this screen is performing on: the one matching `code`,
// or the default stage when code is null (bare /play). Stage identity is
// immutable (codes are permanent), so one fetch on mount suffices; null for
// anon visitors and until the fetch lands.
export const useOwnStage = (
  code: string | null,
  enabled: boolean
): OwnStage | null => {
  const [stage, setStage] = useState<OwnStage | null>(null);

  useEffect(() => {
    if (!enabled) {
      setStage(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const { stages } = await rpcClient.control.stages();
        const mine = code
          ? stages.find((s) => s.code === code.toUpperCase())
          : stages.find((s) => s.isDefault);
        if (!cancelled && mine) {
          setStage({ code: mine.code, name: mine.name, stageId: mine.stageId });
        }
      } catch {
        // anon / transient — the affordances depending on this stay hidden
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, enabled]);

  return stage;
};
