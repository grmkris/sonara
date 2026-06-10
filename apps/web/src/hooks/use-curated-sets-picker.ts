"use client";

import type { FrameSetSummary } from "@sonara/shared";
import { useCallback, useState } from "react";
import { toast } from "sonner";

import { rpcClient } from "@/lib/orpc";

// Shared "pick a curated set" state for the inspector's add-to-set popover
// and the multi-select selection bar: lazy fetch of the user's curated sets
// plus inline create. Callers decide when to refresh (popover open / bar
// mount) so the list is always fresh at the moment of choice.
export const useCuratedSetsPicker = () => {
  const [sets, setSets] = useState<FrameSetSummary[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { sets: s } = await rpcClient.sets.list({ origin: "curated" });
      setSets(s);
    } catch {
      toast.error("couldn't load sets");
    } finally {
      setLoading(false);
    }
  }, []);

  // Throws on failure — callers own the error toast (their copy differs).
  const createSet = useCallback(
    async (name: string): Promise<FrameSetSummary> => {
      const { set } = await rpcClient.sets.create({ name });
      setSets((prev) => [set, ...prev]);
      return set;
    },
    []
  );

  return { createSet, loading, refresh, sets };
};
