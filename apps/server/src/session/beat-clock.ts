// Beat-synced generation timing. Pure + unit-tested (no session/IO deps).
//
// Decide whether the periodic keyframe should fire *now* so the resulting frame
// reveals on (or just after) the next musical downbeat instead of at a blind
// wall-clock moment — the differentiator the keyframe-tool category lacks.
//
// Guarantees:
//   - The cadence floor is always respected: we never fire faster than
//     periodicMs, so generation volume / credits are unchanged.
//   - With a fresh tempo lock, once the floor passes we hold until we're within
//     ~genLatencyMs of the next downbeat, so the frame lands on the beat.
//   - A failsafe bounds the hold to one beat past the floor (never stalls).
//   - Without a lock (bpm 0) or with a stale phase sample, it falls back to the
//     plain wall-clock gate — identical to the pre-beat-sync behavior.

export interface BeatFireInput {
  now: number;
  lastKeyframeAt: number;
  periodicMs: number;
  // Latest tempo sample from the client (analyzer): bpm (0 = unlocked), the
  // beat-clock phase 0..1, and when that sample was taken (same clock as `now`).
  bpm: number;
  bpmPhase: number;
  bpmPhaseAt: number;
  // Estimated generation latency so the fire leads the beat by this much.
  genLatencyMs: number;
  // How old a phase sample may be before we stop trusting it (default 1.5s).
  phaseStaleMs?: number;
}

export const shouldFireForBeat = (i: BeatFireInput): boolean => {
  // Cadence floor — never fire faster than the configured cadence.
  if (i.now - i.lastKeyframeAt < i.periodicMs) {
    return false;
  }

  const staleMs = i.phaseStaleMs ?? 1500;
  const sampleAge = i.now - i.bpmPhaseAt;
  const locked = i.bpm > 0 && sampleAge >= 0 && sampleAge <= staleMs;
  if (!locked) {
    // No usable tempo → behave exactly like the old wall-clock gate.
    return true;
  }

  const beatPeriodMs = 60_000 / i.bpm;

  // Failsafe: never delay more than one beat past the cadence floor.
  if (i.now - i.lastKeyframeAt >= i.periodicMs + beatPeriodMs) {
    return true;
  }

  // Extrapolate the phase forward from the last sample and find the time to the
  // next downbeat (phase wrapping to 0).
  const advanced = (sampleAge / 1000) * (i.bpm / 60);
  const phaseNow = (((i.bpmPhase + advanced) % 1) + 1) % 1;
  const msToBeat = (1 - phaseNow) * beatPeriodMs;

  // Fire once we're within one generation-latency of the next downbeat. If the
  // latency already exceeds a beat we can't pre-empt further, so fire now.
  return msToBeat <= i.genLatencyMs || i.genLatencyMs >= beatPeriodMs;
};
