import { parseAbi, stringToHex } from 'viem';
import type { Hex } from 'viem';

// SonaraStage — event-only control-plane contract (see packages/contracts).
export const sonaraStageAbi = parseAbi([
  "event Nudge(bytes32 indexed room, address indexed who, uint8 knob, int16 delta)",
  "event Set(bytes32 indexed room, address indexed who, uint8 knob, uint16 value)",
  "event Prompt(bytes32 indexed room, address indexed who, string text, uint256 tip)",
  "function nudge(bytes32 room, uint8 knob, int16 delta)",
  "function set(bytes32 room, uint8 knob, uint16 value)",
  "function prompt(bytes32 room, string text) payable",
]);

// The continuous scene knobs the chain can drive, in contract enum order. The
// names match ClientScenePatch fields in @sonara/shared so the listener can map
// a knob index straight onto a scene patch key.
export const STAGE_KNOBS = [
  "intensity",
  "softness",
  "surrealness",
  "abstraction",
  "stability",
] as const;

export type StageKnob = (typeof STAGE_KNOBS)[number];

export const knobIndex = (knob: StageKnob): number => STAGE_KNOBS.indexOf(knob);

export const knobFromIndex = (index: number): StageKnob | undefined =>
  STAGE_KNOBS[index];

// Continuous values travel on-chain as fixed-point ints in [0, 1000] meaning
// [0.0, 1.0] — Solidity has no floats. These convert at the wire boundary.
export const FIXED_POINT_SCALE = 1000;

export const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

export const toFixedPoint = (value01: number): number =>
  Math.round(clamp01(value01) * FIXED_POINT_SCALE);

export const fromFixedPoint = (fixed: number): number =>
  clamp01(fixed / FIXED_POINT_SCALE);

// Room binding: a short server-issued room code identifies one live session.
// We carry it as bytes32 (UTF-8, right-padded by stringToHex's `size`). Room
// codes are short ASCII (<= 31 bytes), so this is lossless and reversible.
export const roomToBytes32 = (room: string): Hex => stringToHex(room, { size: 32 });

export const bytes32ToRoom = (hex: Hex): string => {
  // Strip the 0x, drop trailing zero-byte padding, decode the ASCII.
  const bytes = hex.slice(2).replace(/(?<padding>00)+$/u, "");
  let out = "";
  for (let i = 0; i < bytes.length; i += 2) {
    out += String.fromCodePoint(Number.parseInt(bytes.slice(i, i + 2), 16));
  }
  return out;
};
