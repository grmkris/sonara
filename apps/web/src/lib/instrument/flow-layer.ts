import {
  clamp,
  cos,
  float,
  Fn,
  max,
  mix,
  sin,
  smoothstep,
  texture,
  uniform,
  uv,
  vec2,
  vec4,
} from "three/tsl";
import {
  HalfFloatType,
  LinearFilter,
  MeshBasicNodeMaterial,
  RenderTarget,
} from "three/webgpu";
import type {
  Mesh,
  OrthographicCamera,
  Scene,
  Texture,
  WebGPURenderer,
} from "three/webgpu";

import type { ExperienceUniforms } from "./experience-renderer";

const target = (width: number, height: number) =>
  new RenderTarget(width, height, {
    depthBuffer: false,
    magFilter: LinearFilter,
    minFilter: LinearFilter,
    type: HalfFloatType,
  });
const material = (node: MeshBasicNodeMaterial["fragmentNode"]) => {
  const pass = new MeshBasicNodeMaterial();
  pass.fragmentNode = node;
  return pass;
};

// V5 only. History advances on the simulation clock, never on presentation.
// Fixed-size buffers keep capture, export and fast seek on the same path.
export class FlowLayer {
  readonly history;
  readonly sourceAspect = uniform(1);
  private source;
  private from;
  private progress = uniform(1);
  private fromAspect = uniform(1);
  private output = target(1024, 576);
  private snapshot = target(1024, 576);
  private echoes = [target(256, 192), target(256, 192)] as const;
  private echoIndex: 0 | 1 = 0;
  private passes: Record<"image" | "copy" | "echo", MeshBasicNodeMaterial>;
  private pending = false;
  private initialized = false;
  private hasImage = false;
  private clearEchoes = true;
  private startTime = 0;
  private lastAspect = 0;
  private u: ExperienceUniforms;
  constructor(u: ExperienceUniforms, empty: Texture) {
    this.u = u;
    this.source = texture(empty);
    this.from = texture(this.snapshot.texture);
    this.history = texture(this.echoes[0].texture);
    this.passes = {
      copy: material(texture(this.output.texture)),
      echo: material(
        Fn(() => {
          const p = uv();
          const drift = u.velocity
            .sample(p)
            .xy.mul(0.0008)
            .add(vec2(sin(p.y.mul(9).add(u.motionTime)).mul(0.0005), 0.0012));
          const old = this.history.sample(clamp(p.sub(drift), 0, 1)).r;
          const current = smoothstep(
            0.2,
            0.8,
            u.mask.sample(vec2(float(1).sub(p.x), float(1).sub(p.y))).r
          ).mul(u.maskActive);
          // Max, decay and a finite cutoff: overlapping people cannot blow out
          // exposure and missing people cannot leave a permanent ghost.
          return vec4(max(current, max(old.mul(0.987).sub(0.004), 0)), 0, 0, 1);
        })()
      ),
      image: material(
        Fn(() => {
          const p = uv();
          const t = this.progress;
          const envelope = sin(t.mul(Math.PI));
          const field = sin(
            p.x
              .mul(9)
              .add(cos(p.y.mul(8)))
              .add(t.mul(2))
          )
            .add(cos(p.y.mul(11).sub(p.x.mul(4)).sub(t)))
            .mul(0.5);
          const spread = t.mul(1.8).sub(0.4).add(field.mul(0.28));
          const blend = smoothstep(0, 1, spread);
          const flow = vec2(
            cos(p.y.mul(7).add(t.mul(2))),
            sin(p.x.mul(8).sub(t.mul(2)))
          )
            .mul(0.032)
            .add(clamp(u.velocity.sample(p).xy, -1, 1).mul(0.025))
            .mul(envelope)
            .mul(u.music.y.mul(u.response).mul(0.5).add(1));
          const fit = vec2(
            clamp(u.aspect.div(this.sourceAspect), 0, 1),
            clamp(this.sourceAspect.div(u.aspect), 0, 1)
          );
          const incoming = clamp(
            p
              .sub(flow.mul(float(1).sub(blend)))
              .sub(0.5)
              .mul(fit)
              .add(0.5),
            0.001,
            0.999
          );
          const fromFit = vec2(
            clamp(u.aspect.div(this.fromAspect), 0, 1),
            clamp(this.fromAspect.div(u.aspect), 0, 1)
          );
          const outgoing = clamp(
            p.add(flow.mul(blend)).sub(0.5).mul(fromFit).add(0.5),
            0.001,
            0.999
          );
          return vec4(
            mix(
              this.from.sample(outgoing).rgb,
              this.source.sample(incoming).rgb,
              blend
            ),
            1
          );
        })()
      ),
    };
  }
  setImage(image: Texture): void {
    this.source.value = image;
    const size = image.image as { width: number; height: number };
    this.sourceAspect.value = size.width / size.height;
    this.hasImage = true;
    this.pending = true;
  }
  clearImage(empty: Texture): void {
    this.source.value = empty;
    this.hasImage = false;
    this.initialized = false;
    this.pending = false;
  }
  reset(): void {
    this.clearEchoes = true;
    this.initialized = false;
    this.pending = this.hasImage;
  }
  private draw(
    renderer: WebGPURenderer,
    scene: Scene,
    camera: OrthographicCamera,
    quad: Mesh,
    pass: keyof FlowLayer["passes"],
    output: RenderTarget
  ): void {
    quad.material = this.passes[pass];
    renderer.setRenderTarget(output);
    renderer.render(scene, camera);
  }
  step(
    renderer: WebGPURenderer,
    scene: Scene,
    camera: OrthographicCamera,
    quad: Mesh,
    time: number
  ): void {
    if (this.clearEchoes) {
      for (const output of this.echoes) {
        renderer.setRenderTarget(output);
        renderer.clear();
      }
      this.clearEchoes = false;
    }
    const next = this.echoIndex === 0 ? 1 : 0;
    this.draw(renderer, scene, camera, quad, "echo", this.echoes[next]);
    this.echoIndex = next;
    this.history.value = this.echoes[next].texture;
    if (!this.hasImage) {
      return;
    }
    const redraw = this.pending;
    if (this.pending) {
      if (this.initialized) {
        // Freeze the current blend, including an interrupted A → B transition.
        this.draw(renderer, scene, camera, quad, "copy", this.snapshot);
        this.fromAspect.value = this.lastAspect || this.u.aspect.value;
      }
      this.startTime = this.initialized ? time : time - 3.2;
      this.pending = false;
      this.initialized = true;
    }
    const progress = Math.min(1, Math.max(0, (time - this.startTime) / 3.2));
    if (
      redraw ||
      progress < 1 ||
      this.progress.value < 1 ||
      this.lastAspect !== this.u.aspect.value
    ) {
      this.progress.value = progress;
      this.draw(renderer, scene, camera, quad, "image", this.output);
    }
    this.lastAspect = this.u.aspect.value;
    this.u.image.value = this.output.texture;
    this.u.oldImage.value = this.output.texture;
    this.u.imageMix.value = 1;
    this.u.imageAspect.value = this.u.aspect.value;
  }
  dispose(): void {
    for (const output of [this.output, this.snapshot, ...this.echoes]) {
      output.dispose();
    }
    for (const pass of Object.values(this.passes)) {
      pass.dispose();
    }
  }
}
