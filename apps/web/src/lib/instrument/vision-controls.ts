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
  time: number,
  identities: number[] = []
): PerformanceControlFrame => {
  const attractors = hands
    .flatMap((hand, index) => {
      const { 0: wrist, 4: thumb, 8: finger, 9: middle } = hand;
      if (!(wrist && middle && thumb && finger)) {
        return [];
      }
      const palm = Math.max(0.02, distance(wrist, middle));
      const pinch = 1 - clamp((distance(thumb, finger) / palm - 0.15) / 0.65);
      return [
        {
          force: 0.65 + pinch * 0.35,
          id: identities[index] ?? index,
          x: clamp(1 - middle.x),
          y: clamp(1 - middle.y),
        },
      ];
    })
    .slice(0, 2);
  if (attractors.length === 2 && attractors[0]?.id === attractors[1]?.id) {
    // A low-confidence handedness label must not merge two visible hands.
    const [, second] = attractors;
    if (second) {
      second.id = second.id === 0 ? 1 : 0;
    }
  }
  // Anatomical identity stays stable when hands cross or detection order changes.
  attractors.sort((a, b) => a.id - b.id);
  const [a, b] = attractors;
  const angle = a && b ? Math.atan2(b.y - a.y, b.x - a.x) : 0;
  return {
    attractors,
    expansion: a && b ? clamp(Math.hypot(a.x - b.x, a.y - b.y) * 1.5) : 0.5,
    rotation: Math.atan2(Math.sin(angle * 2), Math.cos(angle * 2)) / 2,
    time,
  };
};
const visible = (p: Landmark | undefined): p is Landmark =>
  !!p && (p.visibility ?? 0) > 0.6;
export const poseControls = (
  body: Landmark[],
  time: number
): PerformanceControlFrame => {
  const { 11: left, 12: right, 15: wristLeft, 16: wristRight } = body;
  if (!visible(left) || !visible(right)) {
    return { attractors: [], expansion: 0.5, lift: 0, rotation: 0, time };
  }
  const shoulder = Math.max(
    0.08,
    Math.hypot(left.x - right.x, left.y - right.y)
  );
  const center = { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 };
  const attractors = [wristLeft, wristRight].flatMap((p, id) =>
    visible(p)
      ? [
          {
            force: 0.8,
            id,
            x: clamp(0.5 - (p.x - center.x) / (shoulder * 4)),
            y: clamp(0.5 + (center.y - p.y) / (shoulder * 4)),
          },
        ]
      : []
  );
  const both = visible(wristLeft) && visible(wristRight);
  return {
    attractors,
    expansion: both
      ? clamp(
          (Math.hypot(wristLeft.x - wristRight.x, wristLeft.y - wristRight.y) /
            shoulder -
            0.5) /
            3
        )
      : 0.5,
    lift: both
      ? Math.max(
          -1,
          Math.min(1, (center.y - (wristLeft.y + wristRight.y) / 2) / shoulder)
        )
      : 0,
    rotation: 0,
    time,
  };
};
