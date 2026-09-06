import type {
  AudioFeatureFrame,
  InstrumentConfig,
  PerformanceControlFrame,
  WorldSlot,
} from "@sonara/shared";
import { float, max, mix, texture, uniform, uv, vec2, vec4 } from "three/tsl";
import {
  Color,
  DataTexture,
  HalfFloatType,
  LinearFilter,
  Mesh,
  MeshBasicNodeMaterial,
  OrthographicCamera,
  PlaneGeometry,
  RedFormat,
  RenderTarget,
  RGBAFormat,
  Scene,
  TextureLoader,
  UnsignedByteType,
  WebGPURenderer,
} from "three/webgpu";
import type { Texture } from "three/webgpu";

import { PALETTES } from "./catalog";
import { makeUniforms, simulationNode, worldColor } from "./world-nodes";

const target = (size: number, floating = false) =>
  new RenderTarget(size, size, {
    depthBuffer: false,
    magFilter: LinearFilter,
    minFilter: LinearFilter,
    type: floating ? HalfFloatType : UnsignedByteType,
  });

// oxlint-disable max-classes-per-file -- REVIEW: deck resources are private implementation of the instance-owned renderer
class DeckRenderer {
  readonly uniforms: ReturnType<typeof makeUniforms>;
  private material = new MeshBasicNodeMaterial();
  private simulation: MeshBasicNodeMaterial | null = null;
  private state = [target(256, true), target(256, true)];
  private history = [target(512), target(512)];
  private stateIndex = 0;
  private historyIndex = 0;
  private world: WorldSlot["world"] | null = null;
  private look = -1;
  constructor(empty: Texture) {
    this.uniforms = makeUniforms(empty);
  }
  configure(slot: WorldSlot): void {
    const u = this.uniforms;
    u.macros.value.set(
      slot.macros.energy,
      slot.macros.flow,
      slot.macros.symmetry,
      slot.macros.trails
    );
    u.look.value = slot.look;
    if (this.world === slot.world && this.look === slot.look) {
      return;
    }
    this.world = slot.world;
    this.look = slot.look;
    this.material.dispose();
    this.material = new MeshBasicNodeMaterial();
    this.material.fragmentNode = worldColor(slot.world, u);
    this.simulation?.dispose();
    this.simulation = null;
    if (slot.world === "liquid" || slot.world === "mycelium") {
      this.simulation = new MeshBasicNodeMaterial();
      this.simulation.fragmentNode = simulationNode(slot.world, u);
    }
    this.reset();
  }
  reset(): void {
    this.uniforms.initialized.value = 0;
    for (const rt of [...this.state, ...this.history]) {
      rt.dispose();
    }
    this.stateIndex = 0;
    this.historyIndex = 0;
  }
  resize(width: number, height: number): void {
    for (const rt of this.history) {
      rt.setSize(width, height);
    }
    this.uniforms.aspect.value = width / height;
  }
  step(
    renderer: WebGPURenderer,
    scene: Scene,
    camera: OrthographicCamera,
    quad: Mesh
  ): Texture {
    const u = this.uniforms;
    if (this.simulation) {
      const iterations = this.world === "mycelium" ? 6 : 1;
      for (let i = 0; i < iterations; i += 1) {
        const read = this.state[this.stateIndex];
        const write = this.state[1 - this.stateIndex];
        if (!read || !write) {
          break;
        }
        u.state.value = read.texture;
        quad.material = this.simulation;
        renderer.setRenderTarget(write);
        renderer.render(scene, camera);
        this.stateIndex = 1 - this.stateIndex;
        u.initialized.value = 1;
      }
      u.state.value = this.state[this.stateIndex]?.texture ?? u.state.value;
    }
    const read = this.history[this.historyIndex];
    const write = this.history[1 - this.historyIndex];
    if (!read || !write) {
      throw new Error("missing world render target");
    }
    u.previous.value = read.texture;
    quad.material = this.material;
    renderer.setRenderTarget(write);
    renderer.render(scene, camera);
    this.historyIndex = 1 - this.historyIndex;
    return write.texture;
  }
  get output(): Texture {
    return (
      this.history[this.historyIndex]?.texture ?? this.uniforms.previous.value
    );
  }
  dispose(): void {
    this.material.dispose();
    this.simulation?.dispose();
    for (const rt of [...this.state, ...this.history]) {
      rt.dispose();
    }
  }
}

