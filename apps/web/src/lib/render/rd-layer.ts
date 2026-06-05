// Gray-Scott reaction-diffusion overlay layer.
//
// Runs a 2-species Gray-Scott simulation on a 256×256 ping-pong FBO pair.
// The R channel holds species U (feed substrate), G holds species V (growth).
// The main shader samples the output as an ink-density mask: bright-V areas
// darken the base image, producing slow organic blobs that breathe and merge
// on the paper surface.
//
// Why Gray-Scott: it's the most-studied reaction-diffusion model with known
// parameter "zones" (spots / stripes / holes / waves) depending on F and k.
// Feed rate F and kill rate k are exposed as uniforms so presets can pick a
// zone without changing shader code.
//
// Reference: Pearson's classification of Gray-Scott patterns, 1993.
// Standard zones:
//   F=0.037, k=0.060 → spots (default)
//   F=0.025, k=0.055 → wandering spots
//   F=0.014, k=0.054 → mitosis / cell division
//   F=0.029, k=0.057 → dissolution / holes
//
// Update rule (per substep, dt=1):
//   U' = U + Du*∇²U - U*V² + F*(1 - U)
//   V' = V + Dv*∇²V + U*V² - (F + k)*V
// with Du=1.0, Dv=0.5 (standard).

import { createFbo, createProgram, createShader } from "./webgl-util";
import type { Fbo, QuadBuffer } from "./webgl-util";

const RD_SIZE = 256;
const ITERATIONS_PER_FRAME = 6;

const VS = `#version 300 es
layout(location = 0) in vec2 aPos;
layout(location = 1) in vec2 aUv;
out vec2 vUv;
void main() {
  vUv = aUv;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

// Reset the simulation: fill U=1, V=0 everywhere. Used once at init and on
// session reset. The tiny cluster of random seeds below kick-starts evolution;
// without them the system sits dead at (1, 0) forever.
const RESET_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
float hash(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}
void main() {
  float n1 = hash(vUv * 9.0);
  float n2 = hash(vUv * 17.0 + 3.7);
  // Sparse seed: ~1% of pixels get a weak V seed so evolution can begin.
  float seed = step(0.985, n1) * step(0.5, n2);
  float V = seed * 0.5;
  float U = 1.0 - seed * 0.5;
  fragColor = vec4(U, V, 0.0, 1.0);
}
`;

// Stamp a seed disc at uSeedPos with soft falloff. Called on audio impulses.
// Only writes when uSeedStrength > 0 — otherwise passes the source through.
const SEED_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uSrc;
uniform vec2 uSeedPos;     // 0..1 UV
uniform float uSeedRadius; // 0..0.15 typical
uniform float uSeedStrength;
void main() {
  vec4 src = texture(uSrc, vUv);
  float d = distance(vUv, uSeedPos);
  float stamp = (1.0 - smoothstep(0.0, uSeedRadius, d)) * uSeedStrength;
  float U = src.r - stamp * 0.5;
  float V = src.g + stamp * 0.45;
  fragColor = vec4(clamp(U, 0.0, 1.0), clamp(V, 0.0, 1.0), 0.0, 1.0);
}
`;

// One Gray-Scott substep. Uses a 5-point Laplacian (cross stencil, not
// 9-point) — simpler and the pattern quality is indistinguishable at our
// resolution.
const UPDATE_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uSrc;
uniform vec2 uTexel;    // 1.0 / size
uniform float uFeed;
uniform float uKill;
uniform float uDt;
void main() {
  vec4 here = texture(uSrc, vUv);
  float U = here.r;
  float V = here.g;
  // 5-point Laplacian on each species.
  vec4 n = texture(uSrc, vUv + vec2(0.0,  uTexel.y));
  vec4 s = texture(uSrc, vUv - vec2(0.0,  uTexel.y));
  vec4 e = texture(uSrc, vUv + vec2(uTexel.x, 0.0));
  vec4 w = texture(uSrc, vUv - vec2(uTexel.x, 0.0));
  float lapU = n.r + s.r + e.r + w.r - 4.0 * U;
  float lapV = n.g + s.g + e.g + w.g - 4.0 * V;
  float Du = 1.0;
  float Dv = 0.5;
  float uvv = U * V * V;
  float dU = Du * lapU - uvv + uFeed * (1.0 - U);
  float dV = Dv * lapV + uvv - (uFeed + uKill) * V;
  U += dU * uDt;
  V += dV * uDt;
  fragColor = vec4(clamp(U, 0.0, 1.0), clamp(V, 0.0, 1.0), 0.0, 1.0);
}
`;

export interface RDFrameOpts {
  feed: number;
  kill: number;
  kickImpulse: number; // 0..1, rising edge seeds a dot
  rms: number;
}

export class RDLayer {
  private gl: WebGL2RenderingContext;
  private quad: QuadBuffer;
  private fboA: Fbo;
  private fboB: Fbo;
  private writeIsA = true;
  private resetProgram: WebGLProgram;
  private seedProgram: WebGLProgram;
  private updateProgram: WebGLProgram;
  private uni: {
    seed: {
      uSrc: WebGLUniformLocation | null;
      uSeedPos: WebGLUniformLocation | null;
      uSeedRadius: WebGLUniformLocation | null;
      uSeedStrength: WebGLUniformLocation | null;
    };
    update: {
      uSrc: WebGLUniformLocation | null;
      uTexel: WebGLUniformLocation | null;
      uFeed: WebGLUniformLocation | null;
      uKill: WebGLUniformLocation | null;
      uDt: WebGLUniformLocation | null;
    };
  };
  private prevKick = 0;

