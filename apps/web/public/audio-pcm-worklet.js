// AudioWorkletProcessor: downsamples mono Float32 input from the device's
// native sample rate (usually 44.1k or 48k) to 16 kHz Int16 PCM, then posts
// fixed-size buffers (~100ms = 1600 samples) back to the main thread.
//
// Why a worklet rather than ScriptProcessorNode: deprecated SPN runs on the
// main thread and glitches under load. Worklets run on the audio render
// thread; constant cost regardless of UI activity.
//
// Loaded by use-audio-capture.ts via audioContext.audioWorklet.addModule.
// Path: /audio-pcm-worklet.js (served as a static asset by Next).

const TARGET_RATE = 16000;
const FRAME_SIZE = 1600; // samples at 16 kHz = 100ms

class PcmDownsampler extends AudioWorkletProcessor {
  constructor() {
    super();
    this._inputRate = sampleRate; // global from AudioWorkletGlobalScope
    this._ratio = this._inputRate / TARGET_RATE;
    this._frame = new Int16Array(FRAME_SIZE);
    this._frameCursor = 0;
    // Fractional source-index carry across process() calls so cumulative
    // resampling stays phase-coherent across blocks.
    this._srcIdx = 0;
  }

  // process is called every render quantum (typically 128 samples). We pull
  // the first input channel, decimate by `ratio`, convert to Int16, and
  // accumulate into the outbound frame. When a frame fills, post it.
  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const ch = input[0];
    if (!ch || ch.length === 0) return true;

    let srcIdx = this._srcIdx;
    while (srcIdx < ch.length) {
      const i = Math.floor(srcIdx);
      // Linear interpolation between adjacent input samples; cheap and good
      // enough for 16 kHz speech.
      const frac = srcIdx - i;
      const a = ch[i] || 0;
      const b = ch[i + 1] !== undefined ? ch[i + 1] : a;
      const sample = a + (b - a) * frac;
      // Clamp to [-1, 1] then quantise to Int16. Math.fround keeps JIT happy.
      const clamped = sample < -1 ? -1 : sample > 1 ? 1 : sample;
      this._frame[this._frameCursor++] = (clamped * 0x7fff) | 0;
      if (this._frameCursor >= FRAME_SIZE) {
        // Post a copy so the caller can transfer ownership without us losing
        // the underlying buffer for the next frame.
        const out = this._frame.slice();
        this.port.postMessage(out.buffer, [out.buffer]);
        this._frameCursor = 0;
      }
      srcIdx += this._ratio;
    }
    // Carry the remaining fractional offset into the next quantum.
    this._srcIdx = srcIdx - ch.length;
    return true;
  }
}

registerProcessor("pcm-downsampler", PcmDownsampler);
