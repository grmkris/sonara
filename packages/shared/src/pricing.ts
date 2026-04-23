// Top-up pack catalogue. One source of truth for both client (<TopUpButton>
// shows the prices) and server (/api/credits/confirm validates amounts).
//
// Flat ~24% margin across the tier against estimated fal.ai costs
// (~$0.021/flow frame, ~$0.063/commit). Tune `frames` / `commits` counts
// post-launch based on real invoices; keep `usd` values fixed since Reown
// Pay commits to the USD amount shown to the user.

export interface Pack {
  /** Stable id used by both UI and server. Must be url-safe. */
  id: string;
  /** USD amount the user is asked to send. Maps to `amount` in AppKit Pay. */
  usd: number;
  /** Flow-tier frames credited on success. */
  frames: number;
  /** Commit-tier (pro) frames credited on success. */
  commits: number;
}

export const PACKS: readonly Pack[] = [
  { id: "starter", usd: 10, frames: 300, commits: 20 },
  { id: "pro", usd: 30, frames: 900, commits: 60 },
  { id: "max", usd: 100, frames: 3000, commits: 200 },
] as const;

export function findPack(id: string): Pack | undefined {
  return PACKS.find((p) => p.id === id);
}
