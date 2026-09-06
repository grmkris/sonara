import type { MaterialConfig } from "@sonara/shared";
import {
  abs,
  atan,
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
  mx_noise_float,
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

// Each effect has its own material graph. The existing Ink/Silk/Prism graph
// remains untouched, including when an old performance is replayed.
const coordinates = (u: ExperienceUniforms) => {
  const p = uv().sub(0.5).mul(vec2(u.aspect, 1)).mul(2);
  const center = u.center.mul(vec2(u.aspect, 1)).mul(u.attachment);
  const q = p.sub(center).sub(vec2(0, u.lift.mul(u.attachment).mul(0.65)));
  const angle = u.rotation.mul(u.attachment);
  const rotated = vec2(
    q.x.mul(cos(angle)).add(q.y.mul(sin(angle))),
    q.y.mul(cos(angle)).sub(q.x.mul(sin(angle)))
  );
  const breath = u.music.y.mul(0.18).add(u.music.x.mul(0.12)).mul(u.response);
  const stretch = u.expansion.sub(0.5).mul(u.attachment).mul(0.6);
  return rotated.mul(clamp(float(1).sub(breath).sub(stretch), 0.4, 1.5));
};
const tint = (u: ExperienceUniforms, phase: Node<"float">) =>
  mix(
    mix(u.color1, u.color2, sin(phase).mul(0.5).add(0.5)),
    u.color3,
    sin(phase.mul(0.63).add(2)).mul(0.25).add(0.25)
  );
const picture = (u: ExperienceUniforms, p: Node<"vec2">) => {
  const fit = vec2(
    clamp(u.aspect.div(u.imageAspect), 0, 1),
    clamp(u.imageAspect.div(u.aspect), 0, 1)
  );
  const imageUv = clamp(
    p.div(vec2(u.aspect, 1)).mul(fit).mul(0.5).add(0.5),
    0.001,
    0.999
  );
  return mix(
    u.oldImage.sample(imageUv).rgb,
    u.image.sample(imageUv).rgb,
    u.imageMix
  );
};
const finish = (u: ExperienceUniforms, color: Node<"vec3">) => {
  const silhouette = u.mask.sample(
    vec2(float(1).sub(uv().x), float(1).sub(uv().y))
  ).r;
  const body = mix(float(1), silhouette.mul(0.8).add(0.2), u.maskActive);
  const edge = float(1).sub(
    smoothstep(0.4, 1.45, length(uv().sub(0.5).mul(2))).mul(0.7)
  );
  return vec4(
    max(color.mul(body).mul(edge).mul(u.intensity.add(0.5)), vec3(0)),
    1
  );
};

const kaleido = (u: ExperienceUniforms) =>
  Fn(() => {
    const p = coordinates(u);
    const t = u.motionTime;
    const radius = length(p).add(0.001);
    const angle = atan(p.y, p.x).add(t.mul(0.13));
    const sector = Math.PI / 3;
    const folded = abs(fract(angle.div(sector)).sub(0.5)).mul(sector);
    const q = vec2(cos(folded), sin(folded)).mul(radius);
    const drift = vec2(sin(t.mul(0.35)), cos(t.mul(0.28))).mul(0.15);
    const bend = vec2(sin(radius.mul(3).sub(t)), cos(radius.mul(4).add(t))).mul(
      0.12
    );
    const cell = abs(fract(q.add(drift).add(bend).mul(3.4)).sub(0.5));
    const distance = cell.x.mul(0.7).add(cell.y);
    const ring = abs(
      sin(radius.mul(8).sub(t).add(u.music.x.mul(u.response).mul(1.5)))
    );
    const facets = pow(
      float(1).sub(smoothstep(0.02, 0.11, abs(distance.sub(0.29)))),
      2
    );
    const spokes = pow(max(cos(folded.mul(6)), 0), 18).mul(
      exp(radius.mul(-1.3))
    );
    const light = facets.mul(ring.mul(0.6).add(0.35)).add(spokes.mul(0.4));
    const base = tint(u, radius.mul(4).sub(t.mul(0.2))).mul(light.add(0.04));
    const photo = picture(u, q.mul(1.35).add(drift));
    const reveal = u.imageActive.mul(u.revealAmount);
    const color = mix(base, photo.mul(0.75).add(base.mul(0.6)), reveal);
    return finish(u, color.add(u.color3.mul(pow(light, 4)).mul(0.45)));
  })();

const loom = (u: ExperienceUniforms) =>
  Fn(() => {
    const p = coordinates(u);
    const t = u.motionTime;
    const flow = u.velocity.sample(uv()).xy;
    const wave = sin(p.x.mul(2.1).add(t))
      .mul(0.07)
      .add(
        sin(p.x.mul(4).sub(t.mul(0.7))).mul(u.music.y.mul(u.response).mul(0.06))
      );
    const wovenY = p.y.add(wave).add(flow.y.mul(0.12));
    const row = floor(wovenY.mul(22));
    const within = fract(wovenY.mul(22)).sub(0.5);
    const spread = u.attachment
      .mul(u.expansion)
      .mul(0.2)
      .add(u.music.x.mul(u.response).mul(0.11));
    const width = float(0.45).sub(spread);
    const thread = float(1).sub(
      smoothstep(width.sub(0.05), width, abs(within))
    );
    const drift = sin(row.mul(1.71).add(t.mul(0.7))).mul(
      u.attachment.mul(0.16).add(u.music.y.mul(u.response).mul(0.1)).add(0.025)
    );
    const imagePoint = vec2(p.x.add(drift).add(flow.x.mul(0.1)), wovenY);
    const shade = cos(within.div(max(width, 0.1)).mul(Math.PI / 2))
      .mul(0.5)
      .add(0.5);
    const sheen = pow(
      max(sin(within.mul(4).add(p.x.mul(0.7)).add(t.mul(0.2))), 0),
      14
    );
    const base = tint(u, row.mul(0.19).add(p.x).sub(t.mul(0.2)));
    const color = mix(
      base,
      picture(u, imagePoint),
      u.imageActive.mul(u.revealAmount)
    );
    return finish(
      u,
      color
        .mul(shade)
        .add(u.color3.mul(sheen).mul(0.4))
        .mul(thread)
        .add(base.mul(0.012))
    );
  })();

const stars = (p: Node<"vec2">, time: Node<"float">, scale: number) => {
  const grid = p.mul(scale);
  const cell = floor(grid);
  const point = fract(grid).sub(0.5);
  const light = float(0).toVar();
  for (let y = -1; y <= 1; y += 1) {
    for (let x = -1; x <= 1; x += 1) {
      const neighbor = vec2(x, y);
      const id = cell.add(neighbor);
      const random = fract(sin(id.dot(vec2(127.1, 311.7))).mul(43_758.5453));
      const shift = vec2(
        sin(random.mul(61).add(time)),
        cos(random.mul(39).sub(time.mul(0.7)))
      ).mul(0.32);
      const delta = point.sub(neighbor).sub(shift);
      const radius = random.mul(0.06).add(0.025);
      const core = exp(delta.dot(delta).div(radius.mul(radius)).negate());
      const glow = exp(delta.dot(delta).mul(-35)).mul(0.075);
      light.addAssign(core.add(glow).mul(random.mul(0.7).add(0.3)));
    }
  }
  return light;
};
const orbit = (u: ExperienceUniforms) =>
  Fn(() => {
    const p = coordinates(u);
    const t = u.motionTime;
    const radius = length(p);
    const spin = radius.mul(0.65).add(t.mul(0.18));
    const q = vec2(
      p.x.mul(cos(spin)).sub(p.y.mul(sin(spin))),
      p.x.mul(sin(spin)).add(p.y.mul(cos(spin)))
    );
    const flow = u.velocity.sample(uv()).xy;
    const field = q.add(flow.mul(0.6));
    const near = stars(field, t.mul(0.7), 11);
    const far = stars(field.mul(0.68).add(vec2(5.2, 3.7)), t.mul(0.3), 19).mul(
      0.4
    );
    const pulse = u.music.x.mul(u.response);
    const cloud = pow(
      max(mx_noise_float(vec3(q.mul(2.3), t.mul(0.12))).add(0.15), 0),
      3
    )
      .mul(exp(radius.mul(-0.8)))
      .mul(0.3);
    const base = tint(u, radius.mul(2).add(t.mul(0.1)));
    const color = mix(
      base,
      picture(u, p).mul(1.4),
      u.imageActive.mul(u.revealAmount)
    );
    return finish(
      u,
      color
        .mul(near.add(far).mul(pulse.mul(1.2).add(1.2)))
        .add(base.mul(cloud))
        .add(u.color3.mul(pow(near, 3)).mul(0.3))
    );
  })();

export const effectPass = (
  u: ExperienceUniforms,
  treatment: MaterialConfig["treatment"]
) => {
  switch (treatment) {
    case "kaleido": {
      return kaleido(u);
    }
    case "loom": {
      return loom(u);
    }
    case "orbit": {
      return orbit(u);
    }
    default: {
      return null;
    }
  }
};
export const isExtendedTreatment = (treatment: MaterialConfig["treatment"]) =>
  treatment === "kaleido" || treatment === "loom" || treatment === "orbit";
