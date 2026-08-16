import { describe, expect, it } from "vitest";

import {
  clampMove,
  elementDefinition,
  elementBindingStatus,
  elementPropertyValues,
  elementRegistry,
  normalizeResize,
  rectanglesOverlap,
  resizeHandle,
  validateElementStoredState,
} from "../../src/elements/element-registry.js";

describe("element registry and grid geometry", () => {
  it("preserves the Phase 6/7 prefix and appends registered basic types", () => {
    const types = elementRegistry().definitions.map(({ type }) => type);
    expect(types.slice(0, 6)).toEqual([
      "text",
      "button",
      "container",
      "kpi-card",
      "number-input",
      "data-table",
    ]);
    expect(types.slice(0, 12)).toEqual([
      "text",
      "button",
      "container",
      "kpi-card",
      "number-input",
      "data-table",
      "line-chart",
      "bar-chart",
      "histogram",
      "scatter-plot",
      "box-plot",
      "summary-statistics",
    ]);
    expect(types.slice(12, 21)).toEqual([
      "heading",
      "divider",
      "image",
      "badge",
      "icon",
      "link",
      "spacer",
      "tabs",
      "accordion",
    ]);
    expect(types.slice(21, 32)).toEqual([
      "text-input",
      "text-area",
      "select",
      "multi-select",
      "checkbox",
      "radio",
      "switch",
      "date-picker",
      "date-range",
      "slider",
      "file-upload",
    ]);
    expect(types.slice(32, 38)).toEqual([
      "list",
      "tree",
      "pagination",
      "search",
      "filter",
      "detail-view",
    ]);
    expect(types.slice(38, 44)).toEqual([
      "heatmap",
      "distribution-plot",
      "control-chart",
      "pareto-chart",
      "gauge",
      "correlation-matrix",
    ]);
    expect(types.slice(44)).toEqual([
      "board",
      "comment",
      "chat",
      "file-list",
      "notification",
      "log-viewer",
      "menu",
      "breadcrumb",
      "page-link",
      "button-navigation",
      "tabs-navigation",
    ]);
    expect(elementRegistry().checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(elementDefinition("text").defaultProps).toMatchObject({
      internalName: "text",
      text: "Text",
    });
    expect(elementDefinition("button").defaultProps).toMatchObject({
      internalName: "button",
      label: "Button",
    });
    expect(elementDefinition("container").type).toBe("container");
    expect(elementDefinition("kpi-card").defaultProps).toMatchObject({
      label: "Value",
      value: "0",
    });
    expect(elementDefinition("number-input").category).toBe("input");
    expect(elementDefinition("data-table").category).toBe("data");
    for (const type of types.slice(6, 12)) {
      const definition = elementDefinition(type as never);
      expect(definition.category).toBe("statistics");
      expect(definition.supportedRenderStates).toEqual([
        "EMPTY",
        "LOADING",
        "ERROR",
        "DATA",
      ]);
      expect(
        definition.bindingPorts.some(
          (port) =>
            port.required && port.direction === "input" && port.side === "left",
        ),
      ).toBe(true);
    }
    for (const type of types.slice(12, 21)) {
      const definition = elementDefinition(type as never);
      expect(definition.category).toBe("basic");
      expect(definition.supportedRenderStates).toEqual(["DATA"]);
    }
    for (const type of types.slice(21, 32)) {
      const definition = elementDefinition(type as never);
      expect(definition.category).toBe("input");
      expect(definition.bindingPorts).toEqual([
        expect.objectContaining({ direction: "output", side: "right" }),
      ]);
    }
    for (const type of types.slice(32, 38)) {
      expect(elementDefinition(type as never).category).toBe("data");
    }
    for (const type of types.slice(38, 44)) {
      const definition = elementDefinition(type as never);
      expect(definition.category).toBe("statistics");
      expect(definition.bindingPorts).toEqual([
        expect.objectContaining({
          required: true,
          direction: "input",
          side: "left",
        }),
      ]);
    }
    for (const type of types.slice(44, 50)) {
      expect(elementDefinition(type as never).category).toBe("collaboration");
    }
    for (const type of types.slice(50)) {
      const definition = elementDefinition(type as never);
      expect(definition.category).toBe("navigation");
      expect(definition.events).toEqual([
        { id: "onNavigate", label: "Navigate" },
      ]);
    }
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

  it("keeps optional output ports unconnected without a false validation warning", () => {
    const button = elementDefinition("button");
    const table = elementDefinition("data-table");
    const entry = (definition: typeof button) => ({
      element: {
        id: "00000000-0000-4000-8000-000000000001",
        projectId: "00000000-0000-4000-8000-000000000002",
        pageId: "00000000-0000-4000-8000-000000000003",
        type: definition.type,
        typeVersion: 1 as const,
        name: definition.defaultName,
        props: definition.defaultProps,
        style: definition.defaultStyle,
        events: [],
        locked: false,
        hidden: false,
        revision: 1,
      },
      layout: {
        elementId: "00000000-0000-4000-8000-000000000001",
        breakpoint: "desktop" as const,
        x: 0,
        y: 0,
        w: definition.layout.defaultW,
        h: definition.layout.defaultH,
        minW: definition.layout.minW,
        minH: definition.layout.minH,
        maxW: definition.layout.maxW,
        maxH: definition.layout.maxH,
      },
    });
    expect(elementBindingStatus(button).status).toBe("UNCONNECTED");
    expect(
      elementPropertyValues(entry(button), button)["validation.status"],
    ).toBe("PASS");
    expect(
      elementPropertyValues(entry(table), table)["validation.status"],
    ).toBe("WARNING");
  });

  it("normalizes sparse v4 state and rejects unregistered or impossible persisted properties", () => {
    const text = elementDefinition("text");
    const normalized = validateElementStoredState(text, {
      props: { text: "Legacy" },
      style: {},
      events: [],
    });
    expect(normalized).toMatchObject({
      props: {
        internalName: "text",
        text: "Legacy",
        disabled: false,
      },
      style: {
        padding: 8,
        margin: 0,
        backgroundToken: "card",
        textColorToken: "foreground",
      },
      events: [],
    });
    expect(() =>
      validateElementStoredState(text, {
        props: { rows: [{ id: 1 }] },
        style: {},
        events: [],
      }),
    ).toThrow("not declared by the Registry");
    expect(() =>
      validateElementStoredState(elementDefinition("number-input"), {
        props: { defaultValue: 0, minimum: 100 },
        style: {},
        events: [],
      }),
    ).toThrow("default value must be within");
  });
});
