import { afterEach, describe, expect, test } from "bun:test";

import { typeIdGenerator } from "@sonara/shared/typeid";

import { mintCode, stageRooms } from "./stage-rooms";

// stageRooms is a module-level singleton shared with every other test file in
// this process (lens.test.ts opens stages too), so each test uses fresh stage
// ids/codes and afterEach closes everything it opened.

const opened: string[] = [];

afterEach(() => {
  for (const room of opened) {
    stageRooms.close(room);
  }
  opened.length = 0;
});

describe("stageRooms", () => {
  test("mintCode mints 5-char codes from the unambiguous alphabet", () => {
    expect(mintCode()).toMatch(/^[ABCDEFGHJKMNPQRSTVWXYZ23456789]{5}$/u);
  });

  test("stage-keyed: opens under the permanent code, no minting", () => {
    const stageId = typeIdGenerator("stage");
    stageRooms.openForStage("QQQX7", stageId, true);
    opened.push("QQQX7");

    expect(stageRooms.roomForStage(stageId)).toBe("QQQX7");
    expect(stageRooms.resolve("QQQX7")).toEqual({
      allowPrompts: true,
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
