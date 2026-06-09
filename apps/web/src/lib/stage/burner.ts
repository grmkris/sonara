import type { Hex } from "viem";
import { generatePrivateKey } from "viem/accounts";

// A per-device burner key, persisted in localStorage. It owns a Pimlico smart
// account whose gas is sponsored, so this key never needs funding and never
// signs a value transfer — it just authorizes sponsored UserOps. Losing it only
// costs the audience member their leaderboard identity, nothing of value.
const STORAGE_KEY = "sonara.stage.burner";

export const getOrCreateBurnerKey = (): Hex => {
  if (typeof window === "undefined") {
    return generatePrivateKey();
  }
  const existing = window.localStorage.getItem(STORAGE_KEY);
  if (existing && /^0x[0-9a-fA-F]{64}$/u.test(existing)) {
    return existing as Hex;
  }
  const key = generatePrivateKey();
  window.localStorage.setItem(STORAGE_KEY, key);
  return key;
};
