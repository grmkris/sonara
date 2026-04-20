export function damp(current: number, target: number, factor: number): number {
  return current + (target - current) * factor;
}
