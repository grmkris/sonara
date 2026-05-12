// Top-up pack catalogue. One source of truth for both client (<TopUpButton>
// shows the prices) and server (/api/credits/confirm validates amounts).
//
// Cost model: anchor frame (first frame of session, runs on flux-2-pro/edit)
// costs 2 credits; every subsequent flow keyframe costs 1. So a 320-credit
// starter pack yields ~1 anchor + ~318 flow keyframes per session.

export interface Pack {
  /** Stable id used by both UI and server. Must be url-safe. */
  id: string;
  /** USD amount the user is asked to send. Maps to `amount` in AppKit Pay. */
  usd: number;
  /** Frames credited on success (anchor=2, flow=1). */
  frames: number;
}

export const PACKS: readonly Pack[] = [
  { id: "starter", usd: 10, frames: 320 },
  { id: "pro", usd: 30, frames: 960 },
  { id: "max", usd: 100, frames: 3200 },
] as const;

export function findPack(id: string): Pack | undefined {
  return PACKS.find((p) => p.id === id);
}
