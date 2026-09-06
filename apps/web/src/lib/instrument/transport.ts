export class Transport {
  time = 0;
  frozen = false;
  bpm = 0;
  beat = 0;
  private taps: number[] = [];
  private manualBpm = 0;
  private accumulator = 0;
  private lastTime: number | null = null;
  private multiplier = 1;
  private externalBpm = 0;
  setExternalTempo(bpm: number): void {
    this.externalBpm = Math.max(0, Math.min(300, bpm));
  }
  reset(): void {
    this.time = 0;
    this.beat = 0;
    this.accumulator = 0;
    this.lastTime = null;
  }
  tap(now: number): void {
    this.taps = this.taps.filter((t) => now - t < 4).slice(-7);
    this.taps.push(now);
    if (this.taps.length >= 2) {
      const span = now - (this.taps[0] ?? now);
      if (span > 0) {
        this.manualBpm = Math.max(
          40,
          Math.min(240, (60 * (this.taps.length - 1)) / span)
        );
      }
    }
    this.downbeat();
  }
  automatic(): void {
    this.manualBpm = 0;
    this.multiplier = 1;
  }
  multiply(value: number): void {
    this.multiplier = Math.max(0.5, Math.min(2, this.multiplier * value));
  }
  downbeat(): void {
    this.beat = 0;
  }
  advance(now: number, detectedBpm: number, step: (dt: number) => void): void {
    const elapsed =
      this.lastTime === null
        ? 0
        : Math.max(0, Math.min(0.1, now - this.lastTime));
    this.lastTime = now;
    this.bpm =
      (this.externalBpm || this.manualBpm || detectedBpm) * this.multiplier;
    if (this.frozen) {
      return;
    }
    this.accumulator += elapsed;
    while (this.accumulator + 1e-9 >= 1 / 60) {
      this.time += 1 / 60;
      this.accumulator -= 1 / 60;
      this.beat += this.bpm / (60 * 60);
      step(1 / 60);
    }
  }
}
