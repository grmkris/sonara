import type { WorldId } from "@sonara/shared";
import {
  abs,
  atan,
  clamp,
  cos,
  exp,
  float,
  Fn,
  fract,
  If,
  length,
  Loop,
  max,
  min,
  mix,
  mod,
  mx_noise_float,
  normalize,
  pow,
  sin,
  smoothstep,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { Color, Vector2, Vector3, Vector4 } from "three/webgpu";
import type { Node, Texture } from "three/webgpu";

export const makeUniforms = (empty: Texture) => ({
  aspect: uniform(1),
  audio: uniform(new Vector4()),
  color1: uniform(new Color("#ffb85c")),
  color2: uniform(new Color("#ec5751")),
  color3: uniform(new Color("#7474ed")),
  expansion: uniform(0.5),
  hand1: uniform(new Vector3(0.5, 0.5, 0)),
  hand2: uniform(new Vector3(0.5, 0.5, 0)),
  image: texture(empty),
  imageAspect: uniform(1),
  initialized: uniform(0),
  look: uniform(0),
  macros: uniform(new Vector4(0.5, 0.4, 0.2, 0.6)),
  mask: texture(empty),
  maskActive: uniform(0),
  previous: texture(empty),
  rotation: uniform(0),
  seed: uniform(0),
  state: texture(empty),
  texel: uniform(new Vector2(1 / 256, 1 / 256)),
  time: uniform(0),
});
export type WorldUniforms = ReturnType<typeof makeUniforms>;

// All worlds share normalized control coordinates and linear color output.
export const worldColor = (world: WorldId, u: WorldUniforms) =>
  Fn(() => {
    const p = uv().sub(0.5).mul(vec2(u.aspect, 1)).mul(2).toVar();
    const radius = length(p).add(0.0001);
    const angle = atan(p.y, p.x).add(u.rotation);
    const sectors = u.macros.z.mul(9).add(1).floor();
    const foldedAngle = abs(
      mod(angle, float(Math.PI * 2).div(sectors)).sub(
        float(Math.PI).div(sectors)
      )
    );
    if (world !== "dream") {
      p.assign(
        mix(p, vec2(cos(foldedAngle), sin(foldedAngle)).mul(radius), u.macros.z)
      );
    }
    const surfaceUv = p.div(vec2(u.aspect, 1)).mul(0.5).add(0.5);
    const energy = u.macros.x.add(u.audio.x.mul(0.45));
    const flow = u.macros.y.mul(0.6).add(0.12);
    const t = u.time.mul(flow);
    const palette = (value: Node<"float">) =>
      mix(
        u.color1,
        mix(u.color2, u.color3, sin(value.mul(3)).mul(0.5).add(0.5)),
        value.fract()
      );
    const grain = fract(
      sin(uv().dot(vec2(127.1, 311.7)).add(u.time)).mul(43_758.5453)
    )
      .sub(0.5)
      .mul(0.018);
    const color = vec3(0).toVar();

    if (world === "liquid") {
      const state = u.state.sample(surfaceUv);
      const folds = mx_noise_float(
        vec3(p.mul(2.3).add(state.xy.mul(2)), t.mul(0.2))
      )
        .mul(2)
        .add(state.z.mul(2));
      const ribbons = pow(
        sin(folds.mul(u.audio.z.mul(2).add(8)).add(t))
          .mul(0.5)
          .add(0.5),
        5
      );
      const ink = smoothstep(0.05, 0.9, state.z.add(folds.mul(0.15)).add(0.3));
      color.assign(
        palette(fract(folds.mul(0.3).add(radius.mul(0.2)))).mul(
          ink.mul(0.75).add(ribbons.mul(energy).mul(1.4))
        )
      );
      color.addAssign(
        u.color3.mul(pow(abs(state.x).add(abs(state.y)), 1.4)).mul(0.4)
      );
    }
    if (world === "mycelium") {
      const growth = u.state.sample(surfaceUv).y;
      const neighbors = u.state.sample(surfaceUv.add(u.texel)).y;
      const edge = abs(growth.sub(neighbors)).mul(16);
      const lace = smoothstep(0.03, 0.25, growth);
      color.assign(
        palette(growth.mul(4).add(radius.mul(0.25))).mul(
          lace.mul(0.45).add(edge.mul(2))
        )
      );
      color.addAssign(
        u.color1
          .mul(pow(sin(growth.mul(55).add(t)).mul(0.5).add(0.5), 10))
          .mul(lace)
          .mul(energy)
      );
    }
    if (world === "cosmos") {
      const depth = float(0).toVar();
      Loop(6, ({ i }) => {
        const layer = float(i).add(1);
        const turn = mix(angle, foldedAngle, u.macros.z)
          .add(t.mul(0.12).mul(layer.mod(2).mul(2).sub(1)))
          .add(u.audio.y.mul(0.03));
        const swirl = turn.add(radius.mul(2.2).sub(t.mul(0.08)));
        const q = vec2(cos(swirl), sin(swirl))
          .mul(radius.mul(layer.mul(9).add(12)))
          .add(layer.mul(13.7));
        const cell = fract(q).sub(0.5);
        const id = q.floor();
        const random = fract(
          sin(id.dot(vec2(12.9898, 78.233)).add(u.seed)).mul(43_758.5453)
        );
        const star = exp(cell.dot(cell).mul(-120)).mul(
          smoothstep(0.4, 1, random)
        );
        const ring = exp(
          abs(radius.sub(layer.mul(0.12).add(u.expansion.mul(0.3)))).mul(-14)
        );
        depth.addAssign(star.mul(ring.add(0.12)).mul(2).div(layer.sqrt()));
      });
      const well1 = length(uv().sub(u.hand1.xy)).add(0.02);
      const well2 = length(uv().sub(u.hand2.xy)).add(0.02);
      const nebula = mx_noise_float(vec3(p.mul(2).add(t.mul(0.07)), t.mul(0.1)))
        .add(0.4)
        .max(0)
        .pow(3)
        .mul(0.15);
      color.assign(
        palette(radius.mul(0.3).add(angle.div(6.28))).mul(
          depth.mul(energy.add(0.6)).add(nebula)
        )
      );
      color.addAssign(
        u.color1.mul(
          u.hand1.z
            .abs()
            .mul(0.015)
            .div(well1)
            .add(u.hand2.z.abs().mul(0.015).div(well2))
        )
      );
    }
    if (world === "fractal") {
      const origin = vec3(0, 0, t.mul(0.4).add(u.audio.x.mul(0.12)));
      const direction = normalize(vec3(p.mul(0.7), 1));
      const distance = float(0.05).toVar();
      const glow = float(0).toVar();
      Loop(40, () => {
        const point = origin.add(direction.mul(distance)).toVar();
        point.xy.assign(
          vec2(
            cos(angle.add(distance.mul(0.12))),
            sin(angle.add(distance.mul(0.12)))
          ).mul(length(point.xy))
        );
        point.assign(abs(mod(point.add(1.5), 3).sub(1.5)));
        const scale = float(1).toVar();
        Loop(3, () => {
          point.assign(
            abs(point).sub(vec3(0.48, 0.56, 0.51).add(u.macros.z.mul(0.2)))
          );
          const k = float(1.2).div(max(point.dot(point), 0.2));
          point.mulAssign(k);
          scale.mulAssign(k);
        });
        const d = max(length(point).sub(0.7).div(scale), 0.004);
        glow.addAssign(
          exp(d.mul(-28))
            .mul(0.035)
            .mul(exp(distance.mul(-0.12)))
        );
        distance.addAssign(min(d, 0.25));
      });
      color.assign(
        palette(glow.mul(0.3).add(radius.mul(0.15)).add(u.look.mul(0.16)))
          .mul(glow)
          .mul(energy.add(0.7))
      );
    }
    if (world === "dream") {
      const folds = float(1).add(u.macros.z.mul(7)).floor();
      const folded = abs(
        mod(angle, float(Math.PI * 2).div(folds)).sub(float(Math.PI).div(folds))
      );
      const q = mix(
        p,
        vec2(cos(folded), sin(folded)).mul(radius),
        u.macros.z
      ).toVar();
      const wave = mx_noise_float(vec3(q.mul(2), t.mul(0.15)))
        .mul(energy)
        .mul(0.12);
      q.addAssign(
        vec2(sin(q.y.mul(4).add(t)), cos(q.x.mul(4).sub(t))).mul(wave)
      );
      const imageUv = q
        .mul(
          vec2(
            min(float(1), u.aspect.div(u.imageAspect)),
            min(float(1), u.imageAspect.div(u.aspect))
          )
        )
        .mul(0.42)
        .add(0.5);
      const photo = u.image.sample(clamp(imageUv, 0.001, 0.999)).rgb;
      const portal = pow(
        sin(radius.mul(14).sub(t).add(wave.mul(12)))
          .mul(0.5)
          .add(0.5),
        12
      ).mul(0.25);
      color.assign(
        photo
          .mul(0.9)
          .add(
            palette(radius.mul(0.25).add(wave)).mul(portal).mul(energy.add(0.3))
          )
      );
    }
    if (world === "mirror") {
      const silhouette = u.mask.sample(
        vec2(float(1).sub(surfaceUv.x), float(1).sub(surfaceUv.y))
      ).r;
      const adjacent = u.mask.sample(
        vec2(float(1).sub(surfaceUv.x), float(1).sub(surfaceUv.y)).add(
          u.texel.mul(3)
        )
      ).r;
      const outline = abs(silhouette.sub(adjacent)).mul(5);
      const fallback = smoothstep(0.7, 0.5, length(p.mul(vec2(1, 0.65))));
      const body = mix(fallback, silhouette, u.maskActive);
      const contours = pow(
        sin(body.mul(30).add(radius.mul(14)).sub(t.mul(2)))
          .mul(0.5)
          .add(0.5),
        9
      );
      const inside = mx_noise_float(vec3(p.mul(4).add(t.mul(0.15)), t.mul(0.2)))
        .mul(0.5)
        .add(0.5);
      color.assign(
        palette(inside.add(radius.mul(0.3))).mul(
          body
            .mul(inside)
            .mul(0.9)
            .add(outline)
            .add(contours.mul(body).mul(0.5))
        )
      );
    }
    const previousUv = uv()
      .sub(0.5)
      .mul(float(1).sub(u.macros.w.mul(0.002)))
      .add(0.5);
    const history = u.previous.sample(previousUv).rgb;
    color.assign(max(color, history.mul(u.macros.w.mul(0.12).add(0.86))));
    color.mulAssign(float(1).sub(smoothstep(0.3, 1.8, radius).mul(0.65)));
    return vec4(max(color.add(grain), vec3(0)), 1);
  })();

export const simulationNode = (
  world: "liquid" | "mycelium",
  u: WorldUniforms
) =>
  Fn(() => {
    const p = uv();
    const here = u.state.sample(p);
    const north = u.state.sample(p.add(vec2(0, u.texel.y)));
    const south = u.state.sample(p.sub(vec2(0, u.texel.y)));
    const east = u.state.sample(p.add(vec2(u.texel.x, 0)));
    const west = u.state.sample(p.sub(vec2(u.texel.x, 0)));
    const force1 = exp(p.sub(u.hand1.xy).dot(p.sub(u.hand1.xy)).mul(-180)).mul(
      u.hand1.z
    );
    const force2 = exp(p.sub(u.hand2.xy).dot(p.sub(u.hand2.xy)).mul(-180)).mul(
      u.hand2.z
    );
    if (world === "mycelium") {
      const diagonals = u.state
        .sample(p.add(u.texel))
        .xy.add(u.state.sample(p.sub(u.texel)).xy)
        .add(u.state.sample(p.add(vec2(u.texel.x, u.texel.y.negate()))).xy)
        .add(u.state.sample(p.add(vec2(u.texel.x.negate(), u.texel.y))).xy);
      const lap = north.xy
        .add(south.xy)
        .add(east.xy)
        .add(west.xy)
        .mul(0.2)
        .add(diagonals.mul(0.05))
        .sub(here.xy);
      const reaction = here.x.mul(here.y).mul(here.y);
      const feed = u.macros.x.mul(0.015).add(0.025);
      const kill = u.look.mul(0.002).add(0.059);
      const result = here.xy
        .add(
          vec2(
            lap.x.sub(reaction).add(feed.mul(float(1).sub(here.x))),
            lap.y.mul(0.5).add(reaction).sub(feed.add(kill).mul(here.y))
          )
        )
        .toVar();
      result.y.addAssign(abs(force1).add(abs(force2)).mul(0.025));
      If(u.initialized.lessThan(0.5), () => {
        const seed = smoothstep(
          0.86,
          0.9,
          sin(p.x.mul(67).add(u.seed))
            .mul(cos(p.y.mul(59)))
            .mul(0.5)
            .add(0.5)
        );
        result.assign(vec2(float(1).sub(seed.mul(0.5)), seed.mul(0.9)));
      });
      return vec4(clamp(result, 0, 1), 0, 1);
    }
    const velocity = here.xy;
    const advected = u.state.sample(
      clamp(p.sub(velocity.mul(0.008)), 0.001, 0.999)
    );
    const curl = vec2(
      cos(p.y.mul(12).add(u.time.mul(0.3))),
      sin(p.x.mul(10).sub(u.time.mul(0.2)))
    );
    const nextVelocity = advected.xy
      .mul(0.985)
      .add(
        north.xy
          .add(south.xy)
          .add(east.xy)
          .add(west.xy)
          .sub(velocity.mul(4))
          .mul(0.04)
      )
      .add(curl.mul(0.003).mul(u.macros.y.add(0.2)))
      .toVar();
    const d1 = p.sub(u.hand1.xy);
    const d2 = p.sub(u.hand2.xy);
    nextVelocity.addAssign(
      vec2(d1.y.negate(), d1.x)
        .mul(force1)
        .add(vec2(d2.y.negate(), d2.x).mul(force2))
        .mul(2)
    );
    const source = exp(
      length(
        p.sub(
          vec2(
            sin(u.time.mul(0.17)).mul(0.2).add(0.5),
            cos(u.time.mul(0.21)).mul(0.2).add(0.5)
          )
        )
      ).mul(-40)
    );
    const dye = advected.z
      .mul(0.996)
      .add(source.mul(u.audio.x.mul(0.12).add(0.018)))
      .add(abs(force1).add(abs(force2)).mul(0.018));
    return vec4(clamp(nextVelocity, -2, 2), clamp(dye, 0, 3), 1);
  })();
