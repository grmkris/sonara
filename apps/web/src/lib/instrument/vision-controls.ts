import type { PerformanceControlFrame } from "@sonara/shared";

interface Landmark {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const distance = (a: Landmark, b: Landmark) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

export const handControls = (
  hands: Landmark[][],
  time: number
): PerformanceControlFrame => {
  const attractors = hands
    .flatMap((hand) => {
      const { 0: wrist, 4: thumb, 8: finger, 9: middle } = hand;
      if (!(wrist && middle && thumb && finger)) {
        return [];
      }
      const palm = Math.max(0.02, distance(wrist, middle));
      const pinch = 1 - clamp((distance(thumb, finger) / palm - 0.15) / 0.65);
      return [
        {
          force: 0.15 + pinch * 0.85,
          x: clamp(1 - middle.x),
          y: clamp(1 - middle.y),
        },
      ];
    })
    .slice(0, 2);
  // Spatial ordering avoids identity flips when MediaPipe changes detection order.
  attractors.sort((a, b) => a.x - b.x);
  const [a, b] = attractors;
  return {
    attractors,
    expansion: a && b ? clamp(Math.hypot(a.x - b.x, a.y - b.y) * 1.5) : 0.5,
    rotation: a && b ? Math.atan2(b.y - a.y, b.x - a.x) : 0,
    time,
  };
};
export const poseControls = (
  body: Landmark[],
  time: number
): PerformanceControlFrame => {
  const points = [body[15], body[16]].filter(
    (p): p is Landmark => !!p && (p.visibility ?? 0) > 0.6
  );
  const attractors = points.map((p) => ({
    force: 0.6,
    x: clamp(1 - p.x),
    y: clamp(1 - p.y),
  }));
  const [a, b] = attractors;
  return {
    attractors,
    expansion: a && b ? clamp(Math.hypot(a.x - b.x, a.y - b.y)) : 0.5,
    rotation: 0,
    time,
  };
};
