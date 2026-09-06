// Original Sonara composition and synthesis. No external samples or recordings.
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";

const rate = 24_000;
const seconds = 48;
const samples = new Float32Array(rate * seconds);
const chords = [
  [220, 261.63, 329.63],
  [174.61, 220, 261.63],
  [261.63, 329.63, 392],
  [196, 246.94, 293.66],
];
let noise = 7331;
for (let i = 0; i < samples.length; i += 1) {
  const t = i / rate;
  const beat = t / 0.6;
  const chord = chords[Math.floor(beat / 8) % chords.length] ?? [
    220, 261.63, 329.63,
  ];
  const fade = Math.min(1, t / 2, (seconds - t) / 4);
  const beatPhase = t % 0.6;
  const section = Math.floor(beat / 16);
  const drums = section === 1 || section === 2 || section === 3;
  let value = 0;
  for (const [j, f] of chord.entries()) {
    value +=
      Math.sin(2 * Math.PI * f * t + Math.sin(t * 0.2 + j) * 0.35) *
      0.035 *
      (0.6 + Math.sin(t * 0.35 + j) * 0.2);
  }
  const note = chord[Math.floor(beat * 2) % 3] ?? 220;
  const pluck = t % 0.3;
  value +=
    (Math.sin(2 * Math.PI * note * 2 * t) +
      Math.sin(2 * Math.PI * note * 4 * t) * 0.16) *
    Math.exp(-pluck * 12) *
    0.085;
  value +=
    Math.sin(((2 * Math.PI * (chord[0] ?? 220)) / 4) * t) *
    Math.exp(-beatPhase * 5) *
    0.12;
  if (drums) {
    value +=
      Math.sin(
        2 * Math.PI * (47 * beatPhase + 7 * (1 - Math.exp(-beatPhase * 28)))
      ) *
      Math.exp(-beatPhase * 18) *
      0.48;
    noise = (noise * 16_807) % 2_147_483_647;
    const random = (noise / 2_147_483_647) * 2 - 1;
    value += random * Math.exp(-(t % 0.3) * 120) * 0.065;
    if (Math.floor(beat) % 2 === 1) {
      value += random * Math.exp(-beatPhase * 35) * 0.14;
    }
  }
  samples[i] = value * fade * (section === 4 ? 0.65 : 1);
}
for (let i = samples.length - 1; i >= 0; i -= 1) {
  samples[i] =
    (samples[i] ?? 0) +
    (samples[i - 7200] ?? 0) * 0.3 +
    (samples[i - 14_400] ?? 0) * 0.18;
}
const wav = Buffer.alloc(44 + samples.length * 2);
wav.write("RIFF");
wav.writeUInt32LE(wav.length - 8, 4);
wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(rate, 24);
wav.writeUInt32LE(rate * 2, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write("data", 36);
wav.writeUInt32LE(samples.length * 2, 40);
for (let i = 0; i < samples.length; i += 1) {
  wav.writeInt16LE(
    Math.round(Math.tanh((samples[i] ?? 0) * 1.4) * 29_000),
    44 + i * 2
  );
}
const hash = createHash("sha256").update(wav).digest("hex").slice(0, 10);
const path = `apps/web/public/audio/first-light.${hash}.wav`;
writeFileSync(path, wav);
console.log(path);
