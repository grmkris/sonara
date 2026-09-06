import type { PerformanceControlFrame } from "@sonara/shared";

const follow = (from: number, to: number, dt: number, tau: number) =>
  from + (to - from) * (1 - Math.exp(-dt / tau));

export const smoothControls = (
  previous: PerformanceControlFrame,
  target: PerformanceControlFrame,
  dt: number,
  age: number,
  time: number
): PerformanceControlFrame => {
  const fresh = age < 0.35;
  const points = fresh ? target.attractors : [];
  const identities = new Set([
    ...previous.attractors.map((p, i) => p.id ?? i),
    ...points.map((p, i) => p.id ?? i),
  ]);
  const attractors = [...identities]
    .toSorted()
    .flatMap((id) => {
      const from = previous.attractors.find((p, i) => (p.id ?? i) === id);
      const to = points.find((p, i) => (p.id ?? i) === id);
      const start = from ?? to ?? { force: 0, x: 0.5, y: 0.5 };
      const end = to ?? start;
      const force = follow(
        from?.force ?? 0,
        to?.force ?? 0,
        dt,
        to ? 0.045 : 0.18
      );
      if (Math.abs(force) < 0.005) {
        return [];
      }
      return [
        {
          force,
          id,
          x: follow(start.x, end.x, dt, 0.045),
          y: follow(start.y, end.y, dt, 0.045),
        },
      ];
    })
    .slice(0, 2);
  const angle = fresh && points.length === 2 ? target.rotation : 0;
  const delta = Math.atan2(
    Math.sin(angle - previous.rotation),
    Math.cos(angle - previous.rotation)
  );
  const rotation = previous.rotation + follow(0, delta, dt, 0.09);
  return {
    attractors,
    expansion: follow(
      previous.expansion,
      fresh ? target.expansion : 0.5,
      dt,
      0.09
    ),
    ...(target.lift !== undefined || previous.lift !== undefined
      ? {
          lift: follow(
            previous.lift ?? 0,
            fresh ? (target.lift ?? 0) : 0,
            dt,
            0.09
          ),
        }
      : {}),
    rotation: Math.atan2(Math.sin(rotation), Math.cos(rotation)),
    time,
  };
};
