import { afterAll, describe, expect, test } from "bun:test";

import { createLogger } from "@sonara/logger";
import { LISTED_DECK_KEYS, UNLISTED_DECK_KEYS } from "@sonara/shared";
import { typeIdGenerator, typeIdToUuid } from "@sonara/shared/typeid";
import type { LiveSessionId, UserId } from "@sonara/shared/typeid";

import { freshCadenceFromStability, Session } from "./session";

// Unit tests for the source state machine (the demoMode/demoDeck successor):
// anon pinning, the anon playback guard, and producer-report adoption. The
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
  test("anon sessions are pinned to a random LISTED deck", () => {
    const s = makeSession(null);
    const source = s.getSource();
    expect(source.kind).toBe("deck");
    if (source.kind === "deck") {
      expect(LISTED_DECK_KEYS).toContain(source.deck);
      expect(UNLISTED_DECK_KEYS).not.toContain(source.deck);
    }
  });

  test("signed-in sessions start idle", () => {
    expect(signedIn().getSource()).toEqual({ kind: "idle" });
  });

  test("anon setSource ignores live/idle but accepts deck and set", () => {
    const s = makeSession(null);
    s.setSource({ kind: "idle" });
    expect(s.getSource().kind).toBe("deck");
    s.setSource({ kind: "live" });
    expect(s.getSource().kind).toBe("deck");

    s.setSource({ deck: "noir", kind: "deck" });
    expect(s.getSource()).toEqual({ deck: "noir", kind: "deck" });
    s.setSource({ kind: "set", label: "a cut", setId: "set_x" });
    expect(s.getSource().kind).toBe("set");
  });

  test("producer reports adopt into the source", () => {
    const s = signedIn();
    s.setCurrentSource({ deck: "cyborg", kind: "deck", label: "Cyborg" });
    expect(s.getSource()).toEqual({ deck: "cyborg", kind: "deck" });

    s.setCurrentSource({ kind: "set", label: "my set", setId: "set_y" });
    expect(s.getSource()).toEqual({
      kind: "set",
      label: "my set",
      setId: "set_y",
    });

    s.setCurrentSource({ kind: "live", label: null });
    expect(s.getSource()).toEqual({ kind: "live" });
  });

  test("a deck report without a key leaves the intent alone (stale client)", () => {
    const s = signedIn();
    s.setSource({ deck: "noir", kind: "deck" });
    s.setCurrentSource({ kind: "deck", label: "Some Deck" });
    expect(s.getSource()).toEqual({ deck: "noir", kind: "deck" });
  });

  test("anon ignores live/idle reports too", () => {
    const s = makeSession(null);
    const pinned = s.getSource();
    s.setCurrentSource({ kind: "live", label: null });
    expect(s.getSource()).toEqual(pinned);
  });

  test("snapshot carries source plus consistent derived shims", () => {
    const s = signedIn();
    s.setSource({ deck: "wild", kind: "deck" });
    const snap = s.getControlSnapshot();
    expect(snap.source).toEqual({ deck: "wild", kind: "deck" });
    expect(snap.demoMode).toBe(true);
    expect(snap.demoDeck).toBe("wild");

    s.setSource({ kind: "idle" });
    const idle = s.getControlSnapshot();
    expect(idle.demoMode).toBe(false);
    expect(idle.demoDeck).toBeNull();
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
