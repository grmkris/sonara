import type {
  MaterialConfig,
  MusicalFrame,
  PerformanceControlFrame,
} from "@sonara/shared";
import { texture, uniform } from "three/tsl";
import {
  Color,
  HalfFloatType,
  LinearFilter,
  MeshBasicNodeMaterial,
  RenderTarget,
  Vector2,
  Vector3,
  Vector4,
} from "three/webgpu";
import type {
  Mesh,
  OrthographicCamera,
  Scene,
  Texture,
  WebGPURenderer,
} from "three/webgpu";

import { PALETTES } from "./catalog";
import { effectPass, isExtendedTreatment } from "./experience-effects";
import {
  bloomPass,
  curlPass,
  divergencePass,
  dyePass,
  flowPass,
  materialPass,
  presentPass,
  pressurePass,
  projectPass,
  vorticityPass,
} from "./experience-nodes";

const uniforms = (empty: Texture) => ({
  aspect: uniform(1),
  attachment: uniform(0),
  bloom: texture(empty),
  center: uniform(new Vector2()),
  color1: uniform(new Color()),
  color2: uniform(new Color()),
  color3: uniform(new Color()),
  curl: texture(empty),
  direction: uniform(new Vector4(1, 0, 0, 0)),
  divergence: texture(empty),
  dye: texture(empty),
  expansion: uniform(0.5),
  flow: uniform(0.45),
  gesture1: uniform(new Vector2()),
  gesture2: uniform(new Vector2()),
  hand1: uniform(new Vector3(0.5, 0.5, 0)),
  hand2: uniform(new Vector3(0.5, 0.5, 0)),
  image: texture(empty),
  imageActive: uniform(0),
  imageAspect: uniform(1),
  imageMix: uniform(1),
  intensity: uniform(0.55),
  lift: uniform(0),
  mask: texture(empty),
  maskActive: uniform(0),
  motionTime: uniform(0),
  music: uniform(new Vector4()),
  oldImage: texture(empty),
  pressure: texture(empty),
  response: uniform(0),
  revealAmount: uniform(0),
  rotation: uniform(0),
  surface: texture(empty),
  symmetry: uniform(0.15),
  texel: uniform(new Vector2(1 / 128, 1 / 128)),
  time: uniform(0),
  trails: uniform(0.55),
  treatment: uniform(1),
  velocity: texture(empty),
});
export type ExperienceUniforms = ReturnType<typeof uniforms>;
const other = (index: 0 | 1): 0 | 1 => (index === 0 ? 1 : 0);
const target = (width = 128, height = width) =>
  new RenderTarget(width, height, {
    depthBuffer: false,
    magFilter: LinearFilter,
    minFilter: LinearFilter,
    type: HalfFloatType,
  });
const material = (node: MeshBasicNodeMaterial["fragmentNode"]) => {
  const result = new MeshBasicNodeMaterial();
  result.fragmentNode = node;
  return result;
};

