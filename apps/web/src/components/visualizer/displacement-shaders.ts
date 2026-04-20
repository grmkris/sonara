// Vertex + fragment GLSL for the WebGL2 image-displacement renderer.
// Kept as string constants so the component file stays focused on wiring.

export const VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec2 aPos;
layout(location = 1) in vec2 aUv;
out vec2 vUv;
void main() {
  vUv = aUv;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

// Fragment shader. In order of application:
//  - Displacement (per-pixel UV offset): 3 noise octaves scaled by bass/mids/
//    treble + a 4th slow swell scaled by uWarp (bass+mids composite). Plus
//    per-onset shockwaves (kick/snare/hat/vocal rings).
//  - Kick adds an instantaneous radial push + RGB channel split.
//  - Snare briefly posterizes colours (wood-block flicker).
//  - Vocal adds a travelling vertical sine wobble.
//  - Per-onset ink dabs: each drum hit deposits a soft dark splotch at a
//    semi-deterministic position, fading over ~400ms.
//  - Transition: depth-stratified 3-layer ink bleed between prev/curr. Fg is
//    bold + fast; mg delayed + medium; bg delayed further + slowest. Composed
//    back-to-front so layered coverage reads like real paper.
//  - Bloom: Reinhard-ish soft tonemap + motionEnergy-driven continuous pulse.
//  - Saturation: RMS boosts, snare desaturates toward wood-block.
//  - Palette bias: centroid → hanko-red / indigo tint along huePumpRange.
//  - Vignette: dynamic — opens during loud passages, closes during silence.
export const FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uCurr;
uniform sampler2D uPrev;
uniform float uHasPrev;
uniform float uBleedT;
uniform float uTime;
uniform float uBass;
uniform float uMids;
uniform float uTreble;
uniform float uRms;
uniform float uRmsPeak;
uniform float uKick;
uniform float uSnare;
uniform float uHat;
uniform float uVocal;
uniform float uIntensity;
uniform float uHuePumpNorm;
uniform float uPaletteShift;
uniform vec2 uCurrTexSize;
uniform vec2 uPrevTexSize;
uniform vec2 uViewSize;

// Previously-orphaned signals, now wired:
//  - uWarp: secondary noise octave amplitude (continuous displacement swell).
//  - uMotionEnergy: continuous brightness pulse between onsets.
//  - uVignette: 0..1, HIGH when audio is quiet. Feeds dynamic edge darkening.
uniform float uWarp;
uniform float uMotionEnergy;
uniform float uVignette;

// Seconds since last rising-edge of each impulse type (kick, snare, hat, vocal).
// Used to animate expanding shockwaves AND the per-onset ink-dab decay.
uniform vec4 uImpulseAges;

// Per-onset ink-dab positions. Regenerated on each rising edge of the
// corresponding onset type. Packed as pairs: KS = {kick.x, kick.y, snare.x, snare.y},
// HV = {hat.x, hat.y, vocal.x, vocal.y}.
uniform vec4 uDabPosKS;
uniform vec4 uDabPosHV;

// Depth-stratified ink bleed. Three layers (fg / mg / bg), each with 4 drop
// origins (vec4 × 2 = 8 xy coords) and 4 stagger delays. Regenerated per frame
// load so the reveal never repeats.
uniform vec4 uDropsL1A, uDropsL1B, uDropDelaysL1;
uniform vec4 uDropsL2A, uDropsL2B, uDropDelaysL2;
uniform vec4 uDropsL3A, uDropsL3B, uDropDelaysL3;

float hash21(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

float noise21(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Maps a screen-space UV (0..1) into texture UV so the image fills the
// viewport (object-cover). Crops whichever axis is excess.
vec2 coverUv(vec2 uv, vec2 texSize, vec2 viewSize) {
  float texAspect = texSize.x / max(1.0, texSize.y);
  float viewAspect = viewSize.x / max(1.0, viewSize.y);
  vec2 scale = vec2(1.0);
  vec2 offset = vec2(0.0);
  if (viewAspect > texAspect) {
    scale.y = texAspect / viewAspect;
    offset.y = (1.0 - scale.y) * 0.5;
  } else {
    scale.x = viewAspect / texAspect;
    offset.x = (1.0 - scale.x) * 0.5;
  }
  return offset + uv * scale;
}

// Radial shockwave: a propagating ring emanating from 'center'. Pixels near
// the advancing front get pushed outward proportionally, amplitude decaying
// with age.
vec2 shockwave(vec2 uv, vec2 center, float age, float speed, float width, float amp) {
  if (age > 1.3) return vec2(0.0);
  vec2 toCenter = uv - center;
  float d = length(toCenter);
  float r = age * speed;
  float falloff = exp(-age * 2.4);
  float proximity = exp(-pow((d - r) / max(width, 0.001), 2.0) * 7.0);
  return normalize(toCenter + 1e-5) * proximity * amp * falloff;
}

vec2 computeDisplacement(vec2 uv) {
  float slow = noise21(uv * 2.0  + uTime * 0.10) - 0.5;
  float mid  = noise21(uv * 6.0  + uTime * 0.45) - 0.5;
  float fine = noise21(uv * 24.0 + uTime * 1.8)  - 0.5;
  // Warp-driven 4th octave: slow, large-scale. Continuous between onsets so
  // the image breathes when drums are sparse. Composite of bass+mids in JS.
  float warpN = noise21(uv * 3.5 + uTime * 0.18) - 0.5;

  float gain = 0.55 + uIntensity * 1.1;
  float swellAmp = uBass   * 0.048 * gain;
  float midAmp   = uMids   * 0.018 * gain;
  float fineAmp  = uTreble * 0.011 * gain;
  float warpAmp  = uWarp   * 0.020 * gain;

  vec2 disp = vec2(slow * swellAmp * 1.2, slow * swellAmp * 0.8)
            + vec2(mid  * midAmp,         mid  * midAmp  * 0.7)
            + vec2(fine * fineAmp * 0.6,  fine * fineAmp)
            + vec2(warpN * warpAmp * 1.1, warpN * warpAmp * 0.8);

  // Vocal: travelling vertical sine, stronger on louder sections.
  disp.y += sin(uv.x * 14.0 + uTime * 3.2) * uVocal * 0.012;

  // Kick: instantaneous radial push (scales with the impulse envelope, not age).
  vec2 toCenter = uv - vec2(0.5);
  float d = length(toCenter);
  disp += normalize(toCenter + 1e-5) * uKick * 0.022 * (1.0 - smoothstep(0.0, 0.8, d));

  // Onset shockwaves — one propagating ring per drum type.
  disp += shockwave(uv, vec2(0.5),        uImpulseAges.x, 1.15, 0.14, 0.040);
  disp += shockwave(uv, vec2(0.5),        uImpulseAges.y, 0.85, 0.09, 0.022);
  disp += shockwave(uv, vec2(0.5, 0.22),  uImpulseAges.z, 1.50, 0.05, 0.012);
  disp += shockwave(uv, vec2(0.5, 0.55),  uImpulseAges.w, 0.95, 0.11, 0.020);

  return disp;
}

// Single-layer coverage: max of four noise-edged drop spreads.
float layerCoverage(
  vec2 uv,
  float t,
  vec4 dropsA,
  vec4 dropsB,
  vec4 delays,
  float reachScale,
  float bandWidth
) {
  vec2 da = dropsA.xy;
  vec2 db = dropsA.zw;
  vec2 dc = dropsB.xy;
  vec2 dd = dropsB.zw;
  float edgeNoise = (noise21(uv * 18.0) - 0.5) * 0.08;
  float ta = max(0.0, t - delays.x);
  float tb = max(0.0, t - delays.y);
  float tc = max(0.0, t - delays.z);
  float td = max(0.0, t - delays.w);
  float ra = ta * reachScale * 1.25;
  float rb = tb * reachScale * 0.95;
  float rc = tc * reachScale * 0.85;
  float rd = td * reachScale * 1.00;
  float wa = 1.0 - smoothstep(ra + edgeNoise, ra + bandWidth + edgeNoise, distance(uv, da));
  float wb = 1.0 - smoothstep(rb + edgeNoise, rb + bandWidth + edgeNoise, distance(uv, db));
  float wc = 1.0 - smoothstep(rc + edgeNoise, rc + bandWidth + edgeNoise, distance(uv, dc));
  float wd = 1.0 - smoothstep(rd + edgeNoise, rd + bandWidth + edgeNoise, distance(uv, dd));
  return max(wa, max(wb, max(wc, wd)));
}

// Depth-stratified ink bleed: foreground (bold, fast), midground (delayed,
// medium), background (further-delayed, slow). Composited back-to-front so
// foreground ink "soaks through" the slower layers.
float inkCoverageLayered(vec2 uv, float t) {
  float l1 = layerCoverage(uv, t,                   uDropsL1A, uDropsL1B, uDropDelaysL1, 1.00, 0.20);
  float l2 = layerCoverage(uv, max(0.0, t - 0.15),  uDropsL2A, uDropsL2B, uDropDelaysL2, 0.85, 0.16);
  float l3 = layerCoverage(uv, max(0.0, t - 0.30),  uDropsL3A, uDropsL3B, uDropDelaysL3, 0.65, 0.12);

  // Each deeper layer only contributes where the layer above hasn't already
  // covered, scaled by the layer's own opacity weight.
  float composite = l1;
  composite = composite + (1.0 - composite) * l2 * 0.60;
  composite = composite + (1.0 - composite) * l3 * 0.30;
  return composite;
}

vec3 sampleWithSplit(sampler2D tex, vec2 texSize, vec2 uvScreen, vec2 disp) {
  vec2 uvTex = coverUv(uvScreen, texSize, uViewSize);
  vec2 base = uvTex + disp;

  // Chromatic aberration: stronger during kick, mild during snare.
  float split = uKick * 0.0095 + uSnare * 0.0028;
  vec3 col;
  col.r = texture(tex, clamp(base + vec2(split,       0.0), 0.001, 0.999)).r;
  col.g = texture(tex, clamp(base,                          0.001, 0.999)).g;
  col.b = texture(tex, clamp(base - vec2(split * 0.7, 0.0), 0.001, 0.999)).b;
  return col;
}

// Per-onset ink dab: a soft dark splotch deposited at 'pos' decaying with
// 'age'. Radius and strength are tuned per call site. Uses the same age
// channel as the shockwaves (uImpulseAges) so they share a refractory window.
float dab(vec2 uv, vec2 pos, float age, float radius, float strength) {
  if (age > 0.45) return 0.0;
  float d = distance(uv, pos);
  float falloff = exp(-age * 3.2);
  float proximity = exp(-pow(d / max(radius, 0.001), 2.0) * 6.0);
  return proximity * falloff * strength;
}

void main() {
  vec2 disp = computeDisplacement(vUv);
  vec3 curr = sampleWithSplit(uCurr, uCurrTexSize, vUv, disp);

  vec3 color;
  if (uHasPrev > 0.5 && uBleedT < 0.999) {
    vec3 prev = sampleWithSplit(uPrev, uPrevTexSize, vUv, disp);
    float cov = inkCoverageLayered(vUv, uBleedT);
    color = mix(prev, curr, cov);
  } else {
    color = curr;
  }

  // Per-onset ink dabs — kick deposits the largest/darkest, hat the smallest.
  float dabKick  = dab(vUv, uDabPosKS.xy, uImpulseAges.x, 0.14, 0.30);
  float dabSnare = dab(vUv, uDabPosKS.zw, uImpulseAges.y, 0.09, 0.22);
  float dabHat   = dab(vUv, uDabPosHV.xy, uImpulseAges.z, 0.05, 0.14);
  float dabVocal = dab(vUv, uDabPosHV.zw, uImpulseAges.w, 0.10, 0.18);
  float dabTotal = max(max(dabKick, dabSnare), max(dabHat, dabVocal));
  // Darken softly where dabs fire (sumi-e ink drop on paper).
  color *= 1.0 - dabTotal * 0.42;

  // Snare: brief posterize (5..12 levels).
  if (uSnare > 0.02) {
    float levels = mix(12.0, 5.0, uSnare);
    color = floor(color * levels + 0.5) / levels;
  }

  // Bloom + soft-shoulder tonemap. motionEnergy adds a continuous low-level
  // brightness pulse so the image keeps breathing between discrete onsets.
  float bloom = 0.06 + uRms * 0.80 + uRmsPeak * 0.25 + uMotionEnergy * 0.20;
  color *= (1.0 + bloom * 0.55);
  color = color / (1.0 + color * 0.22);

  // Saturation (snare desaturates toward wood-block).
  float lum = dot(color, vec3(0.299, 0.587, 0.114));
  float sat = clamp(1.0 + uRms * 0.30 - uSnare * 0.55, 0.15, 1.8);
  color = mix(vec3(lum), color, sat);

  // Palette bias toward hanko-red (centroid-low) or indigo (centroid-high).
  float amt = uPaletteShift * uHuePumpNorm;
  vec3 hankoTint  = vec3(0.06, -0.02, -0.02);
  vec3 indigoTint = vec3(-0.02, -0.02, 0.06);
  color += (amt >= 0.0 ? amt : -amt) * (amt >= 0.0 ? indigoTint : hankoTint);

  // Dynamic vignette: strongest at silence, opens at energy. r is pixel
  // distance from center; smoothstep starts darkening at r > 0.35.
  float r = distance(vUv, vec2(0.5));
  float vigAmount = 0.25 + uVignette * 0.40; // 0.25 open .. 0.65 closed
  float vigMask = 1.0 - smoothstep(0.35, 0.95, r) * vigAmount;
  color *= vigMask;

  fragColor = vec4(color, 1.0);
}
`;
