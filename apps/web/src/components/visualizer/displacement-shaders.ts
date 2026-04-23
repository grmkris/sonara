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
//
// Y-flip on sample: the quad's UV convention is "v=0 at clip-space top"
// (matching HTML Image textures uploaded without UNPACK_FLIP_Y_WEBGL). But
// FBO textures are written with gl_FragCoord.y=0 at bottom, so FBO texel v=0
// holds clip-space-bottom content from the previous pass. We flip V here so
// the blit displays the FBO right-side up.
export const BLIT_FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uSrc;
void main() { fragColor = texture(uSrc, vec2(vUv.x, 1.0 - vUv.y)); }
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
// Paper/ink primitives — 0 = off, 1 = full.
uniform float uWashi;
uniform float uDeckle;
uniform float uBokashi;
uniform float uNijimi;
uniform float uDrybrush;
// Light primitives — 0 = off, 1 = full.
uniform float uHalation;
uniform float uFocal;
uniform float uGodray;
uniform float uGrain;
// Color/geometry primitives — 0 = off, 1 = full.
uniform float uCurl;
uniform float uDither;
uniform float uSeal;
uniform float uEnso;
// Session arc (0..1 over ~20min). Feeds trail decay + palette temp shift.
uniform float uSessionProgress;
// Watercolor primitives — 0 = off, 1 = full.
uniform float uWetEdge;
uniform float uGranulation;
// Halftone / riso post-pass — 0 = off, 1 = full.
uniform float uHalftone;
// Papari–Kuwahara painterly filter mix — 0 = off, 1 = full.
uniform float uPainterly;
// Watercolour traditions — 0 = off, 1 = full.
uniform float uSalt;         // crystalline absorption spots
uniform float uCauliflower;  // wet-on-damp backrun rings
uniform float uSplatter;     // brush-flick droplets
// Gray-Scott reaction-diffusion density mask. Sampled from a separate
// simulation layer (rd-layer.ts). uRDAmount blends the mask in; 0 = off.
uniform sampler2D uRD;
uniform float uRDAmount;
// Reveal-from-noise (diffusion-materialize). uRevealActive is 0/1, uRevealT
// animates 0..1 per frame-arrival. Drives a per-pixel threshold gate so the
// newly-landed image crystallises in patches, reading as "diffusion denoise".
uniform float uRevealActive;
uniform float uRevealT;

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

// 3-octave fbm on top of value-noise21. Amplitude halves, frequency doubles.
float fbm2(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) {
    v += a * noise21(p);
    p *= 2.0;
    a *= 0.5;
  }
  return v;
}

