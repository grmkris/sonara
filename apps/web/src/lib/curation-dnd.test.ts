import { describe, expect, test } from "bun:test";

import { indexFromEdge, spliceReorder } from "./curation-dnd";

describe("spliceReorder", () => {
  const list = ["a", "b", "c", "d", "e"];

  test("single item forward", () => {
    // Drag "b" to after "d" (index 4 = before "e").
    expect(spliceReorder(list, ["b"], 4)).toEqual(["a", "c", "d", "b", "e"]);
  });

  test("single item backward", () => {
    expect(spliceReorder(list, ["d"], 1)).toEqual(["a", "d", "b", "c", "e"]);
  });

  test("drop on own position is a no-op", () => {
    expect(spliceReorder(list, ["c"], 2)).toEqual(list);
    expect(spliceReorder(list, ["c"], 3)).toEqual(list);
  });

  test("non-contiguous multi-drag keeps relative order as one block", () => {
    // Selection {b, d} dropped before "e" (index 4).
    expect(spliceReorder(list, ["b", "d"], 4)).toEqual([
      "a",
      "c",
      "b",
      "d",
      "e",
    ]);
  });

  test("multi-drag to the front", () => {
    expect(spliceReorder(list, ["c", "e"], 0)).toEqual([
      "c",
      "e",
      "a",
      "b",
      "d",
    ]);
  });

  test("draggedIds order is normalized by list order, not click order", () => {
    // Caller passes display-ordered ids; even if reversed, the block follows
    // the original list order.
    expect(spliceReorder(list, ["d", "b"], 0)).toEqual([
      "b",
      "d",
      "a",
      "c",
      "e",
    ]);
  });

  test("target index past the end appends", () => {
    expect(spliceReorder(list, ["a"], 99)).toEqual(["b", "c", "d", "e", "a"]);
  });
});

describe("indexFromEdge", () => {
  test("left edge inserts before, right edge after", () => {
    expect(indexFromEdge(2, "left")).toBe(2);
    expect(indexFromEdge(2, "right")).toBe(3);
  });
});