// One fluid field; no parallel world renderers. Draw is independent of simulation.
export class ExperienceLayer {
  readonly u: ExperienceUniforms;
  private velocity: [RenderTarget, RenderTarget] = [target(), target()];
  private pressure: [RenderTarget, RenderTarget] = [target(), target()];
  private pigment: [RenderTarget, RenderTarget] = [target(256), target(256)];
  private curl = target();
  private divergence = target();
  private surface = target(512, 288);
  private bloom = target(256, 144);
  private vi: 0 | 1 = 0;
  private pi: 0 | 1 = 0;
  private di: 0 | 1 = 0;
  private needsClear = true;
  private imageStarted = -10;
  private config: MaterialConfig;
  private passes: Record<
    | "flow"
    | "curl"
    | "vorticity"
    | "divergence"
    | "pressure"
    | "project"
    | "dye"
    | "material"
    | "bloom"
    | "present",
    MeshBasicNodeMaterial
  >;
  private pressureIterations = 10;
  private motionClock = 0;
  private previousTime = 0;
  readonly version: 2 | 3 | 4;
  constructor(empty: Texture, config: MaterialConfig) {
    this.version = config.version;
    this.u = uniforms(empty);
    this.config = config;
    const { u } = this;
    this.passes = {
      bloom: material(bloomPass(u)),
      curl: material(curlPass(u)),
      divergence: material(divergencePass(u)),
      dye: material(dyePass(u)),
      flow: material(flowPass(u)),
      material: material(
        effectPass(u, config.treatment) ?? materialPass(u, config.version === 3)
      ),
      present: material(presentPass(u)),
      pressure: material(pressurePass(u)),
      project: material(projectPass(u)),
      vorticity: material(vorticityPass(u)),
    };
    this.configure(config);
  }
  configure(config: MaterialConfig): void {
    if (
      this.config.treatment !== config.treatment &&
      (isExtendedTreatment(this.config.treatment) ||
        isExtendedTreatment(config.treatment))
    ) {
      this.passes.material.dispose();
      this.passes.material = material(
        effectPass(this.u, config.treatment) ??
          materialPass(this.u, config.version === 3)
      );
    }
    this.config = config;
    const { u } = this;
    u.response.value = config.version === 3 ? config.response : 0;
    u.flow.value = config.flow;
    u.intensity.value = config.intensity;
    u.symmetry.value = config.symmetry;
    u.trails.value = config.trails;
    u.treatment.value = ["ink", "silk", "prism"].indexOf(config.treatment);
    const colors = PALETTES[config.palette];
    u.color1.value.set(colors[0]);
    u.color2.value.set(colors[1]);
    u.color3.value.set(colors[2]);
  }
  setImage(image: Texture, previous: Texture | null): void {
    this.u.image.value = image;
    this.u.oldImage.value = previous ?? image;
    this.u.imageActive.value = 1;
    const size = image.image as { width: number; height: number };
    this.u.imageAspect.value = size.width / size.height;
    this.imageStarted = this.u.time.value;
  }
  clearImage(empty: Texture): void {
    this.u.image.value = empty;
    this.u.oldImage.value = empty;
    this.u.imageActive.value = 0;
  }
  setMask(mask: Texture, active: boolean): void {
    this.u.mask.value = mask;
    this.u.maskActive.value = active ? 1 : 0;
  }
  resize(width: number, height: number, _scale: number): void {
    this.u.aspect.value = width / height;
    this.surface.setSize(width, height);
  }
  reset(): void {
    this.needsClear = true;
    this.motionClock = 0;
    this.previousTime = 0;
    this.u.revealAmount.value = 0;
    this.u.gesture1.value.set(0, 0);
    this.u.gesture2.value.set(0, 0);
    this.u.hand1.value.set(0.5, 0.5, 0);
    this.u.hand2.value.set(0.5, 0.5, 0);
  }
  private updateMotion(
    time: number,
    music: MusicalFrame,
    controls: PerformanceControlFrame
  ): void {
    const { u } = this;
    if (this.config.version === 3) {
      const dt = Math.max(0, Math.min(0.05, time - this.previousTime));
      this.previousTime = time;
      const energy = Math.max(music.body, music.weight);
      this.motionClock +=
        dt * (0.012 + energy * (this.config.flow * 0.8 + 0.15));
      u.motionTime.value = this.motionClock + (this.config.seed % 997) * 0.01;
      const strength = controls.attractors.reduce(
        (sum, p) => sum + Math.abs(p.force),
        0
      );
      const center = { x: 0, y: 0 };
      for (const point of controls.attractors) {
        center.x += (point.x - 0.5) * Math.abs(point.force);
        center.y += (point.y - 0.5) * Math.abs(point.force);
      }
      u.attachment.value = Math.min(1, strength);
      u.center.value.set(
        center.x / Math.max(0.001, strength),
        controls.lift === undefined ? center.y / Math.max(0.001, strength) : 0
      );
      u.lift.value = controls.lift ?? 0;
      u.rotation.value = controls.rotation;
    }
  }
  private draw(
    renderer: WebGPURenderer,
    scene: Scene,
    camera: OrthographicCamera,
    quad: Mesh,
    pass: keyof ExperienceLayer["passes"],
    output: RenderTarget | null
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
    time: number,
    music: MusicalFrame,
    controls: PerformanceControlFrame
  ): void {
    const { u } = this;
    if (this.needsClear) {
      for (const rt of [
        ...this.velocity,
        ...this.pressure,
        ...this.pigment,
        this.curl,
        this.divergence,
      ]) {
        renderer.setRenderTarget(rt);
        renderer.clear();
      }
      this.needsClear = false;
    }
    u.time.value = time + (this.config.seed % 997) * 0.01;
    u.music.value.set(music.pulse, music.weight, music.brightness, music.body);
    u.direction.value.set(
      music.space,
      this.config.automatic ? music.tension : 0,
      this.config.automatic ? music.release : 0,
      music.confidence
    );
    u.expansion.value = controls.expansion;
    this.updateMotion(time, music, controls);
    for (const [i, hand] of [u.hand1, u.hand2].entries()) {
      const next = controls.attractors[i];
      const gesture = i === 0 ? u.gesture1 : u.gesture2;
      gesture.value.set(
        Math.max(
          -2,
          Math.min(2, ((next?.x ?? hand.value.x) - hand.value.x) * 60)
        ),
        Math.max(
          -2,
          Math.min(2, ((next?.y ?? hand.value.y) - hand.value.y) * 60)
        )
      );
      hand.value.set(
        next?.x ?? hand.value.x,
        next?.y ?? hand.value.y,
        next?.force ?? 0
      );
    }
    const reveal =
      this.config.reveal *
      (this.config.automatic
        ? Math.min(1, music.body * 0.75 + music.release * 0.6 + 0.45)
        : 1);
    u.revealAmount.value += (reveal - u.revealAmount.value) * 0.012;
    u.imageMix.value = Math.min(
      1,
      Math.max(0, (u.time.value - this.imageStarted) / 2)
    );
    u.velocity.value = this.velocity[this.vi].texture;
    this.draw(
      renderer,
      scene,
      camera,
      quad,
      "flow",
      this.velocity[other(this.vi)]
    );
    this.vi = other(this.vi);
    u.velocity.value = this.velocity[this.vi].texture;
    this.draw(renderer, scene, camera, quad, "curl", this.curl);
    u.curl.value = this.curl.texture;
    this.draw(
      renderer,
      scene,
      camera,
      quad,
      "vorticity",
      this.velocity[other(this.vi)]
    );
    this.vi = other(this.vi);
    u.velocity.value = this.velocity[this.vi].texture;
    this.draw(renderer, scene, camera, quad, "divergence", this.divergence);
    u.divergence.value = this.divergence.texture;
    for (let i = 0; i < this.pressureIterations; i += 1) {
      u.pressure.value = this.pressure[this.pi].texture;
      this.draw(
        renderer,
        scene,
        camera,
        quad,
        "pressure",
        this.pressure[other(this.pi)]
      );
      this.pi = other(this.pi);
    }
    u.pressure.value = this.pressure[this.pi].texture;
    this.draw(
      renderer,
      scene,
      camera,
      quad,
      "project",
      this.velocity[other(this.vi)]
    );
    this.vi = other(this.vi);
    u.velocity.value = this.velocity[this.vi].texture;
    u.dye.value = this.pigment[this.di].texture;
    this.draw(
      renderer,
      scene,
      camera,
      quad,
      "dye",
      this.pigment[other(this.di)]
    );
    this.di = other(this.di);
    u.dye.value = this.pigment[this.di].texture;
  }
  present(
    renderer: WebGPURenderer,
    scene: Scene,
    camera: OrthographicCamera,
    quad: Mesh,
    _time: number
  ): void {
    const { u } = this;
    this.draw(renderer, scene, camera, quad, "material", this.surface);
    u.surface.value = this.surface.texture;
    this.draw(renderer, scene, camera, quad, "bloom", this.bloom);
    u.bloom.value = this.bloom.texture;
    this.draw(renderer, scene, camera, quad, "present", null);
  }
  dispose(): void {
    for (const rt of [
      ...this.velocity,
      ...this.pressure,
      ...this.pigment,
      this.curl,
      this.divergence,
      this.surface,
      this.bloom,
    ]) {
      rt.dispose();
    }
    for (const pass of Object.values(this.passes)) {
      pass.dispose();
    }
  }
}
