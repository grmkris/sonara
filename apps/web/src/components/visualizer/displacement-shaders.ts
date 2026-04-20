// Vertex + fragment GLSL for the WebGL2 image-displacement renderer.
// Kept as string constants so the component file stays focused on wiring.
//
// Effects Deck: each visual primitive is gated by its own intensity uniform
// so presets can enable/disable pieces without changing the shader. Zero
// values preserve the baseline "wet ink" look; non-zero values opt in.

export const VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec2 aPos;
layout(location = 1) in vec2 aUv;
out vec2 vUv;
void main() {
  vUv = aUv;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

// Blit pass — used for the ping-pong FBO feedback loop to copy the last-drawn
// offscreen target onto the default framebuffer.
export const BLIT_FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uSrc;
void main() { fragColor = texture(uSrc, vUv); }
`;

// Main fragment shader. Pipeline order (UV → texture → colour):
//   1. UV mods (applied before texture sample):
//        kaleidoscope → polar warp → object-cover → displacement noise
//   2. Texture sample (+ RGB channel split on kick/snare)
//   3. Composite with feedback trail (previous frame darkened + blurred)
//   4. Composite with previous-frame via ink bleed (during transitions)
//   5. Per-onset ink dabs (darken)
//   6. Posterize (snare one-shot + always-on layer)
//   7. Bloom (motionEnergy continuous + rms + peaks), Reinhard-ish tonemap
//   8. Saturation (rms boost, snare desat)
//   9. Palette bias (centroid → signal / indigo)
//  10. Duotone mix (luminance → configurable 2-colour gradient)
//  11. Edge detection overlay (Sobel, treble-scalable)
//  12. Invert flash (kick-gated)
//  13. Dynamic vignette
export const FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uCurr;
uniform sampler2D uPrev;
uniform sampler2D uFeedback;
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

uniform float uWarp;
uniform float uMotionEnergy;
uniform float uVignette;

uniform vec4 uImpulseAges;
uniform vec4 uDabPosKS;
uniform vec4 uDabPosHV;

uniform vec4 uDropsL1A, uDropsL1B, uDropDelaysL1;
uniform vec4 uDropsL2A, uDropsL2B, uDropDelaysL2;
uniform vec4 uDropsL3A, uDropsL3B, uDropDelaysL3;

// === Effects Deck uniforms (all default 0 → disabled) ===
// Kaleidoscope: number of mirror segments (0 or 1 = off, 2..12 active).
uniform float uKaleidoSegments;
// Polar warp: swirl/vortex rotation amount in radians per unit radius.
uniform float uPolarWarp;
// Posterize-always: if > 0, sustained colour quantization (levels).
uniform float uPosterizeAlways;
// Duotone mix: 0 = off, 1 = full. Maps luminance to a 2-colour gradient.
uniform float uDuotoneMix;
uniform vec3 uDuotoneLo;
uniform vec3 uDuotoneHi;
// Edge detection strength (Sobel on luminance, paper-coloured overlay).
uniform float uEdge;
// Invert flash mix, gated by kick impulse when > 0.
uniform float uInvert;
// Feedback trail amount: blend of previous-frame texture (sampler uFeedback).
uniform float uFeedbackAmount;
// Bloom multiplier (preset-level gain on top of audio-driven bloom).
uniform float uBloomMult;
// Displacement multiplier (preset-level gain on top of audio-driven noise).
uniform float uNoiseMult;

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

// Kaleidoscope: reflect UV into one angular wedge then tile.
vec2 kaleidoscope(vec2 uv, float segments) {
  if (segments < 1.5) return uv;
  vec2 c = uv - 0.5;
  float r = length(c);
  float a = atan(c.y, c.x);
  float seg = 6.28318530718 / segments;
  a = mod(a, seg);
  if (a > seg * 0.5) a = seg - a;
  return vec2(cos(a), sin(a)) * r + 0.5;
}

// Polar warp: rotate UVs around centre by an amount proportional to radius.
vec2 polarWarp(vec2 uv, float amount) {
  if (abs(amount) < 1e-5) return uv;
  vec2 c = uv - 0.5;
  float r = length(c);
  float a = atan(c.y, c.x) + amount * r;
  return vec2(cos(a), sin(a)) * r + 0.5;
}

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
  float warpN = noise21(uv * 3.5 + uTime * 0.18) - 0.5;

  float gain = (0.55 + uIntensity * 1.1) * max(0.0, uNoiseMult);
  float swellAmp = uBass   * 0.048 * gain;
  float midAmp   = uMids   * 0.018 * gain;
  float fineAmp  = uTreble * 0.011 * gain;
  float warpAmp  = uWarp   * 0.020 * gain;

  vec2 disp = vec2(slow * swellAmp * 1.2, slow * swellAmp * 0.8)
            + vec2(mid  * midAmp,         mid  * midAmp  * 0.7)
            + vec2(fine * fineAmp * 0.6,  fine * fineAmp)
            + vec2(warpN * warpAmp * 1.1, warpN * warpAmp * 0.8);

  disp.y += sin(uv.x * 14.0 + uTime * 3.2) * uVocal * 0.012;

  vec2 toCenter = uv - vec2(0.5);
  float d = length(toCenter);
  disp += normalize(toCenter + 1e-5) * uKick * 0.022 * (1.0 - smoothstep(0.0, 0.8, d));

  disp += shockwave(uv, vec2(0.5),        uImpulseAges.x, 1.15, 0.14, 0.040);
  disp += shockwave(uv, vec2(0.5),        uImpulseAges.y, 0.85, 0.09, 0.022);
  disp += shockwave(uv, vec2(0.5, 0.22),  uImpulseAges.z, 1.50, 0.05, 0.012);
  disp += shockwave(uv, vec2(0.5, 0.55),  uImpulseAges.w, 0.95, 0.11, 0.020);

  return disp;
}

float layerCoverage(
  vec2 uv, float t,
  vec4 dropsA, vec4 dropsB, vec4 delays,
  float reachScale, float bandWidth
) {
  vec2 da = dropsA.xy, db = dropsA.zw;
  vec2 dc = dropsB.xy, dd = dropsB.zw;
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

float inkCoverageLayered(vec2 uv, float t) {
  float l1 = layerCoverage(uv, t,                   uDropsL1A, uDropsL1B, uDropDelaysL1, 1.00, 0.20);
  float l2 = layerCoverage(uv, max(0.0, t - 0.15),  uDropsL2A, uDropsL2B, uDropDelaysL2, 0.85, 0.16);
  float l3 = layerCoverage(uv, max(0.0, t - 0.30),  uDropsL3A, uDropsL3B, uDropDelaysL3, 0.65, 0.12);
  float c = l1;
  c = c + (1.0 - c) * l2 * 0.60;
  c = c + (1.0 - c) * l3 * 0.30;
  return c;
}

vec3 sampleWithSplit(sampler2D tex, vec2 texSize, vec2 uvScreen, vec2 disp) {
  vec2 uvTex = coverUv(uvScreen, texSize, uViewSize);
  vec2 base = uvTex + disp;
  float split = uKick * 0.0095 + uSnare * 0.0028;
  vec3 col;
  col.r = texture(tex, clamp(base + vec2(split,       0.0), 0.001, 0.999)).r;
  col.g = texture(tex, clamp(base,                          0.001, 0.999)).g;
  col.b = texture(tex, clamp(base - vec2(split * 0.7, 0.0), 0.001, 0.999)).b;
  return col;
}

float dab(vec2 uv, vec2 pos, float age, float radius, float strength) {
  if (age > 0.45) return 0.0;
  float d = distance(uv, pos);
  float falloff = exp(-age * 3.2);
  float proximity = exp(-pow(d / max(radius, 0.001), 2.0) * 6.0);
  return proximity * falloff * strength;
}

// Sobel edge magnitude on the current texture's luminance. Uses 8 neighbour
// samples at ~3px spacing.
float sobelLuma(sampler2D tex, vec2 uv, vec2 texSize) {
  vec2 t = 1.0 / max(vec2(1.0), texSize);
  vec3 k = vec3(0.299, 0.587, 0.114);
  float tl = dot(texture(tex, uv + vec2(-t.x, -t.y)).rgb, k);
  float tm = dot(texture(tex, uv + vec2( 0.0, -t.y)).rgb, k);
  float tr = dot(texture(tex, uv + vec2( t.x, -t.y)).rgb, k);
  float ml = dot(texture(tex, uv + vec2(-t.x,  0.0)).rgb, k);
  float mr = dot(texture(tex, uv + vec2( t.x,  0.0)).rgb, k);
  float bl = dot(texture(tex, uv + vec2(-t.x,  t.y)).rgb, k);
  float bm = dot(texture(tex, uv + vec2( 0.0,  t.y)).rgb, k);
  float br = dot(texture(tex, uv + vec2( t.x,  t.y)).rgb, k);
  float gx = (tr + 2.0 * mr + br) - (tl + 2.0 * ml + bl);
  float gy = (bl + 2.0 * bm + br) - (tl + 2.0 * tm + tr);
  return sqrt(gx * gx + gy * gy);
}

void main() {
  // --- UV transforms ---
  vec2 uv = vUv;
  uv = kaleidoscope(uv, uKaleidoSegments);
  uv = polarWarp(uv, uPolarWarp);

  vec2 disp = computeDisplacement(uv);
  vec3 curr = sampleWithSplit(uCurr, uCurrTexSize, uv, disp);

  // --- Feedback trails (previous output, darkened) ---
  // GLSL can't conditionally sample, so always fetch the previous-frame
  // texture and gate the blend by strength. At amount=0 we fall through to
  // plain curr untouched.
  vec3 fbPrev = texture(uFeedback, uv).rgb;
  vec3 colorWithFb = mix(curr, max(curr, fbPrev * 0.92), clamp(uFeedbackAmount, 0.0, 0.85));
  // Use colorWithFb for subsequent transitions; scale "curr" alias.
  vec3 color;

  if (uHasPrev > 0.5 && uBleedT < 0.999) {
    vec3 prev = sampleWithSplit(uPrev, uPrevTexSize, uv, disp);
    float cov = inkCoverageLayered(uv, uBleedT);
    color = mix(prev, colorWithFb, cov);
  } else {
    color = colorWithFb;
  }

  // --- Per-onset ink dabs ---
  float dabKick  = dab(uv, uDabPosKS.xy, uImpulseAges.x, 0.14, 0.30);
  float dabSnare = dab(uv, uDabPosKS.zw, uImpulseAges.y, 0.09, 0.22);
  float dabHat   = dab(uv, uDabPosHV.xy, uImpulseAges.z, 0.05, 0.14);
  float dabVocal = dab(uv, uDabPosHV.zw, uImpulseAges.w, 0.10, 0.18);
  float dabTotal = max(max(dabKick, dabSnare), max(dabHat, dabVocal));
  color *= 1.0 - dabTotal * 0.42;

  // --- Posterize (snare one-shot + always-on layer) ---
  // Snare drives a brief 5..12-level quantization when active; separately,
  // uPosterizeAlways (from a preset) sustains a quantization at N levels.
  if (uSnare > 0.02) {
    float levels = mix(12.0, 5.0, uSnare);
    color = floor(color * levels + 0.5) / levels;
  }
  if (uPosterizeAlways > 1.5) {
    color = floor(color * uPosterizeAlways + 0.5) / uPosterizeAlways;
  }

  // --- Bloom + tonemap (preset multiplier on top of audio) ---
  float bloom = (0.06 + uRms * 0.80 + uRmsPeak * 0.25 + uMotionEnergy * 0.20) * max(0.0, uBloomMult);
  color *= (1.0 + bloom * 0.55);
  color = color / (1.0 + color * 0.22);

  // --- Saturation ---
  float lum = dot(color, vec3(0.299, 0.587, 0.114));
  float sat = clamp(1.0 + uRms * 0.30 - uSnare * 0.55, 0.15, 1.8);
  color = mix(vec3(lum), color, sat);

  // --- Palette bias (centroid → signal / indigo) ---
  float amt = uPaletteShift * uHuePumpNorm;
  vec3 signalTint = vec3(0.06, -0.02, -0.02);
  vec3 indigoTint = vec3(-0.02, -0.02, 0.06);
  color += (amt >= 0.0 ? amt : -amt) * (amt >= 0.0 ? indigoTint : signalTint);

  // --- Duotone (luminance → 2-colour gradient) ---
  if (uDuotoneMix > 0.001) {
    float y = clamp(dot(color, vec3(0.299, 0.587, 0.114)), 0.0, 1.0);
    vec3 duo = mix(uDuotoneLo, uDuotoneHi, y);
    color = mix(color, duo, clamp(uDuotoneMix, 0.0, 1.0));
  }

  // --- Edge overlay (Sobel on the source texture luma) ---
  if (uEdge > 0.001) {
    vec2 uvTex = coverUv(uv, uCurrTexSize, uViewSize);
    float edge = sobelLuma(uCurr, uvTex, uCurrTexSize);
    float edgeStrength = clamp(uEdge * (0.8 + uTreble * 1.2), 0.0, 2.5);
    // Paper-coloured edge contribution, added on top.
    color += vec3(edge) * edgeStrength * 0.7 * vec3(0.93, 0.90, 0.84);
  }

  // --- Invert flash (kick-gated) ---
  float invertAmt = clamp(uInvert * uKick, 0.0, 1.0);
  if (invertAmt > 0.001) {
    color = mix(color, vec3(1.0) - color, invertAmt);
  }

  // --- Dynamic vignette ---
  float r = distance(vUv, vec2(0.5));
  float vigAmount = 0.25 + uVignette * 0.40;
  float vigMask = 1.0 - smoothstep(0.35, 0.95, r) * vigAmount;
  color *= vigMask;

  fragColor = vec4(color, 1.0);
}
`;
