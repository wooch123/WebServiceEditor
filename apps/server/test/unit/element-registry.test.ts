import { describe, expect, it } from "vitest";

import {
  clampMove,
  elementDefinition,
  normalizeResize,
  rectanglesOverlap,
  resizeHandle,
} from "../../src/elements/element-registry.js";

describe("element registry and grid geometry", () => {
  it("exposes only the four real Phase 5 kernel elements", () => {
    expect(elementDefinition("text").defaultProps).toEqual({ text: "Text" });
    expect(elementDefinition("button").defaultProps).toEqual({
      label: "Button",
    });
    expect(elementDefinition("container").type).toBe("container");
    expect(elementDefinition("kpi-card").defaultProps).toEqual({
      label: "Value",
      value: "0",
    });
    expect(() => elementDefinition("chart")).toThrow("Element type is invalid");
  });

  it.each([
    ["n", { x: 8, y: 8, w: 6, h: 10 }],
    ["s", { x: 8, y: 10, w: 6, h: 10 }],
    ["e", { x: 8, y: 10, w: 8, h: 8 }],
    ["w", { x: 6, y: 10, w: 8, h: 8 }],
    ["ne", { x: 8, y: 8, w: 8, h: 10 }],
    ["nw", { x: 6, y: 8, w: 8, h: 10 }],
    ["se", { x: 8, y: 10, w: 8, h: 10 }],
    ["sw", { x: 6, y: 10, w: 8, h: 10 }],
  ] as const)("normalizes the %s resize handle", (handle, requested) => {
    expect(
      normalizeResize(
        { x: 8, y: 10, w: 6, h: 8 },
        { defaultW: 6, defaultH: 8, minW: 2, minH: 3, maxW: 10, maxH: 12 },
        resizeHandle(handle),
        requested,
      ),
    ).toEqual(requested);
  });

  it("clamps movement and resize to registry and Canvas boundaries", () => {
    expect(clampMove(-50, -2, { w: 6, h: 8 })).toEqual({
      x: 0,
      y: 0,
      w: 6,
      h: 8,
    });
    expect(clampMove(99, 4, { w: 6, h: 8 }).x).toBe(18);
    expect(() =>
      clampMove(Number.MAX_SAFE_INTEGER + 1, 4, { w: 6, h: 8 }),
    ).toThrow("Element layout must use integer grid units");
    expect(
      normalizeResize(
        { x: 8, y: 10, w: 6, h: 8 },
        { defaultW: 6, defaultH: 8, minW: 2, minH: 3, maxW: 10, maxH: 12 },
        "w",
        { x: -9, y: 10, w: 23, h: 8 },
      ),
    ).toEqual({ x: 4, y: 10, w: 10, h: 8 });
    expect(
      normalizeResize(
        { x: 8, y: 10, w: 6, h: 8 },
        { defaultW: 6, defaultH: 8, minW: 2, minH: 3, maxW: 10, maxH: 12 },
        "n",
        { x: 8, y: -10, w: 6, h: 28 },
      ),
    ).toEqual({ x: 8, y: 6, w: 6, h: 12 });
  });

  it("uses edge-touching no-overlap rectangles", () => {
    expect(
      rectanglesOverlap({ x: 0, y: 0, w: 4, h: 4 }, { x: 4, y: 0, w: 4, h: 4 }),
    ).toBe(false);
    expect(
      rectanglesOverlap({ x: 0, y: 0, w: 4, h: 4 }, { x: 3, y: 3, w: 4, h: 4 }),
    ).toBe(true);
  });
});
