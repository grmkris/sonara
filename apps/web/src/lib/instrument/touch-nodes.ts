import {
  abs,
  clamp,
  cos,
  exp,
  float,
  floor,
  Fn,
  fract,
  length,
  max,
  mix,
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

const gripWeight = (
  p: Node<"vec2">,
  grip: Node<"vec4">,
  touch: Node<"vec4">
) => {
  const delta = p.sub(grip.zw);
  return touch.x.div(max(pow(delta.dot(delta).mul(32), 2), 0.0001));
};
const influence = (p: Node<"vec2">, u: ExperienceUniforms) => {
  const a = gripWeight(p, u.grip1, u.touch1);
  const b = gripWeight(p, u.grip2, u.touch2);
  const total = max(a.add(b), 1);
  return vec2(a, b).div(total);
};
const imageUv = (u: ExperienceUniforms, p: Node<"vec2">) => {
  const fit = vec2(
    clamp(u.aspect.div(u.imageAspect), 0, 1),
    clamp(u.imageAspect.div(u.aspect), 0, 1)
  );
  return clamp(p.sub(0.5).mul(fit).add(0.5), 0.001, 0.999);
};
const picture = (u: ExperienceUniforms, p: Node<"vec2">) =>
  mix(
    u.oldImage.sample(imageUv(u, p)).rgb,
    u.image.sample(imageUv(u, p)).rgb,
    u.imageMix
  );
const tint = (u: ExperienceUniforms, phase: Node<"float">) =>
  mix(
    mix(u.color1, u.color2, sin(phase).mul(0.5).add(0.5)),
    u.color3,
    cos(phase.mul(0.7)).mul(0.2).add(0.2)
  );
const wave = (u: ExperienceUniforms, radius: Node<"float">) => {
  const delta = radius.sub(u.hit.x.mul(3.5));
  return sin(delta.mul(22))
    .mul(exp(abs(delta).mul(-6)))
    .mul(float(1).sub(u.hit.x))
    .mul(u.hit.y)
    .mul(u.response);
};

// New v4 surfaces. Older material graphs and their recorded appearances stay
// on their original paths. A held patch suppresses ambient motion locally.
export const loomSurface = (u: ExperienceUniforms) =>
  Fn(() => {
    const p = uv().sub(0.5).mul(vec2(u.aspect, 1)).mul(2);
    const holdA = exp(
      uv().sub(u.grip1.xy).dot(uv().sub(u.grip1.xy)).mul(-100)
    ).mul(u.touch1.z);
    const holdB = exp(
      uv().sub(u.grip2.xy).dot(uv().sub(u.grip2.xy)).mul(-100)
    ).mul(u.touch2.z);
    const held = clamp(holdA.add(holdB), 0, 1);
    const t = mix(
      u.motionTime,
      u.touch1.w
        .mul(holdA)
        .add(u.touch2.w.mul(holdB))
        .div(max(holdA.add(holdB), 0.001)),
      held
    );
    const moving = float(1).sub(held);
    const bass = u.music.y.mul(u.response).mul(moving);
    const bend = sin(p.x.mul(2.4).sub(t))
      .mul(0.065)
      .add(
        sin(p.x.mul(4).add(t.mul(1.7)))
          .mul(bass)
          .mul(0.22)
      );
    const ripple = wave(u, length(p)).mul(moving).mul(0.1);
    const spread = u.expansion.sub(0.5).mul(u.attachment).mul(0.5);
    const wovenY = p.y
      .add(u.velocity.sample(uv()).y.mul(moving).mul(0.08))
      .mul(float(1).sub(spread))
      .add(bend)
      .add(ripple)
      .sub(u.lift.mul(0.4));
    const row = floor(wovenY.mul(18));
    const within = fract(wovenY.mul(18)).sub(0.5);
    const width = float(0.44).sub(
      u.music.x.mul(u.response).mul(moving).mul(0.12)
    );
    const ribbon = float(1).sub(
      smoothstep(width.sub(0.035), width, abs(within))
    );
    const shade = cos(within.div(max(width, 0.1)).mul(Math.PI / 2))
      .mul(0.6)
      .add(0.4);
    const sheen = pow(
      max(sin(within.mul(3).add(p.x.mul(0.8)).sub(t.mul(0.2))), 0),
      18
    );
    const base = tint(u, row.mul(0.17).add(p.x).sub(t.mul(0.2)));
    const imagePoint = vec2(p.x.div(u.aspect), wovenY).mul(0.5).add(0.5);
    const color = mix(
      base,
      picture(u, imagePoint),
      u.imageActive.mul(u.revealAmount)
    );
    return vec4(
      color
        .mul(shade)
        .add(u.color3.mul(sheen).mul(0.45))
        .mul(ribbon)
        .add(base.mul(0.016))
        .mul(u.intensity.add(0.65)),
      1
    );
  })();

const depthAt = (u: ExperienceUniforms, p: Node<"vec2">) => {
  const depth = u.depth.sample(imageUv(u, p));
  return depth.r.mul(256 / 257).add(depth.g.mul(1 / 257));
};
export const reliefSurface = (u: ExperienceUniforms) =>
  Fn(() => {
    const p = uv();
    const q = p.sub(0.5).mul(vec2(u.aspect, 1));
    const procedural = sin(q.x.mul(8).add(u.motionTime))
      .mul(cos(q.y.mul(7).sub(u.motionTime.mul(0.7))))
      .mul(0.22)
      .add(0.5);
    const depth = mix(procedural, depthAt(u, p), u.depthActive);
    const tilt = u.center
      .mul(u.attachment)
      .mul(0.13)
      .add(
        vec2(sin(u.motionTime.mul(0.4)), cos(u.motionTime.mul(0.3))).mul(0.012)
      );
    const pulse = wave(u, length(q).mul(2));
    const parallax = tilt
      .mul(depth.sub(0.5))
      .add(q.mul(u.music.y.mul(u.response).mul(0.055).add(pulse.mul(0.018))));
    const samplePoint = p.add(parallax);
    const dx = depthAt(u, samplePoint.add(vec2(0.003, 0))).sub(
      depthAt(u, samplePoint.sub(vec2(0.003, 0)))
    );
    const dy = depthAt(u, samplePoint.add(vec2(0, 0.003))).sub(
      depthAt(u, samplePoint.sub(vec2(0, 0.003)))
    );
    const normal = normalize(vec3(dx.mul(-22), dy.mul(-22), 1));
    const light = normalize(
      vec3(
        u.center.x.mul(3).add(sin(u.motionTime.mul(0.4)).mul(0.5)),
        u.center.y.mul(3).add(0.7),
        1
      )
    );
    const diffuse = max(normal.dot(light), 0).mul(0.75).add(0.35);
    const specular = pow(
      max(normal.dot(normalize(light.add(vec3(0, 0, 1)))), 0),
      38
    ).mul(0.32);
    const iridescence = tint(
      u,
      depth.mul(9).add(normal.x.mul(3)).sub(u.motionTime.mul(0.3))
    );
    const color = mix(
      iridescence.mul(procedural.mul(0.8).add(0.2)),
      picture(u, samplePoint),
      u.imageActive.mul(u.revealAmount)
    );
    const shaded = color
      .mul(mix(float(1), diffuse, u.depthActive))
      .add(iridescence.mul(specular).mul(u.depthActive));
    return vec4(shaded.mul(u.intensity.add(0.55)), 1);
  })();

// One shared deformation pass: pin, two-point stretch, push/pull and damped
// release work across every material. Read and write targets are distinct.
export const touchSurface = (u: ExperienceUniforms) =>
  Fn(() => {
    const p = uv();
    const weights = influence(p, u);
    const offset = u.grip1.zw
      .sub(u.grip1.xy)
      .mul(weights.x)
      .add(u.grip2.zw.sub(u.grip2.xy).mul(weights.y));
    const pressureA = p
      .sub(u.grip1.zw)
      .mul(u.touch1.y)
      .mul(weights.x)
      .mul(0.55);
    const pressureB = p
      .sub(u.grip2.zw)
      .mul(u.touch2.y)
      .mul(weights.y)
      .mul(0.55);
    const point = clamp(
      p.sub(offset).sub(pressureA).sub(pressureB),
      0.001,
      0.999
    );
    const color = u.surface.sample(point).rgb;
    const edge = float(1).sub(
      smoothstep(0.45, 1.5, length(p.sub(0.5).mul(2))).mul(0.55)
    );
    const silhouette = u.mask.sample(
      vec2(float(1).sub(p.x), float(1).sub(p.y))
    ).r;
    const body = mix(float(1), silhouette.mul(0.8).add(0.2), u.maskActive);
    return vec4(color.mul(edge).mul(body), 1);
  })();
