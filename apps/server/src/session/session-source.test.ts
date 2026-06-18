import { afterAll, describe, expect, test } from "bun:test";

import { createLogger } from "@sonara/logger";
import { LISTED_DECK_KEYS, UNLISTED_DECK_KEYS } from "@sonara/shared";
import { typeIdGenerator, typeIdToUuid } from "@sonara/shared/typeid";
import type { LiveSessionId, UserId } from "@sonara/shared/typeid";

import { burstCadenceMs, freshCadenceFromStability, Session } from "./session";

// Unit tests for the source state machine: anon pinning, the anon playback guard, and producer-report adoption. The
// trigger() generation gate and goLive flows stay covered by the wider
// integration suites — they pull credits/fal and don't belong here.
const logger = createLogger({ level: "error", name: "test" });
const open: Session[] = [];

const makeSession = (userId: string | null): Session => {
  const s = new Session({
    id: "conn-test",
    liveSessionId: typeIdGenerator("liveSession") as LiveSessionId,
    logger,
    stageId: null,
    userId,
  });
  open.push(s);
  return s;
};

const signedIn = (): Session =>
  makeSession(typeIdToUuid(typeIdGenerator("user") as UserId).uuid);

afterAll(() => {
  for (const s of open) {
    s.close();
  }
});

describe("Session source state", () => {
  test("anon sessions are pinned to a random LISTED builtin set", () => {
    const s = makeSession(null);
    const source = s.getSource();
    expect(source.kind).toBe("set");
    if (source.kind === "set") {
      // Client-native pin: deckKey drives manifest playback, no DB id.
      expect(source.setId).toBeNull();
      const deckKey = source.deckKey ?? "";
      expect((LISTED_DECK_KEYS as readonly string[]).includes(deckKey)).toBe(
        true
      );
      expect((UNLISTED_DECK_KEYS as readonly string[]).includes(deckKey)).toBe(
        false
      );
    }
  });

  test("signed-in sessions start idle", () => {
    expect(signedIn().getSource()).toEqual({ kind: "idle" });
  });

  test("anon setSource ignores live/idle but accepts set", () => {
    const s = makeSession(null);
    s.setSource({ kind: "idle" });
    expect(s.getSource().kind).toBe("set");
    s.setSource({ kind: "live" });
    expect(s.getSource().kind).toBe("set");

    s.setSource({ deckKey: "noir", kind: "set", label: "Noir", setId: null });
    expect(s.getSource()).toEqual({
      deckKey: "noir",
      kind: "set",
      label: "Noir",
      setId: null,
    });
  });

  test("producer reports adopt into the source", () => {
    const s = signedIn();
    // Client-native builtin pick: deckKey-only, adopted with null setId.
    s.setCurrentSource({ deckKey: "cyborg", kind: "set", label: "Cyborg" });
    expect(s.getSource()).toEqual({
      deckKey: "cyborg",
      kind: "set",
      label: "Cyborg",
      setId: null,
    });

    s.setCurrentSource({ kind: "set", label: "my set", setId: "set_y" });
    expect(s.getSource()).toEqual({
      deckKey: null,
      kind: "set",
      label: "my set",
      setId: "set_y",
    });

    s.setCurrentSource({ kind: "live", label: null });
    expect(s.getSource()).toEqual({ kind: "live" });
  });

  test("a set report with neither id nor deckKey leaves the intent alone (stale client)", () => {
    const s = signedIn();
    s.setSource({ deckKey: "noir", kind: "set", label: "Noir", setId: null });
    s.setCurrentSource({ kind: "set", label: "Some Set" });
    expect(s.getSource()).toEqual({
      deckKey: "noir",
      kind: "set",
      label: "Noir",
      setId: null,
    });
  });

  test("anon ignores live/idle reports too", () => {
    const s = makeSession(null);
    const pinned = s.getSource();
    s.setCurrentSource({ kind: "live", label: null });
    expect(s.getSource()).toEqual(pinned);
  });

  test("snapshot carries the authoritative source", () => {
    const s = signedIn();
    s.setSource({ deckKey: "wild", kind: "set", label: "Wild", setId: null });
    expect(s.getControlSnapshot().source).toEqual({
      deckKey: "wild",
      kind: "set",
      label: "Wild",
      setId: null,
    });

    s.setSource({ kind: "idle" });
    expect(s.getControlSnapshot().source).toEqual({ kind: "idle" });
  });
});

describe("freshCadenceFromStability", () => {
  test("stability 0 → every frame fresh (never chains)", () => {
    expect(freshCadenceFromStability(0)).toBe(0);
  });

  test("stability 1 → 24 chained frames per fresh one", () => {
    expect(freshCadenceFromStability(1)).toBe(24);
  });

  test("interpolates and clamps", () => {
    expect(freshCadenceFromStability(0.5)).toBe(12);
    expect(freshCadenceFromStability(-1)).toBe(0);
    expect(freshCadenceFromStability(2)).toBe(24);
  });
});

describe("burstCadenceMs", () => {
  // Ambient cadence at low intensity is slow (~9s). The burst should override
  // it right after a prompt change, then fall back once the window passes.
  const SLOW = 9000;

  test("inside the burst window → fast burst cadence", () => {
    // now (1000) < morphBurstUntilAt (5000) → 900, not 9000
    expect(burstCadenceMs(SLOW, 1000, 5000)).toBe(900);
  });

  test("after the burst window → ambient cadence", () => {
    // now (6000) >= morphBurstUntilAt (5000) → back to the slow cadence
    expect(burstCadenceMs(SLOW, 6000, 5000)).toBe(SLOW);
  });

  test("never slows an already-fast ambient cadence", () => {
    // High-intensity ambient (500ms) is already quicker than the burst floor.
    expect(burstCadenceMs(500, 1000, 5000)).toBe(500);
  });

  test("unarmed (morphBurstUntilAt 0) → ambient cadence", () => {
    expect(burstCadenceMs(SLOW, 1000, 0)).toBe(SLOW);
  });
});
