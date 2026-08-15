import { describe, expect, it } from "vitest";

import {
  BATCH_LAYOUT_MODES,
  CANVAS_GRID,
  EDITABLE_BREAKPOINT,
  ELEMENT_DEFINITIONS,
  ELEMENT_TYPES,
  RESIZE_HANDLES,
} from "../src/element.js";

describe("element canvas contract", () => {
  it("freezes the Phase 5 desktop grid and all resize handles", () => {
    expect(CANVAS_GRID).toEqual({
      columns: 24,
      rowHeight: 8,
      gap: 8,
      padding: 16,
    });
    expect(EDITABLE_BREAKPOINT).toBe("desktop");
    expect(RESIZE_HANDLES).toEqual([
      "n",
      "s",
      "e",
      "w",
      "ne",
      "nw",
      "se",
      "sw",
    ]);
    expect(BATCH_LAYOUT_MODES).toEqual(["COMPLETE", "PARTIAL"]);
  });

  it("keeps the kernel registry real, small, and size-bounded", () => {
    expect(ELEMENT_DEFINITIONS.map(({ type }) => type)).toEqual(ELEMENT_TYPES);
    expect(ELEMENT_DEFINITIONS).toHaveLength(4);
    expect(new Set(ELEMENT_TYPES).size).toBe(ELEMENT_TYPES.length);
    for (const definition of ELEMENT_DEFINITIONS) {
      expect(definition.typeVersion).toBe(1);
      expect(definition.layout.minW).toBeLessThanOrEqual(
        definition.layout.defaultW,
      );
      expect(definition.layout.defaultW).toBeLessThanOrEqual(
        definition.layout.maxW,
      );
      expect(definition.layout.minH).toBeLessThanOrEqual(
        definition.layout.defaultH,
      );
      expect(definition.layout.defaultH).toBeLessThanOrEqual(
        definition.layout.maxH,
      );
      expect(definition.layout.maxW).toBeLessThanOrEqual(CANVAS_GRID.columns);
      expect(definition.defaultProps).toBeTypeOf("object");
      expect(definition.defaultEvents).toEqual([]);
    }
  });
});
