import { afterEach, describe, expect, test } from "bun:test";

import { typeIdGenerator } from "@sonara/shared/typeid";

import { stageRooms } from "./stage-rooms";

// stageRooms is a module-level singleton shared with every other test file in
// this process (lens.test.ts opens stages too), so each test uses fresh
// liveSession ids and afterEach closes everything it opened.

const opened: string[] = [];

const openRoom = (liveSessionId: string, allowPrompts = true): string => {
  const room = stageRooms.open(liveSessionId, allowPrompts);
  opened.push(room);
  return room;
};

afterEach(() => {
  for (const room of opened) {
    stageRooms.close(room);
  }
  opened.length = 0;
});

describe("stageRooms", () => {
  test("open mints a 5-char code from the unambiguous alphabet", () => {
    const room = openRoom(typeIdGenerator("liveSession"));
    expect(room).toMatch(/^[ABCDEFGHJKMNPQRSTVWXYZ23456789]{5}$/u);
  });

  test("re-opening the same session keeps its code and updates allowPrompts", () => {
    const lse = typeIdGenerator("liveSession");
    const room = openRoom(lse, true);
    // Hide the QR first so re-open's reset is observable too.
    stageRooms.setShowQr(room, false);

    const again = stageRooms.open(lse, false);
    expect(again).toBe(room);
    expect(stageRooms.resolve(room)).toEqual({
      allowPrompts: false,
      liveSessionId: lse,
      showQr: true,
      stageId: null,
    });
  });

  test("roomFor / resolve round-trip the binding", () => {
    const lse = typeIdGenerator("liveSession");
    const room = openRoom(lse, false);
    expect(stageRooms.roomFor(lse)).toBe(room);
    expect(stageRooms.resolve(room)?.liveSessionId).toBe(lse);
    expect(stageRooms.statusFor(lse)).toEqual({
      allowPrompts: false,
      room,
      showQr: true,
    });
  });

  test("close unbinds both directions", () => {
    const lse = typeIdGenerator("liveSession");
    const room = openRoom(lse);
    stageRooms.close(room);
    expect(stageRooms.resolve(room)).toBeUndefined();
    expect(stageRooms.roomFor(lse)).toBeUndefined();
    expect(stageRooms.statusFor(lse)).toBeNull();
  });

  test("distinct sessions get distinct codes", () => {
    const roomA = openRoom(typeIdGenerator("liveSession"));
    const roomB = openRoom(typeIdGenerator("liveSession"));
    expect(roomA).not.toBe(roomB);
  });

  test("stage-keyed: opens under the permanent code, no minting", () => {
    const stageId = typeIdGenerator("stage");
    stageRooms.openForStage("QQQX7", stageId, true);
    opened.push("QQQX7");

    expect(stageRooms.roomForStage(stageId)).toBe("QQQX7");
    expect(stageRooms.resolve("QQQX7")).toEqual({
      allowPrompts: true,
      liveSessionId: null,
      showQr: true,
      stageId,
    });
    expect(stageRooms.statusForStage(stageId)).toEqual({
      allowPrompts: true,
      room: "QQQX7",
      showQr: true,
    });

    // Re-open refreshes flags + re-shows the QR; the code never changes.
    stageRooms.setShowQr("QQQX7", false);
    stageRooms.openForStage("QQQX7", stageId, false);
    expect(stageRooms.resolve("QQQX7")).toMatchObject({
      allowPrompts: false,
      showQr: true,
    });
  });

  test("stage-keyed close unbinds the stage direction + fires listeners", () => {
    const stageId = typeIdGenerator("stage");
    let closedRoom: string | null = null;
    stageRooms.onClose((room) => {
      closedRoom = room;
    });
    stageRooms.openForStage("QQQX8", stageId, true);
    stageRooms.close("QQQX8");
    expect(stageRooms.resolve("QQQX8")).toBeUndefined();
    expect(stageRooms.roomForStage(stageId)).toBeUndefined();
    expect(closedRoom).toBe("QQQX8" as never);
  });
});