  constructor(gl: WebGL2RenderingContext, quad: QuadBuffer) {
    this.gl = gl;
    this.quad = quad;
    this.fboA = createFbo(gl, RD_SIZE, RD_SIZE);
    this.fboB = createFbo(gl, RD_SIZE, RD_SIZE);

    const vs = createShader(gl, gl.VERTEX_SHADER, VS);
    const resetFs = createShader(gl, gl.FRAGMENT_SHADER, RESET_FRAG);
    const seedFs = createShader(gl, gl.FRAGMENT_SHADER, SEED_FRAG);
    const updateFs = createShader(gl, gl.FRAGMENT_SHADER, UPDATE_FRAG);
    this.resetProgram = createProgram(gl, vs, resetFs);
    this.seedProgram = createProgram(gl, vs, seedFs);
    this.updateProgram = createProgram(gl, vs, updateFs);

    this.uni = {
      seed: {
        uSeedPos: gl.getUniformLocation(this.seedProgram, "uSeedPos"),
        uSeedRadius: gl.getUniformLocation(this.seedProgram, "uSeedRadius"),
        uSeedStrength: gl.getUniformLocation(this.seedProgram, "uSeedStrength"),
        uSrc: gl.getUniformLocation(this.seedProgram, "uSrc"),
      },
      update: {
        uDt: gl.getUniformLocation(this.updateProgram, "uDt"),
        uFeed: gl.getUniformLocation(this.updateProgram, "uFeed"),
        uKill: gl.getUniformLocation(this.updateProgram, "uKill"),
        uSrc: gl.getUniformLocation(this.updateProgram, "uSrc"),
        uTexel: gl.getUniformLocation(this.updateProgram, "uTexel"),
      },
    };

    this.reset();
  }

  reset(): void {
    const { gl } = this;
    gl.useProgram(this.resetProgram);
    gl.bindVertexArray(this.quad.vao);
    for (const fbo of [this.fboA, this.fboB]) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.fbo);
      gl.viewport(0, 0, fbo.width, fbo.height);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindVertexArray(null);
    this.writeIsA = true;
  }

  // Run one display-frame's worth of substeps (default 6). Returns the
  // texture holding the latest state.
  update(opts: RDFrameOpts): WebGLTexture {
    const { gl } = this;
    gl.bindVertexArray(this.quad.vao);

    // Rising-edge kick detection — seed a dot when kick crosses threshold.
    // Random UV so seeds accumulate into a scattered pattern.
    if (opts.kickImpulse > 0.3 && this.prevKick <= 0.3) {
      this.seedAt(Math.random(), Math.random(), 0.06, 1);
    }
    this.prevKick = opts.kickImpulse;

    gl.useProgram(this.updateProgram);
    gl.uniform2f(this.uni.update.uTexel, 1 / RD_SIZE, 1 / RD_SIZE);
    gl.uniform1f(this.uni.update.uFeed, opts.feed);
    gl.uniform1f(this.uni.update.uKill, opts.kill);
    gl.uniform1f(this.uni.update.uDt, 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(this.uni.update.uSrc, 0);

    for (let i = 0; i < ITERATIONS_PER_FRAME; i++) {
      const write = this.writeIsA ? this.fboA : this.fboB;
      const read = this.writeIsA ? this.fboB : this.fboA;
      gl.bindFramebuffer(gl.FRAMEBUFFER, write.fbo);
      gl.viewport(0, 0, write.width, write.height);
      gl.bindTexture(gl.TEXTURE_2D, read.tex);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      this.writeIsA = !this.writeIsA;
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindVertexArray(null);
    return this.getTexture();
  }

  // Current-state texture (the most recently written).
  getTexture(): WebGLTexture {
    // writeIsA flipped after the last write, so the latest state is in !writeIsA
    return this.writeIsA ? this.fboB.tex : this.fboA.tex;
  }

  private seedAt(x: number, y: number, radius: number, strength: number): void {
    const { gl } = this;
    const write = this.writeIsA ? this.fboA : this.fboB;
    const read = this.writeIsA ? this.fboB : this.fboA;
    gl.useProgram(this.seedProgram);
    gl.uniform2f(this.uni.seed.uSeedPos, x, y);
    gl.uniform1f(this.uni.seed.uSeedRadius, radius);
    gl.uniform1f(this.uni.seed.uSeedStrength, strength);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, read.tex);
    gl.uniform1i(this.uni.seed.uSrc, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, write.fbo);
    gl.viewport(0, 0, write.width, write.height);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    this.writeIsA = !this.writeIsA;
  }

  dispose(): void {
    const { gl } = this;
    gl.deleteFramebuffer(this.fboA.fbo);
    gl.deleteTexture(this.fboA.tex);
    gl.deleteFramebuffer(this.fboB.fbo);
    gl.deleteTexture(this.fboB.tex);
    gl.deleteProgram(this.resetProgram);
    gl.deleteProgram(this.seedProgram);
    gl.deleteProgram(this.updateProgram);
  }
}
