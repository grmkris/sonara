/* Audio thread: copy a mono window at 60 Hz. FFT and musical analysis run in a worker. */
class SonaraCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ring = new Float32Array(2048);
    this.position = 0;
    this.count = 0;
    this.busy = false;
    this.analysis = null;
    this.port.addEventListener("message", ({ data }) => {
      this.analysis = data.port;
      this.analysis.addEventListener("message", () => {
        this.busy = false;
      });
      this.analysis.start();
    });
    this.port.start();
  }
  process(inputs) {
    const [channels] = inputs;
    const length = channels?.[0]?.length ?? 128;
    for (let i = 0; i < length; i += 1) {
      let value = 0;
      for (const channel of channels ?? []) {
        value += channel[i] ?? 0;
      }
      this.ring[this.position] = value / Math.max(1, channels?.length ?? 0);
      this.position = (this.position + 1) % 2048;
      this.count += 1;
      if (this.count >= sampleRate / 60) {
        this.count -= sampleRate / 60;
        if (this.analysis && !this.busy) {
          const samples = new Float32Array(2048);
          for (let j = 0; j < 2048; j += 1) {
            samples[j] = this.ring[(this.position + j) % 2048];
          }
          this.busy = true;
          this.analysis.postMessage(
            { samples, time: (currentFrame + i + 1) / sampleRate },
            [samples.buffer]
          );
        }
      }
    }
    return true;
  }
}
registerProcessor("sonara-capture", SonaraCapture);