// iq recursive domain warp: f(p + k*fbm(p + k*fbm(p))). Cloudy turbulence
// rather than plate ripples; audio-modulated warp amount drives the swirl.
float warpedFbm(vec2 p, float k) {
  vec2 q = vec2(fbm2(p), fbm2(p + vec2(5.2, 1.3)));
  vec2 r = vec2(
    fbm2(p + k * q + vec2(1.7, 9.2)),
    fbm2(p + k * q + vec2(8.3, 2.8))
  );
  return fbm2(p + k * r);
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
  // Slowest octave is now an iq recursive domain warp (cloudy turbulence,
  // audio-modulated swirl). Mid/fine/warpN stay as plain value noise so
  // transient audio reactivity (kick punch, treble shimmer) reads crisp.
  float warpK = 3.0 + uBass * 3.0 + uMotionEnergy * 1.5; // 3..7.5
  vec2 slowP = uv * 2.0 + uTime * 0.10;
  float slowA = warpedFbm(slowP, warpK) - 0.5;
  float slowB = warpedFbm(slowP + vec2(3.1, 7.8), warpK) - 0.5;
  vec2 slowDisp = vec2(slowA, slowB);

  float mid  = noise21(uv * 6.0  + uTime * 0.45) - 0.5;
  float fine = noise21(uv * 24.0 + uTime * 1.8)  - 0.5;
  float warpN = noise21(uv * 3.5 + uTime * 0.18) - 0.5;

  float gain = (0.55 + uIntensity * 1.1) * max(0.0, uNoiseMult);
  float swellAmp = uBass   * 0.048 * gain;
  float midAmp   = uMids   * 0.018 * gain;
  float fineAmp  = uTreble * 0.011 * gain;
  float warpAmp  = uWarp   * 0.020 * gain;

  vec2 disp = slowDisp * swellAmp * vec2(1.2, 0.8)
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

  // --- Curl: curl-noise UV warp ---
  // Numerical curl of a 2D fbm potential (dpsi/dy, -dpsi/dx). Reads as
  // swirling, volume-preserving eddies — less "tornado" than polarWarp.
  if (uCurl > 0.001) {
    vec2 cp = uv * 3.0 + uTime * 0.1;
    float eps = 0.01;
    float gx = fbm2(cp + vec2(eps, 0.0)) - fbm2(cp - vec2(eps, 0.0));
    float gy = fbm2(cp + vec2(0.0, eps)) - fbm2(cp - vec2(0.0, eps));
    vec2 curlV = vec2(gy, -gx) / (2.0 * eps);
    uv += curlV * 0.015 * clamp(uCurl, 0.0, 1.0);
  }

  vec2 disp = computeDisplacement(uv);
  vec3 curr = sampleWithSplit(uCurr, uCurrTexSize, uv, disp);

  // --- Feedback trails (previous output, darkened) ---
  // GLSL can't conditionally sample, so always fetch the previous-frame
  // texture and gate the blend by strength. At amount=0 we fall through to
  // plain curr untouched.
  // Y-flip: uFeedback is an FBO (gl_FragCoord.y=0 at bottom), our quad UV has
  // v=0 at clip-space top. Flip so the feedback overlay tracks the current
  // image rather than an inverted ghost.
  vec3 fbPrev = texture(uFeedback, vec2(uv.x, 1.0 - uv.y)).rgb;
  // Trail multiplier deepens over the session arc (0.92 → 0.98).
  float fbDecay = 0.92 + 0.06 * uSessionProgress;
  vec3 colorWithFb = mix(curr, max(curr, fbPrev * fbDecay), clamp(uFeedbackAmount, 0.0, 0.85));
  // Use colorWithFb for subsequent transitions; scale "curr" alias.
  vec3 color;

  if (uHasPrev > 0.5 && uBleedT < 0.999) {
    vec3 prev = sampleWithSplit(uPrev, uPrevTexSize, uv, disp);
    float cov = inkCoverageLayered(uv, uBleedT);
    color = mix(prev, colorWithFb, cov);
  } else {
    color = colorWithFb;
  }

  // --- Nijimi: ink bleed at dark boundaries ---
  // Wet-ink diffusion: sample neighbours on the current texture and mix
  // them into dark regions only. Sharp ink edges soften and crawl outward.
  if (uNijimi > 0.001) {
    vec2 px = 1.0 / max(vec2(1.0), uCurrTexSize);
    vec2 uvTex = coverUv(uv, uCurrTexSize, uViewSize);
    float amp = 2.5 * uNijimi;
    vec3 soft = (
      texture(uCurr, uvTex + px * vec2(amp, 0.0)).rgb +
      texture(uCurr, uvTex - px * vec2(amp, 0.0)).rgb +
      texture(uCurr, uvTex + px * vec2(0.0, amp)).rgb +
      texture(uCurr, uvTex - px * vec2(0.0, amp)).rgb
    ) * 0.25;
    float lumN = dot(color, vec3(0.299, 0.587, 0.114));
    float inkMask = 1.0 - smoothstep(0.15, 0.55, lumN);
    color = mix(color, soft, inkMask * uNijimi * 0.7);
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

  // --- Gray-Scott RD overlay ---
  // Sample the simulation texture as an ink-density mask. The V channel
  // holds the growth species, so bright-V = active pattern. We darken the
  // base image there, producing slow organic blobs that merge and drift.
  if (uRDAmount > 0.001) {
    float rdV = texture(uRD, vUv).g;
    float inkMask = smoothstep(0.15, 0.45, rdV);
    vec3 inkTone = mix(uDuotoneLo, vec3(0.06, 0.05, 0.05), 0.5);
    color = mix(color, inkTone, inkMask * clamp(uRDAmount, 0.0, 1.0) * 0.75);
  }

  // --- Bokashi: wet gradient wash ---
  // Slow, low-frequency fbm tinted by the duotone endpoints. Reads as a
  // watered-down ink pool laid on top; not audio-reactive.
  if (uBokashi > 0.001) {
    float washN = fbm2(vUv * 1.8 + uTime * 0.02);
    vec3 washColor = mix(uDuotoneLo, uDuotoneHi, washN);
    color = mix(color, (color + washColor) * 0.5, clamp(uBokashi, 0.0, 1.0) * 0.55);
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

  // --- Wet-edge darkening (classic sumi-e bleed ring) ---
  // Dark halo where luminance transitions steeply, simulating ink pooling
  // at the edge of a wet brush stroke. Sample a small-radius luma blur of
  // the source texture, subtract current luma; the positive side darkens
  // the image where the blurred neighbourhood is brighter than here.
  if (uWetEdge > 0.001) {
    vec2 pxW = 1.0 / max(vec2(1.0), uCurrTexSize);
    vec2 uvW = coverUv(uv, uCurrTexSize, uViewSize);
    float rW = 2.5;
    vec3 lumaK = vec3(0.299, 0.587, 0.114);
    float lc = dot(color, lumaK);
    float lb = 0.0;
    lb += dot(texture(uCurr, uvW + pxW * vec2( rW, 0.0)).rgb, lumaK);
    lb += dot(texture(uCurr, uvW + pxW * vec2(-rW, 0.0)).rgb, lumaK);
    lb += dot(texture(uCurr, uvW + pxW * vec2(0.0,  rW)).rgb, lumaK);
    lb += dot(texture(uCurr, uvW + pxW * vec2(0.0, -rW)).rgb, lumaK);
    lb *= 0.25;
    float ring = max(0.0, lb - lc);
    color *= 1.0 - ring * clamp(uWetEdge, 0.0, 1.0) * 2.0;
  }

  // --- Pigment granulation ---
  // Two-octave fbm speckle that only bites mid-tones (dark solids and pure
  // highlights stay clean). Reads like pigment settling into paper texture.
  if (uGranulation > 0.001) {
    float n = fbm2(vUv * 180.0) * 0.6 + fbm2(vUv * 60.0) * 0.4;
    float speckle = (n - 0.5) * 2.0;
    float lumG = dot(color, vec3(0.299, 0.587, 0.114));
    float midMask = 1.0 - abs(lumG - 0.5) * 2.0;
    color *= 1.0 + speckle * 0.09 * clamp(uGranulation, 0.0, 1.0) * max(0.0, midMask);
  }

  // --- Washi: paper-fiber texture ---
  // Two anisotropic noise layers give the cross-grain look of mulberry paper.
  // Darkens in fibres (mostly), lifts in specks — a faint multiplicative mod.
  if (uWashi > 0.001) {
    float fib = noise21(vUv * vec2(420.0, 95.0));
    fib += noise21(vUv * vec2(32.0, 115.0)) * 0.5;
    float fibMod = (fib / 1.5 - 0.55) * 0.22 * uWashi;
    color *= 1.0 + fibMod;
  }

  // --- Drybrush: rough-brush dropout ---
  // Horizontal streaks that brighten toward paper-white. Best on mid-range
  // luminance — solid blacks and whites stay intact.
  if (uDrybrush > 0.001) {
    float streak = noise21(vUv * vec2(8.0, 120.0));
    streak = smoothstep(0.58, 0.88, streak);
    float lumD = dot(color, vec3(0.299, 0.587, 0.114));
    float midMask = 1.0 - abs(lumD - 0.5) * 2.0;
    color = mix(color, vec3(0.96, 0.93, 0.86), streak * uDrybrush * 0.55 * max(0.0, midMask));
  }

  // --- Deckle: torn-paper edge ---
  // Noisy fade at the canvas rim toward a paper colour, so the image reads
  // as a torn sheet rather than a hard rectangle.
  if (uDeckle > 0.001) {
    vec2 dc = abs(vUv - 0.5) * 2.0;
    float near = max(dc.x, dc.y);
    float edgeN = noise21(vUv * 34.0) * 0.14;
    float tear = smoothstep(0.92 - edgeN, 0.99, near);
    color = mix(color, vec3(0.90, 0.87, 0.80), tear * uDeckle);
  }

  // --- Halation: highlight bloom spread ---
  // Sample a cheap 6-tap blur of the source and add it gated on luminance,
  // so hot spots leak into their neighbours (film-halation glow).
  if (uHalation > 0.001) {
    vec2 pxH = 1.0 / max(vec2(1.0), uCurrTexSize);
    vec2 uvH = coverUv(uv, uCurrTexSize, uViewSize);
    float rH = 6.0;
    vec3 spread = (
      texture(uCurr, uvH + pxH * vec2( rH, 0.0)).rgb +
      texture(uCurr, uvH + pxH * vec2(-rH, 0.0)).rgb +
      texture(uCurr, uvH + pxH * vec2(0.0,  rH)).rgb +
      texture(uCurr, uvH + pxH * vec2(0.0, -rH)).rgb +
      texture(uCurr, uvH + pxH * vec2( rH, rH) * 0.7).rgb +
      texture(uCurr, uvH + pxH * vec2(-rH,-rH) * 0.7).rgb
    ) / 6.0;
    float lumH = dot(color, vec3(0.299, 0.587, 0.114));
    float hiMask = smoothstep(0.55, 0.95, lumH);
    color += spread * hiMask * uHalation * 0.5;
  }

  // --- Papari–Kuwahara painterly filter ---
  // Reference: Papari, Petkov, Campisi (2007), "Artistic Edge and Corner
  // Enhancing Smoothing", IEEE TIP — polynomial-weighted variant of Kuwahara
  // (1976). Samples a small disk around the current texel in 8 angular
  // sectors, picks the sector with the lowest luminance variance, outputs its
  // mean. Edge-preserving — flat regions smooth, real edges stay sharp.
  // Reads as settled painterly brushwork.
  if (uPainterly > 0.001) {
    vec2 pxK = 1.0 / max(vec2(1.0), uCurrTexSize);
    vec2 uvK = coverUv(uv, uCurrTexSize, uViewSize);
    vec3 sumRgb[8];
    vec3 sumRgb2[8];
    float sumW[8];
    for (int i = 0; i < 8; i++) {
      sumRgb[i] = vec3(0.0);
      sumRgb2[i] = vec3(0.0);
      sumW[i] = 0.0;
    }
    // 3 concentric rings × 8 angular samples = 24 disk samples.
    // Inner samples are weighted more so the mean tracks local colour.
    for (int ir = 1; ir <= 3; ir++) {
      float r = float(ir) * 1.1;
      float rw = 1.0 / (1.0 + float(ir - 1) * 0.6);
      for (int ia = 0; ia < 8; ia++) {
        float theta = (float(ia) + 0.5) * 0.78539816;
        vec2 off = vec2(cos(theta), sin(theta)) * r;
        vec3 c = texture(uCurr, uvK + pxK * off).rgb;
        sumRgb[ia]  += c * rw;
        sumRgb2[ia] += c * c * rw;
        sumW[ia]    += rw;
      }
    }
    // Centre sample shared across all sectors — anchors the result so 8
    // disjoint means don't drift wildly when the neighbourhood is flat.
    vec3 cc = texture(uCurr, uvK).rgb;
    for (int k = 0; k < 8; k++) {
      sumRgb[k]  += cc * 0.35;
      sumRgb2[k] += cc * cc * 0.35;
      sumW[k]    += 0.35;
    }
    vec3 lumaK = vec3(0.299, 0.587, 0.114);
    vec3 bestMean = cc;
    float bestVar = 1e10;
    for (int k = 0; k < 8; k++) {
      float w = max(1e-5, sumW[k]);
      vec3 mean = sumRgb[k] / w;
      vec3 mean2 = sumRgb2[k] / w;
      vec3 variance = max(vec3(0.0), mean2 - mean * mean);
      float lumaVar = dot(variance, lumaK);
      if (lumaVar < bestVar) {
        bestVar = lumaVar;
        bestMean = mean;
      }
    }
    color = mix(color, bestMean, clamp(uPainterly, 0.0, 1.0));
  }

  // --- Focal: radial depth-of-field ---
  // Pixels outside the focus ring are replaced by a blurred copy of the
  // source texture, proportional to how far from centre they are.
  if (uFocal > 0.001) {
    float fd = distance(vUv, vec2(0.5));
    float oof = smoothstep(0.25, 0.6, fd) * clamp(uFocal, 0.0, 1.0);
    if (oof > 0.001) {
      vec2 pxF = 1.0 / max(vec2(1.0), uCurrTexSize);
      vec2 uvF = coverUv(uv, uCurrTexSize, uViewSize);
      float rF = 4.0 * oof + 1.0;
      vec3 blur = (
        texture(uCurr, uvF + pxF * vec2( rF, 0.0)).rgb +
        texture(uCurr, uvF + pxF * vec2(-rF, 0.0)).rgb +
        texture(uCurr, uvF + pxF * vec2(0.0,  rF)).rgb +
        texture(uCurr, uvF + pxF * vec2(0.0, -rF)).rgb
      ) * 0.25;
      color = mix(color, blur, oof);
    }
  }

  // --- Godray: directional light shafts ---
  // Noisy additive streaks along a fixed light direction, slowly animated.
  if (uGodray > 0.001) {
    vec2 lightDir = normalize(vec2(0.3, -0.8));
    float along = dot(vUv - vec2(0.5), lightDir);
    float across = dot(vUv - vec2(0.5), vec2(lightDir.y, -lightDir.x));
    float rayN = noise21(vec2(across * 18.0, along * 3.0) + uTime * 0.05);
    float ray = smoothstep(0.55, 0.92, rayN) * (0.5 + 0.5 * sin(across * 22.0 + uTime * 0.8));
    color += vec3(0.95, 0.90, 0.82) * max(0.0, ray) * uGodray * 0.28;
  }

  // --- Dither: ordered Bayer 4x4 ---
  // Threshold matrix dither toward a reduced palette. Reads like a newsprint
  // or risograph texture rather than a crisp posterize.
  if (uDither > 0.001) {
    const float bayerM[16] = float[16](
       0.0,  8.0,  2.0, 10.0,
      12.0,  4.0, 14.0,  6.0,
       3.0, 11.0,  1.0,  9.0,
      15.0,  7.0, 13.0,  5.0
    );
    ivec2 bp = ivec2(mod(gl_FragCoord.xy, 4.0));
    int bi = bp.x + bp.y * 4;
    float threshold = bayerM[bi] / 16.0 - 0.5;
    vec3 biased = color + vec3(threshold) * 0.1 * uDither;
    float levels = mix(8.0, 3.0, clamp(uDither, 0.0, 1.0));
    vec3 quantized = floor(biased * levels + 0.5) / levels;
    color = mix(color, quantized, clamp(uDither, 0.0, 1.0));
  }

  // --- Enso: single-stroke circle ---
  // A hand-drawn ink ring centred on the canvas with a broken arc and
  // brush-width jitter. Static composition — reads as a sumi-e accent.
  if (uEnso > 0.001) {
    vec2 ec = vUv - vec2(0.5);
    float er = length(ec);
    float ea = atan(ec.y, ec.x);
    float wMod = 1.0 + noise21(vec2(ea * 6.0 + 1.7, er * 4.0)) * 0.6;
    float gap = smoothstep(0.5, 0.15, abs(ea + 0.6));
    float ring = smoothstep(0.01 * wMod, 0.0, abs(er - 0.3));
    ring *= mix(1.0, 0.0, gap * 0.75);
    color = mix(color, vec3(0.06, 0.05, 0.04), ring * uEnso * 0.9);
  }

  // --- Seal: kanji-style stamp ---
  // Red square stamp with a cutout character glyph and a noisy mask so it
  // looks inked rather than printed.
  if (uSeal > 0.001) {
    vec2 sp = vUv - vec2(0.87, 0.12);
    vec2 as = abs(sp);
    float sq = step(max(as.x, as.y), 0.045);
    float sqOuter = step(max(as.x, as.y), 0.05);
    float border = sqOuter - sq;
    float glyphV = step(as.x, 0.008) * step(as.y, 0.028);
    float glyphH = step(as.y, 0.008) * step(as.x, 0.028);
    float glyph = clamp(glyphV + glyphH, 0.0, 1.0);
    float sealMask = border + sq * (1.0 - glyph);
    float stampNoise = noise21(vUv * 110.0);
    sealMask *= smoothstep(0.25, 0.65, stampNoise);
    color = mix(color, vec3(0.78, 0.14, 0.10), sealMask * clamp(uSeal, 0.0, 1.0));
  }

  // --- Grain: film grain ---
  // Per-fragment temporal noise on final colour. Neutral-gray mean so it
  // doesn't drift brightness.
  if (uGrain > 0.001) {
    float g = hash21(gl_FragCoord.xy + vec2(fract(uTime * 7.0), fract(uTime * 13.0)));
    color += (g - 0.5) * uGrain * 0.12;
  }

  // --- Halftone / riso post-pass ---
  // Luminance-thresholded rotated dot screen. Reads as print on paper;
  // pairs well with dither for a risograph feel. Single 45° angle keeps
  // things sumi-e; a second cross-screen angle would read more western.
  if (uHalftone > 0.001) {
    float ang = 0.785398;  // 45°
    float freq = 200.0;
    vec2 cUv = vUv - 0.5;
    vec2 rUv = vec2(
      cUv.x * cos(ang) - cUv.y * sin(ang),
      cUv.x * sin(ang) + cUv.y * cos(ang)
    );
    float dotField = 0.5 + 0.5 * cos(rUv.x * freq) * cos(rUv.y * freq);
    float lumH2 = dot(color, vec3(0.299, 0.587, 0.114));
    float mask = smoothstep(lumH2 - 0.12, lumH2 + 0.12, dotField);
    vec3 inked = mix(vec3(0.08, 0.07, 0.06), vec3(0.94, 0.91, 0.84), mask);
    color = mix(color, inked, clamp(uHalftone, 0.0, 1.0));
  }

  // --- Session arc palette temp ---
  // Cold→warm shift across the arc. At 0 nudges toward cool (slight blue),
  // at 1 nudges toward warm (slight amber). Small amplitude so it reads
  // as a subtle horizon drift, not a filter.
  float arcT = clamp(uSessionProgress, 0.0, 1.0);
  vec3 coolTint = vec3(-0.015, -0.005, 0.020);
  vec3 warmTint = vec3( 0.025,  0.010, -0.015);
  color += mix(coolTint, warmTint, arcT) * 0.9;

  // --- Reveal-from-noise (diffusion materialise) ---
  // Each time a new frame lands, revealT animates 0→1 over ~1.1s. A per-pixel
  // threshold map (low-freq fbm + high-freq hash) gates the final color:
  // pixels whose threshold is below revealT are revealed; the rest show a
  // hash-noise substrate tinted by the ambient colour of the frame. Reads
  // like diffusion denoising — the image crystallises in patches rather
  // than uniformly fading.
  if (uRevealActive > 0.5 && uRevealT < 0.999) {
    float thrLow = fbm2(vUv * 3.0 + uTime * 0.04);
    float thrHi = hash21(vUv * 800.0);
    float thr = mix(thrLow, thrHi, 0.35);
    float revealEdge = smoothstep(thr - 0.12, thr + 0.04, uRevealT);
    float n1 = hash21(gl_FragCoord.xy + vec2(fract(uTime * 3.0), 0.0));
    float n2 = hash21(gl_FragCoord.xy + vec2(0.0, fract(uTime * 5.0)));
    float n3 = hash21(gl_FragCoord.xy + vec2(fract(uTime * 7.0), fract(uTime * 11.0)));
    vec3 substrate = vec3(n1, n2, n3) * 0.45 + 0.18;
    // Tint substrate by the four corners of uCurr so the noise doesn't look
    // disconnected from the incoming image's palette.
    vec3 ambient = (
      texture(uCurr, vec2(0.08, 0.08)).rgb +
      texture(uCurr, vec2(0.92, 0.08)).rgb +
      texture(uCurr, vec2(0.08, 0.92)).rgb +
      texture(uCurr, vec2(0.92, 0.92)).rgb
    ) * 0.25;
    substrate = mix(substrate, (substrate + ambient) * 0.5, 0.55);
    color = mix(substrate, color, revealEdge);
  }

  // --- Dynamic vignette ---
  float r = distance(vUv, vec2(0.5));
  float vigAmount = 0.25 + uVignette * 0.40;
  float vigMask = 1.0 - smoothstep(0.35, 0.95, r) * vigAmount;
  color *= vigMask;

  fragColor = vec4(color, 1.0);
}
`;
