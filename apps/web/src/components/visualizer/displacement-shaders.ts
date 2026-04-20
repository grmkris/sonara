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

// Fragment shader:
//  - Three noise octaves (slow / mid / fine) drive per-pixel UV displacement,
//    scaled by bass / mids / treble respectively. Bass = large slow swell,
//    treble = fine fast shimmer. The image ripples as a surface.
//  - Each onset fires a travelling shockwave: a radial ring propagating out
//    from the image centre that distorts the image at its advancing front
//    (this is the onset-ring energy, *inside* the image instead of layered on
//    top).
//  - Kick impulse adds a one-shot radial push AND an RGB channel split
//    (hanko-red / indigo fringing).
//  - Vocal adds a travelling vertical sine wobble.
//  - Snare briefly posterizes colour levels (wood-block flicker).
//  - Bloom uses a soft Reinhard-ish tonemap so highlights compress instead of
//    clipping to white.
//  - Palette bias nudges toward hanko-red or indigo based on centroid.
//  - Previous→current transition is a radial ink-bleed (matches CSS mask).
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
// seconds since last rising-edge of each impulse type (kick, snare, hat, vocal).
// Used to animate expanding shockwaves.
uniform vec4 uImpulseAges;
// Four ink-blot origins for the frame transition. Regenerated on every new
// fal frame so the reveal pattern is never the same twice.
uniform vec4 uDropsAB; // (a.x, a.y, b.x, b.y)
uniform vec4 uDropsCD; // (c.x, c.y, d.x, d.y)
// Per-drop stagger delays in normalized transition-time (0..~0.5).
uniform vec4 uDropDelays;

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
  // Gaussian band centered on r, width controls sharpness.
  float proximity = exp(-pow((d - r) / max(width, 0.001), 2.0) * 7.0);
  return normalize(toCenter + 1e-5) * proximity * amp * falloff;
}

vec2 computeDisplacement(vec2 uv) {
  float slow = noise21(uv * 2.0  + uTime * 0.10) - 0.5;
  float mid  = noise21(uv * 6.0  + uTime * 0.45) - 0.5;
  float fine = noise21(uv * 24.0 + uTime * 1.8)  - 0.5;

  // Stronger than the first pass — the image should visibly ripple with bass.
  float gain = 0.55 + uIntensity * 1.1;
  float swellAmp = uBass   * 0.048 * gain;
  float midAmp   = uMids   * 0.018 * gain;
  float fineAmp  = uTreble * 0.011 * gain;

  vec2 disp = vec2(slow * swellAmp * 1.2, slow * swellAmp * 0.8)
            + vec2(mid  * midAmp,         mid  * midAmp  * 0.7)
            + vec2(fine * fineAmp * 0.6,  fine * fineAmp);

  // Vocal: travelling vertical sine, stronger on louder sections.
  disp.y += sin(uv.x * 14.0 + uTime * 3.2) * uVocal * 0.012;

  // Kick: instantaneous radial push (scales with the impulse envelope, not age).
  vec2 toCenter = uv - vec2(0.5);
  float d = length(toCenter);
  disp += normalize(toCenter + 1e-5) * uKick * 0.022 * (1.0 - smoothstep(0.0, 0.8, d));

  // Onset shockwaves — four propagating rings, one per drum type.
  // kick: big slow wave (bass shudder)
  // snare: medium wave (body)
  // hat:   fast narrow wave (fizz at top)
  // vocal: medium wave, narrower
  disp += shockwave(uv, vec2(0.5),        uImpulseAges.x, 1.15, 0.14, 0.040);
  disp += shockwave(uv, vec2(0.5),        uImpulseAges.y, 0.85, 0.09, 0.022);
  disp += shockwave(uv, vec2(0.5, 0.22),  uImpulseAges.z, 1.50, 0.05, 0.012);
  disp += shockwave(uv, vec2(0.5, 0.55),  uImpulseAges.w, 0.95, 0.11, 0.020);

  return disp;
}

// Multi-drop ink-bleed: four ink blots spreading from independent origins,
// each with noise-modulated edges so the boundary breathes like ink soaking
// into washi paper. Union of drop coverages gives the final reveal mask.
float inkCoverage(vec2 uv, float t) {
  vec2 da = uDropsAB.xy;
  vec2 db = uDropsAB.zw;
  vec2 dc = uDropsCD.xy;
  vec2 dd = uDropsCD.zw;

  // Per-pixel edge jitter so the blot perimeter is irregular (papery fibre).
  float edgeNoise = (noise21(uv * 18.0) - 0.5) * 0.08;

  float ta = max(0.0, t - uDropDelays.x);
  float tb = max(0.0, t - uDropDelays.y);
  float tc = max(0.0, t - uDropDelays.z);
  float td = max(0.0, t - uDropDelays.w);

  // Drop A is the primary — scaled larger so by t=1 it alone covers the full
  // viewport from near-centre. Others add richness.
  float ra = ta * 1.25;
  float rb = tb * 0.95;
  float rc = tc * 0.85;
  float rd = td * 1.00;

  float wa = 1.0 - smoothstep(ra + edgeNoise, ra + 0.20 + edgeNoise, distance(uv, da));
  float wb = 1.0 - smoothstep(rb + edgeNoise, rb + 0.18 + edgeNoise, distance(uv, db));
  float wc = 1.0 - smoothstep(rc + edgeNoise, rc + 0.16 + edgeNoise, distance(uv, dc));
  float wd = 1.0 - smoothstep(rd + edgeNoise, rd + 0.18 + edgeNoise, distance(uv, dd));

  return max(wa, max(wb, max(wc, wd)));
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

void main() {
  vec2 disp = computeDisplacement(vUv);
  vec3 curr = sampleWithSplit(uCurr, uCurrTexSize, vUv, disp);

  vec3 color;
  if (uHasPrev > 0.5 && uBleedT < 0.999) {
    vec3 prev = sampleWithSplit(uPrev, uPrevTexSize, vUv, disp);
    float cov = inkCoverage(vUv, uBleedT);
    color = mix(prev, curr, cov);
  } else {
    color = curr;
  }

  // Snare: brief posterize (5..12 levels).
  if (uSnare > 0.02) {
    float levels = mix(12.0, 5.0, uSnare);
    color = floor(color * levels + 0.5) / levels;
  }

  // Bloom + soft-shoulder tonemap — bloom can push hard because the shoulder
  // compresses to <= 1.
  float bloom = 0.06 + uRms * 0.80 + uRmsPeak * 0.25;
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

  fragColor = vec4(color, 1.0);
}
`;
