import {
  abs,
  clamp,
  cos,
  exp,
  float,
  Fn,
  length,
  max,
  mix,
  mx_noise_float,
  normalize,
  pow,
  sin,
  smoothstep,
  uv,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import type { Node } from "three/webgpu";

import type { ExperienceUniforms } from "./experience-renderer";

const insideUv = (p: Node<"vec2">) => clamp(p, 0.001, 0.999);

const minAspect = (u: ExperienceUniforms) =>
  clamp(u.aspect.div(u.imageAspect), 0, 1);
const maxAspect = (u: ExperienceUniforms) =>
  clamp(u.imageAspect.div(u.aspect), 0, 1);

// Velocity, divergence, pressure, and dye have separate bounded render targets.
export const flowPass = (u: ExperienceUniforms) =>
  Fn(() => {
    const p = uv();
    const v = u.velocity.sample(p).xy;
    const advected = u.velocity.sample(insideUv(p.sub(v.mul(1 / 60)))).xy;
    const d1 = p.sub(u.hand1.xy).mul(vec2(u.aspect, 1));
    const d2 = p.sub(u.hand2.xy).mul(vec2(u.aspect, 1));
    const force1 = exp(d1.dot(d1).mul(-100)).mul(u.hand1.z);
    const force2 = exp(d2.dot(d2).mul(-100)).mul(u.hand2.z);
    const t = u.time.mul(0.12);
    const swirl = vec2(cos(p.y.mul(7).add(t)), sin(p.x.mul(8).sub(t)));
    const hand = u.gesture1.xy
      .add(vec2(d1.y.negate(), d1.x).mul(3))
      .mul(force1)
      .add(u.gesture2.xy.add(vec2(d2.y.negate(), d2.x).mul(3)).mul(force2));
    const mask = u.mask
      .sample(vec2(float(1).sub(p.x), float(1).sub(p.y)))
      .r.mul(u.maskActive);
    const edge = vec2(
      u.mask
        .sample(vec2(float(1).sub(p.x).add(u.texel.x), float(1).sub(p.y)))
        .r.sub(mask),
      u.mask
        .sample(vec2(float(1).sub(p.x), float(1).sub(p.y).add(u.texel.y)))
        .r.sub(mask)
    ).mul(u.maskActive);
    return vec4(
      clamp(
        advected
          .mul(0.997)
          .add(swirl.mul(u.flow.mul(0.001).add(0.0003)))
          .add(hand.mul(0.025))
          .add(edge.mul(0.02)),
        -0.6,
        0.6
      ),
      0,
      1
    );
  })();

export const curlPass = (u: ExperienceUniforms) =>
  Fn(() => {
    const p = uv();
    const n = u.velocity.sample(p.add(vec2(0, u.texel.y))).xy;
    const s = u.velocity.sample(p.sub(vec2(0, u.texel.y))).xy;
    const e = u.velocity.sample(p.add(vec2(u.texel.x, 0))).xy;
    const w = u.velocity.sample(p.sub(vec2(u.texel.x, 0))).xy;
    return vec4(e.y.sub(w.y).sub(n.x).add(s.x).mul(0.5), 0, 0, 1);
  })();
export const vorticityPass = (u: ExperienceUniforms) =>
  Fn(() => {
    const p = uv();
    const n = abs(u.curl.sample(p.add(vec2(0, u.texel.y))).r);
    const s = abs(u.curl.sample(p.sub(vec2(0, u.texel.y))).r);
    const e = abs(u.curl.sample(p.add(vec2(u.texel.x, 0))).r);
    const w = abs(u.curl.sample(p.sub(vec2(u.texel.x, 0))).r);
    const gradient = vec2(n.sub(s), w.sub(e));
    const confinement = gradient
      .div(length(gradient).add(0.0001))
      .mul(u.curl.sample(p).r)
      .mul(0.015);
    return vec4(
      clamp(u.velocity.sample(p).xy.add(confinement), -0.6, 0.6),
      0,
      1
    );
  })();
export const divergencePass = (u: ExperienceUniforms) =>
  Fn(() => {
    const p = uv();
    const n = u.velocity.sample(p.add(vec2(0, u.texel.y))).y;
    const s = u.velocity.sample(p.sub(vec2(0, u.texel.y))).y;
    const e = u.velocity.sample(p.add(vec2(u.texel.x, 0))).x;
    const w = u.velocity.sample(p.sub(vec2(u.texel.x, 0))).x;
    return vec4(e.sub(w).add(n).sub(s).mul(0.5), 0, 0, 1);
  })();
export const pressurePass = (u: ExperienceUniforms) =>
  Fn(() => {
    const p = uv();
    const n = u.pressure.sample(p.add(vec2(0, u.texel.y))).r;
    const s = u.pressure.sample(p.sub(vec2(0, u.texel.y))).r;
    const e = u.pressure.sample(p.add(vec2(u.texel.x, 0))).r;
    const w = u.pressure.sample(p.sub(vec2(u.texel.x, 0))).r;
    return vec4(
      n.add(s).add(e).add(w).sub(u.divergence.sample(p).r).mul(0.25),
      0,
      0,
      1
    );
  })();
export const projectPass = (u: ExperienceUniforms) =>
  Fn(() => {
    const p = uv();
    const n = u.pressure.sample(p.add(vec2(0, u.texel.y))).r;
    const s = u.pressure.sample(p.sub(vec2(0, u.texel.y))).r;
    const e = u.pressure.sample(p.add(vec2(u.texel.x, 0))).r;
    const w = u.pressure.sample(p.sub(vec2(u.texel.x, 0))).r;
    const boundary = smoothstep(0, 0.03, p).mul(
      smoothstep(0, 0.03, float(1).sub(p))
    );
    return vec4(
      u.velocity
        .sample(p)
        .xy.sub(vec2(e.sub(w), n.sub(s)).mul(0.5))
        .mul(boundary),
      0,
      1
    );
  })();
export const dyePass = (u: ExperienceUniforms) =>
  Fn(() => {
    const p = uv();
    const velocity = u.velocity.sample(p).xy;
    const dye = u.dye.sample(insideUv(p.sub(velocity.mul(1 / 60)))).rgb;
    const x = p.x.mul(2).sub(1);
    const line = sin(x.mul(2.1).add(u.time.mul(0.09)))
      .mul(0.12)
      .add(0.5);
    const ribbon = exp(pow(p.y.sub(line), 2).mul(-1300)).mul(
      exp(x.mul(x).mul(-2.5))
    );
    const point = vec2(
      sin(u.time.mul(0.27)).mul(0.24).add(0.5),
      cos(u.time.mul(0.19)).mul(0.17).add(0.5)
    );
    const impulse = exp(length(p.sub(point)).mul(-60)).mul(u.music.x);
    const h1 = exp(length(p.sub(u.hand1.xy)).mul(-45)).mul(abs(u.hand1.z));
    const h2 = exp(length(p.sub(u.hand2.xy)).mul(-45)).mul(abs(u.hand2.z));
    const amount = ribbon
      .mul(u.music.y.mul(0.009).add(0.002))
      .add(impulse.mul(0.06))
      .add(h1.add(h2).mul(0.015));
    const tint = mix(
      u.color1,
      u.color2,
      sin(p.x.mul(3).add(u.time.mul(0.05)))
        .mul(0.5)
        .add(0.5)
    );
    return vec4(
      clamp(
        dye.mul(u.trails.mul(0.005).add(0.982)).add(tint.mul(amount)),
        0,
        2
      ),
      1
    );
  })();

export const materialPass = (u: ExperienceUniforms) =>
  Fn(() => {
    const p = uv().sub(0.5).mul(vec2(u.aspect, 1)).mul(2);
    const t = u.time.mul(u.flow.mul(0.12).add(0.035));
    const spread = u.expansion
      .mul(0.3)
      .add(u.direction.z.mul(0.3))
      .sub(u.direction.y.mul(0.15));
    const q = p.mul(float(1.15).sub(spread)).toVar();
    const folded = vec2(abs(q.x), q.y);
    q.assign(mix(q, folded, u.symmetry.mul(0.6)));
    const flow = u.velocity.sample(uv()).xy;
    q.addAssign(flow.mul(0.45));
    const density = u.dye.sample(uv()).rgb;
    const depth = density.dot(vec3(0.3, 0.5, 0.2));
    const noise = mx_noise_float(vec3(q.mul(1.8).add(t), t.mul(0.6)));
    const filament = q.y
      .add(sin(q.x.mul(1.7).add(t)).mul(0.36))
      .add(noise.mul(0.16))
      .add(sin(q.x.mul(3.8).sub(t.mul(0.7))).mul(0.07));
    const width = u.music.w
      .mul(0.11)
      .add(u.music.y.mul(0.06))
      .add(u.music.x.mul(0.025))
      .add(0.055);
    const envelope = exp(filament.mul(filament).div(width).negate()).mul(
      exp(q.x.mul(q.x).mul(-0.17))
    );
    const veins = pow(
      sin(
        filament
          .mul(u.treatment.mul(3).add(15))
          .add(noise.mul(1.5))
          .sub(t.mul(1.5))
      )
        .mul(0.5)
        .add(0.5),
      5
    );
    const lace = pow(
      abs(mx_noise_float(vec3(q.mul(12).add(flow.mul(8)), t.mul(0.4)))),
      2
    ).mul(u.music.z.mul(0.8).add(0.15));
    const ridge = pow(veins, 12).mul(envelope);
    const ink = u.treatment.lessThan(0.5);
    const light = envelope.mul(veins.mul(0.65).add(0.1)).add(depth.mul(1.2));
    const tint = mix(
      u.color1,
      u.color2,
      sin(filament.mul(5).add(q.x).add(t.mul(0.2)))
        .mul(0.5)
        .add(0.5)
    );
    const pearl = mix(
      tint,
      u.color3,
      clamp(veins.mul(0.25).add(lace.mul(0.3)), 0, 0.45)
    );
    const normal = normalize(vec3(flow.mul(5).add(vec2(noise, filament)), 1));
    const specular = pow(max(normal.dot(normalize(vec3(-0.5, 0.7, 1))), 0), 18)
      .mul(envelope)
      .mul(0.3);
    const base = pearl
      .mul(light)
      .mul(u.intensity.mul(1.1).add(0.45))
      .add(u.color3.mul(specular))
      .add(density.mul(0.5))
      .add(
        mix(u.color1, vec3(1, 0.94, 0.86), 0.72)
          .mul(ridge)
          .mul(ink.select(0.3, 2.4))
      )
      .mul(ink.select(0.7, 1));
    const imageUv = q
      .mul(vec2(minAspect(u), maxAspect(u)))
      .mul(0.4)
      .add(0.5)
      .add(flow.mul(0.22))
      .add(vec2(noise, filament).mul(float(1).sub(u.revealAmount).mul(0.03)));
    const photo = mix(
      u.oldImage.sample(clamp(imageUv, 0.001, 0.999)).rgb,
      u.image.sample(clamp(imageUv, 0.001, 0.999)).rgb,
      u.imageMix
    );
    const body = u.mask.sample(
      vec2(float(1).sub(uv().x), float(1).sub(uv().y))
    ).r;
    const mask = mix(float(1), body.mul(0.85).add(0.15), u.maskActive);
    const reveal = smoothstep(0.05, 0.65, envelope.add(depth))
      .mul(u.revealAmount)
      .mul(u.imageActive)
      .mul(mask);
    const color = mix(base, photo.mul(1.35).add(base.mul(0.35)), reveal).mul(
      mask.mul(0.7).add(0.3)
    );
    const vignette = float(1).sub(smoothstep(0.6, 2.5, length(p)).mul(0.9));
    return vec4(max(color.mul(vignette), vec3(0)), 1);
  })();

export const presentPass = (u: ExperienceUniforms) =>
  Fn(() => {
    const p = uv();
    const color = u.surface.sample(p).rgb;
    const glow = u.bloom.sample(p).rgb;
    const colorWithGlow = color.add(glow.mul(0.25));
    return vec4(colorWithGlow.div(colorWithGlow.add(1)), 1);
  })();
export const bloomPass = (u: ExperienceUniforms) =>
  Fn(() => {
    const p = uv();
    const step = vec2(1 / 256, 1 / 144).mul(3);
    const c = u.surface
      .sample(p)
      .rgb.mul(0.2)
      .add(u.surface.sample(p.add(step)).rgb.mul(0.2))
      .add(u.surface.sample(p.sub(step)).rgb.mul(0.2))
      .add(u.surface.sample(p.add(vec2(step.x, step.y.negate()))).rgb.mul(0.2))
      .add(u.surface.sample(p.add(vec2(step.x.negate(), step.y))).rgb.mul(0.2));
    return vec4(max(c.sub(0.55), vec3(0)), 1);
  })();
