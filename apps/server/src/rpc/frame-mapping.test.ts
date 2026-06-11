import { beforeAll, describe, expect, mock, test } from "bun:test";

import { typeIdGenerator } from "@sonara/shared/typeid";
import type { ImageLibraryId, LiveSessionId } from "@sonara/shared/typeid";

import type {
  FrameRow,
  frameReadUrl as FrameReadUrlValue,
  rowToFrame as RowToFrameValue,
} from "./frame-mapping";

// presignReadUrl needs S3 env we don't have in tests — mock the bucket before
// frame-mapping loads.
mock.module("../storage/bucket", () => ({
  bucketKeyFromUrl: () => null,
  isConfigured: () => true,
  presignReadUrl: (key: string) => `https://signed.test/${key}`,
  uploadBytes: () => Promise.resolve(),
}));

let frameReadUrl: typeof FrameReadUrlValue;
let rowToFrame: typeof RowToFrameValue;

beforeAll(async () => {
  ({ frameReadUrl, rowToFrame } = await import("./frame-mapping"));
});

const makeRow = (overrides: Partial<FrameRow> = {}): FrameRow => ({
  anchorUrl: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  deck: "wild",
  height: 768,
  id: typeIdGenerator("imageLibrary") as ImageLibraryId,
  inspectorContext: null,
  palette: null,
  prompt: "test frame",
  sessionId: typeIdGenerator("liveSession") as LiveSessionId,
  tMs: 1234,
  triggerReason: null,
  url: "generated/usr/frame.webp",
  width: 768,
  ...overrides,
});

describe("frameReadUrl", () => {
  test("bare bucket key gets presigned", () => {
    expect(frameReadUrl("generated/usr/frame.webp")).toBe(
      "https://signed.test/generated/usr/frame.webp"
    );
  });

  test("origin-relative /library/... path passes through verbatim", () => {
    expect(frameReadUrl("/library/wild/img_test.webp")).toBe(
      "/library/wild/img_test.webp"
    );
  });

  test("absolute URL passes through verbatim", () => {
    expect(frameReadUrl("https://fal.cdn/frame.webp")).toBe(
      "https://fal.cdn/frame.webp"
    );
  });
});

describe("rowToFrame", () => {
  test("presigns the stored url and keeps a null anchorUrl null", () => {
    const frame = rowToFrame(makeRow());
    expect(frame.url).toBe("https://signed.test/generated/usr/frame.webp");
    expect(frame.anchorUrl).toBeNull();
  });

  test("anchorUrl gets the same shape handling as url", () => {
    const presigned = rowToFrame(makeRow({ anchorUrl: "anchors/a.webp" }));
    expect(presigned.anchorUrl).toBe("https://signed.test/anchors/a.webp");

    const absolute = rowToFrame(
      makeRow({ anchorUrl: "https://fal.cdn/anchor.webp" })
    );
    expect(absolute.anchorUrl).toBe("https://fal.cdn/anchor.webp");
  });

  test("null tMs / sessionId coalesce so the client never sees nulls", () => {
    const frame = rowToFrame(makeRow({ sessionId: null, tMs: null }));
    expect(frame.tMs).toBe(0);
    expect(frame.sessionId).toBe("" as LiveSessionId);
  });
});
