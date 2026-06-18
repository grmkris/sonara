"use client";

import type { LookConfig, LookProfile } from "@sonara/shared";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { rpcClient } from "@/lib/orpc";
import { useVisualizerStore } from "@/stores/visualizer";

export interface LookProfilesApi {
  profiles: LookProfile[];
  activeId: LookProfile["id"] | null;
  save: (name: string) => void;
  apply: (profile: LookProfile) => void;
  remove: (id: LookProfile["id"]) => void;
}

// DB-backed look profiles (looks.router), replacing the old localStorage store.
// Same endpoints used by the screen and the remote console. Degrades to an
// empty list when signed-out (looks.* are per-account, like sets).
export const useLookProfiles = (): LookProfilesApi => {
  const [profiles, setProfiles] = useState<LookProfile[]>([]);
  const [activeId, setActiveId] = useState<LookProfile["id"] | null>(null);
  const applyLookConfig = useVisualizerStore((s) => s.applyLookConfig);

  const refresh = useCallback(() => {
    void (async () => {
      try {
        const { looks } = await rpcClient.looks.list({});
        setProfiles(looks);
      } catch {
        setProfiles([]);
      }
    })();
  }, []);

  useEffect(refresh, [refresh]);

  const save = useCallback(
    (name: string) => {
      const cfg = useVisualizerStore.getState().lastEffective;
      if (!cfg) {
        toast.error("nothing to render yet — play something first");
        return;
      }
      void (async () => {
        try {
          const { look } = await rpcClient.looks.create({
            // PresetConfig is all number / number[] fields — structurally a
            // LookConfig bag, it just lacks an index signature, so assert
            // through unknown.
            config: cfg as unknown as LookConfig,
            name,
          });
          setProfiles((p) => [look, ...p]);
          setActiveId(look.id);
          applyLookConfig(look.config);
          toast(`saved "${look.name}"`);
        } catch {
          toast.error("couldn't save the look");
        }
      })();
    },
    [applyLookConfig]
  );

  const apply = useCallback(
    (profile: LookProfile) => {
      setActiveId(profile.id);
      applyLookConfig(profile.config);
    },
    [applyLookConfig]
  );

  const remove = useCallback((id: LookProfile["id"]) => {
    setProfiles((p) => p.filter((x) => x.id !== id));
    setActiveId((cur) => (cur === id ? null : cur));
    void (async () => {
      try {
        await rpcClient.looks.remove({ lookId: id });
      } catch {
        toast.error("couldn't delete the look");
      }
    })();
  }, []);

  return { activeId, apply, profiles, remove, save };
};
