import { EMPTY_MUSIC } from "@sonara/shared";
import type { AudioFeatureFrame, MusicalFrame } from "@sonara/shared";

const unit = (value: number) => Math.max(0, Math.min(1, value));
const follow = (from: number, to: number, dt: number, seconds: number) =>
  from + (to - from) * (1 - Math.exp(-dt / seconds));

// Consumes every audio window. Display refresh never decides which onsets exist.
export class MusicalDirector {
  private previousTime = 0;
  private fast = 0;
  private slow = 0;
  private peak = 0.08;
  private tensionPeak = 0;
  private lastRelease = -20;
  private frame: MusicalFrame = { ...EMPTY_MUSIC };
  reset(): void {
    this.previousTime = 0;
    this.fast = 0;
    this.slow = 0;
    this.peak = 0.08;
    this.tensionPeak = 0;
    this.lastRelease = -20;
    this.frame = { ...EMPTY_MUSIC };
  }
  process(input: AudioFeatureFrame): MusicalFrame {
    const { features: f, time } = input;
    const gap = this.previousTime ? time - this.previousTime : 1 / 60;
    if (gap > 0.5 || gap < 0) {
      this.reset();
    }
    const dt = Math.max(0.001, Math.min(0.1, gap));
    this.previousTime = time;
    this.peak = Math.max(0.08, f.rms, this.peak * Math.exp(-dt / 18));
    const energy = unit(f.rms / this.peak);
    const audible = unit((f.rms - 0.002) * 50);
    this.fast = follow(this.fast, energy, dt, 0.35);
    this.slow = follow(this.slow, energy, dt, 8);
    const rising = unit((this.fast - this.slow - 0.08) * 2.5);
    const tension = follow(
      this.frame.tension,
      rising,
      dt,
      rising > this.frame.tension ? 2.5 : 1.2
    );
    this.tensionPeak = Math.max(tension, this.tensionPeak * Math.exp(-dt / 12));
    let release = this.frame.release * Math.exp(-dt / 3.5);
    if (
      this.tensionPeak > 0.35 &&
      this.fast < this.slow * 0.72 &&
      time - this.lastRelease > 10
    ) {
      release = 1;
      this.lastRelease = time;
      this.tensionPeak = 0;
    }
    const strength = f.onsetType === "kick" ? 1 : 0.6;
    const impulse = f.onset && audible > 0.1 ? strength : 0;
    this.frame = {
      body: follow(
        this.frame.body,
        f.mids * audible,
        dt,
        f.mids > this.frame.body ? 0.09 : 0.4
      ),
      brightness: follow(
        this.frame.brightness,
        f.treble * audible,
        dt,
        f.treble > this.frame.brightness ? 0.025 : 0.12
      ),
      confidence: input.confidence,
      phase: input.confidence > 0.55 ? f.bpmPhase : 0,
      pulse: Math.max(impulse, this.frame.pulse * Math.exp(-dt / 0.22)),
      release,
      space: follow(this.frame.space, 1 - unit(this.fast * 1.15), dt, 1.8),
      tension,
      time,
      weight: follow(
        this.frame.weight,
        f.bass * audible,
        dt,
        f.bass > this.frame.weight ? 0.025 : 0.18
      ),
    };
    return this.frame;
  }
}
