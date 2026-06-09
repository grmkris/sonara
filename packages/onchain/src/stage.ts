import { formatUnits, parseAbi, parseUnits, stringToHex } from 'viem';
import type { Hex } from 'viem';

import { USDC_DECIMALS } from "./chain";

// SonaraStage — control-plane contract (see packages/contracts). Knob moves
// are free event-only calls; prompt() pulls `promptPriceUnits + tip` USDC from
// the sender, so the Prompt event carries the amounts (6-dec USDC units).
export const sonaraStageAbi = parseAbi([
  "event Nudge(bytes32 indexed room, address indexed who, uint8 knob, int16 delta)",
  "event Set(bytes32 indexed room, address indexed who, uint8 knob, uint16 value)",
  "event Prompt(bytes32 indexed room, address indexed who, string text, uint256 paid, uint256 tip)",
  "function nudge(bytes32 room, uint8 knob, int16 delta)",
  "function set(bytes32 room, uint8 knob, uint16 value)",
  "function prompt(bytes32 room, string text, uint256 tipUnits)",
  "function usdc() view returns (address)",
  "function treasury() view returns (address)",
  "function promptPriceUnits() view returns (uint256)",
]);

// The slice of the USDC (ERC-20) surface the writers/readers touch.
export const usdcAbi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 value) returns (bool)",
]);

// USDC amounts travel as 6-decimal integer units (1 USDC = 1_000_000). These
// convert at the UI boundary; throws on malformed input (viem parseUnits).
export const parseUsdc = (usdc: string): bigint =>
  parseUnits(usdc, USDC_DECIMALS);

export const formatUsdc = (units: bigint): string =>
  formatUnits(units, USDC_DECIMALS);

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
