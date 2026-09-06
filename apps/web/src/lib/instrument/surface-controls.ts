import type {
  Attractor,
  PerformanceControlFrame,
  SurfaceContact,
} from "@sonara/shared";

import { smoothControls } from "./smooth-controls";

const clamp = (value: number, min = 0, max = 1) =>
  Math.max(min, Math.min(max, value));
const follow = (from: number, to: number, dt: number, tau: number) =>
  from + (to - from) * (1 - Math.exp(-dt / tau));
interface Grip extends SurfaceContact {
  palm: number;
  facing: number;
  vx: number;
  vy: number;
}

// Inverse surface map, also used by the shader. Re-grabbing a displaced patch
// preserves its material coordinate rather than jumping back to screen space.
export const surfacePoint = (
  x: number,
  y: number,
  contacts: SurfaceContact[]
) => {
  let dx = 0;
  let dy = 0;
  let total = 0;
  for (const grip of contacts) {
    const distance = ((x - grip.x) ** 2 + (y - grip.y) ** 2) * 32;
    const weight = grip.strength / Math.max(0.0001, distance ** 2);
    total += weight;
    dx += (grip.x - grip.anchorX) * weight;
    dy += (grip.y - grip.anchorY) * weight;
  }
  const scale = Math.max(1, total);
  return { x: clamp(x - dx / scale), y: clamp(y - dy / scale) };
};
const palmScale = (point: Attractor) =>
  (point.palm ?? 0) / Math.sqrt(Math.max(0.65, point.facing ?? 1));

// Fixed-step physical contacts belong to the runtime, never React or MediaPipe.
// Only resolved contacts are recorded; replay needs neither camera nor inference.
export class SurfaceControls {
  private grips = new Map<number, Grip>();
  reset(): void {
    this.grips.clear();
  }
  step(
    previous: PerformanceControlFrame,
    input: PerformanceControlFrame,
    age: number,
    time: number,
    dt = 1 / 60
  ): PerformanceControlFrame {
    const result = smoothControls(previous, input, dt, age, time);
    const points = age < 0.35 ? input.attractors : [];
    for (const id of [0, 1]) {
      const point = points.find((p, index) => (p.id ?? index) === id);
      let grip = this.grips.get(id);
      const held = !!point && (point.pinch ?? 0) > (grip?.held ? 0.42 : 0.72);
      if (held && point) {
        const x = point.tipX ?? point.x;
        const y = point.tipY ?? point.y;
        if (!grip?.held) {
          const anchor = surfacePoint(x, y, [...this.grips.values()]);
          grip = {
            anchorX: anchor.x,
            anchorY: anchor.y,
            facing: point.facing ?? 1,
            held: true,
            id,
            palm: (point.facing ?? 1) >= 0.65 ? palmScale(point) : 0,
            pressure: 0,
            strength: 1,
            vx: 0,
            vy: 0,
            x,
            y,
          };
          this.grips.set(id, grip);
        }
        SurfaceControls.hold(grip, point, x, y, dt);
      } else if (grip) {
        grip.held = false;
        grip.vx += (-(grip.x - grip.anchorX) * 32 - grip.vx * 7) * dt;
        grip.vy += (-(grip.y - grip.anchorY) * 32 - grip.vy * 7) * dt;
        grip.x = clamp(grip.x + grip.vx * dt);
        grip.y = clamp(grip.y + grip.vy * dt);
        grip.pressure = follow(grip.pressure, 0, dt, 0.22);
        grip.strength *= Math.exp(-dt / 0.65);
        if (grip.strength < 0.005) {
          this.grips.delete(id);
        }
      }
    }
    return {
      ...result,
      contacts: [...this.grips.values()].map((grip) => ({
        anchorX: grip.anchorX,
        anchorY: grip.anchorY,
        held: grip.held,
        id: grip.id,
        pressure: grip.pressure,
        strength: grip.strength,
        x: grip.x,
        y: grip.y,
      })),
    };
  }
  private static hold(
    grip: Grip,
    point: Attractor,
    x: number,
    y: number,
    dt: number
  ): void {
    const nextX = follow(grip.x, x, dt, 0.025);
    const nextY = follow(grip.y, y, dt, 0.025);
    grip.vx = clamp((nextX - grip.x) / dt, -1.8, 1.8);
    grip.vy = clamp((nextY - grip.y) / dt, -1.8, 1.8);
    grip.x = nextX;
    grip.y = nextY;
    const facing = point.facing ?? 1;
    // Palm area is a relative push/pull proxy, not MediaPipe's wrist-relative Z.
    // Edge-on or strongly turned hands cannot supply a trustworthy distance.
    if (facing >= 0.65 && (point.palm ?? 0) > 0.025) {
      if (!grip.palm) {
        grip.palm = palmScale(point);
        grip.facing = facing;
      }
      if (Math.abs(facing - grip.facing) < 0.18) {
        const pressure = clamp(
          Math.log(palmScale(point) / grip.palm) / Math.log(1.8),
          -1,
          1
        );
        grip.pressure = follow(grip.pressure, pressure, dt, 0.1);
      }
    }
  }
}
