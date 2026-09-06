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
      const { 5: indexBase, 17: pinkyBase } = hand;
      const across =
        indexBase && pinkyBase
          ? {
              x: indexBase.x - pinkyBase.x,
              y: indexBase.y - pinkyBase.y,
              z: indexBase.z - pinkyBase.z,
            }
          : { x: 0, y: 0, z: 0 };
      const along = {
        x: middle.x - wrist.x,
        y: middle.y - wrist.y,
        z: middle.z - wrist.z,
      };
      const normal = {
        x: across.y * along.z - across.z * along.y,
        y: across.z * along.x - across.x * along.z,
        z: across.x * along.y - across.y * along.x,
      };
      const facing =
        Math.abs(normal.z) /
        Math.max(0.000_01, Math.hypot(normal.x, normal.y, normal.z));
      return [
        {
          facing: clamp(facing),
          force: 0.65 + pinch * 0.35,
          id: identities[index] ?? index,
          palm: clamp(Math.sqrt(Math.abs(normal.z))),
          pinch,
          tipX: clamp(1 - (thumb.x + finger.x) / 2),
          tipY: clamp(1 - (thumb.y + finger.y) / 2),
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

// People share the instrument. Average anatomical arm controls rather than
// attaching identities to MediaPipe's unstable person ordering.
export const groupControls = (
  bodies: Landmark[][],
  time: number
): PerformanceControlFrame => {
  const controls = bodies
    .slice(0, 3)
    .map((body) => poseControls(body, time))
    .filter((control) => control.attractors.length > 0);
  if (controls.length === 0) {
    return { attractors: [], expansion: 0.5, lift: 0, rotation: 0, time };
  }
  const attractors = [0, 1].flatMap((id) => {
    const points = controls.flatMap((control) =>
      control.attractors.filter((point) => point.id === id)
    );
    if (points.length === 0) {
      return [];
    }
    return [
      {
        force: 0.8,
        id,
        x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
        y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
      },
    ];
  });
  return {
    attractors,
    expansion:
      controls.reduce((sum, control) => sum + control.expansion, 0) /
      controls.length,
    lift:
      controls.reduce((sum, control) => sum + (control.lift ?? 0), 0) /
      controls.length,
    rotation: 0,
    time,
  };
};

export const unionMasks = (
  masks: { data: Float32Array; width: number; height: number }[],
  width: number,
  height: number
): Uint8Array<ArrayBuffer> => {
  const pixels = new Uint8Array(width * height);
  for (const mask of masks) {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index =
          Math.floor((y * mask.height) / height) * mask.width +
          Math.floor((x * mask.width) / width);
        const confidence = mask.data[index] ?? 0;
        pixels[y * width + x] = Math.max(
          pixels[y * width + x] ?? 0,
          Math.round(clamp(confidence) * 255)
        );
      }
    }
  }
  return pixels;
};