// Instance-owned: live display, Studio, and offline export use the same pipeline.
export class InstrumentRenderer {
  readonly canvas: HTMLCanvasElement;
  readonly backend: WebGPURenderer;
  private empty = new DataTexture(
    new Uint8Array([18, 15, 25, 255]),
    1,
    1,
    RGBAFormat
  );
  private mask = new DataTexture(new Uint8Array(1), 1, 1, RedFormat);
  private decks: [DeckRenderer, DeckRenderer];
  private scene = new Scene();
  private camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private geometry = new PlaneGeometry(2, 2);
  private composite = new MeshBasicNodeMaterial();
  private quad: Mesh;
  private a = texture(this.empty);
  private b = texture(this.empty);
  private blend = uniform(0);
  private additive = uniform(0);
  private masking = uniform(0);
  private maskSampler = texture(this.mask);
  private image: Texture | null = null;
  private loadId = 0;
  private disposed = false;
  private width = 0;
  private height = 0;
  private config: InstrumentConfig;
  onLost: (() => void) | null = null;
  onPresented: (() => void) | null = null;
  constructor(
    canvas: HTMLCanvasElement,
    config: InstrumentConfig,
    forceWebGL = false
  ) {
    this.canvas = canvas;
    this.config = config;
    this.empty.needsUpdate = true;
    this.mask.needsUpdate = true;
    this.backend = new WebGPURenderer({
      alpha: false,
      antialias: false,
      canvas,
      forceWebGL,
    });
    this.decks = [new DeckRenderer(this.empty), new DeckRenderer(this.empty)];
    const factor = mix(
      this.blend,
      this.maskSampler
        .sample(vec2(float(1).sub(uv().x), float(1).sub(uv().y)))
        .r.mul(this.blend),
      this.masking
    );
    const base = mix(this.a.rgb, this.b.rgb, factor);
    const added = this.a.rgb
      .mul(float(1).sub(this.blend).mul(0.5).add(0.5))
      .add(this.b.rgb.mul(this.blend));
    const color = mix(base, added, this.additive);
    // Soft highlight roll-off; all presentation effects live inside this canvas.
    this.composite.fragmentNode = vec4(color.div(max(color, 1)), 1);
    this.quad = new Mesh(this.geometry, this.composite);
    this.scene.add(this.quad);
    this.configure(config);
  }
  async init(): Promise<void> {
    await this.backend.init();
    if (this.disposed) {
      this.backend.dispose();
      return;
    }
    this.backend.onDeviceLost = () => {
      this.onLost?.();
    };
  }
  configure(config: InstrumentConfig): void {
    this.config = config;
    this.decks[0].configure(config.a);
    this.decks[1].configure(config.b);
    this.blend.value = config.crossfade;
    this.additive.value = config.blend === "add" ? 1 : 0;
    this.masking.value = config.blend === "mask" ? 1 : 0;
    const palette = PALETTES[config.palette];
    for (const deck of this.decks) {
      deck.uniforms.seed.value = config.seed;
      deck.uniforms.color1.value.copy(new Color(palette[0]));
      deck.uniforms.color2.value.copy(new Color(palette[1]));
      deck.uniforms.color3.value.copy(new Color(palette[2]));
    }
  }
  resize(width: number, height: number, scale = 1): void {
    const w = Math.max(2, Math.round(width * scale));
    const h = Math.max(2, Math.round(height * scale));
    if (w === this.width && h === this.height) {
      return;
    }
    this.width = w;
    this.height = h;
    this.backend.setSize(w, h, false);
    for (const deck of this.decks) {
      deck.resize(w, h);
    }
  }
  async setImage(url: string): Promise<void> {
    this.loadId += 1;
    const id = this.loadId;
    const image = await new TextureLoader().loadAsync(url);
    if (this.disposed || id !== this.loadId) {
      image.dispose();
      return;
    }
    this.image?.dispose();
    this.image = image;
    const element = image.image as { width: number; height: number };
    for (const deck of this.decks) {
      deck.uniforms.image.value = image;
      deck.uniforms.imageAspect.value = element.width / element.height;
    }
  }
  setMask(data: Uint8Array, width: number, height: number): void {
    if (this.mask.image.width !== width || this.mask.image.height !== height) {
      this.mask.dispose();
      this.mask = new DataTexture(data, width, height, RedFormat);
      this.maskSampler.value = this.mask;
      for (const deck of this.decks) {
        deck.uniforms.mask.value = this.mask;
      }
    } else {
      this.mask.image.data = data;
    }
    this.mask.needsUpdate = true;
    for (const deck of this.decks) {
      deck.uniforms.maskActive.value = 1;
    }
  }
  clearMask(): void {
    this.mask.image.data?.fill(0);
    this.mask.needsUpdate = true;
    for (const deck of this.decks) {
      deck.uniforms.maskActive.value = 0;
    }
  }
  step(
    time: number,
    audio: AudioFeatureFrame,
    control: PerformanceControlFrame
  ): void {
    for (const [i, deck] of this.decks.entries()) {
      if (
        this.config.blend === "mix" &&
        ((i === 0 && this.config.crossfade === 1) ||
          (i === 1 && this.config.crossfade === 0))
      ) {
        continue;
      }
      const u = deck.uniforms;
      u.time.value = time;
      u.audio.value.set(
        audio.features.bass,
        audio.features.mids,
        audio.features.treble,
        audio.features.rms
      );
      const [a, b] = control.attractors;
      u.hand1.value.set(a?.x ?? 0.5, a?.y ?? 0.5, a?.force ?? 0);
      u.hand2.value.set(b?.x ?? 0.5, b?.y ?? 0.5, b?.force ?? 0);
      u.expansion.value = control.expansion;
      u.rotation.value = control.rotation;
      deck.step(this.backend, this.scene, this.camera, this.quad);
    }
    this.a.value = this.decks[0].output;
    this.b.value = this.decks[1].output;
    this.quad.material = this.composite;
    this.backend.setRenderTarget(null);
    this.backend.render(this.scene, this.camera);
    this.onPresented?.();
  }
  reset(): void {
    for (const deck of this.decks) {
      deck.reset();
    }
  }
  dispose(): void {
    this.disposed = true;
    for (const deck of this.decks) {
      deck.dispose();
    }
    this.image?.dispose();
    this.empty.dispose();
    this.mask.dispose();
    this.composite.dispose();
    this.geometry.dispose();
    this.backend.dispose();
  }
}
