import { describe, expect, it } from "vitest";

import {
  BATCH_LAYOUT_MODES,
  CANVAS_GRID,
  EDITABLE_BREAKPOINT,
  ELEMENT_DEFINITIONS,
  ELEMENT_PROPERTY_TABS,
  ELEMENT_RENDER_STATES,
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

  it("keeps the Phase 7 registry deterministic, real, and size-bounded", () => {
    expect(ELEMENT_DEFINITIONS.map(({ type }) => type)).toEqual(ELEMENT_TYPES);
    expect(ELEMENT_DEFINITIONS.length).toBeGreaterThanOrEqual(12);
    expect(ELEMENT_TYPES.slice(0, 6)).toEqual([
      "text",
      "button",
      "container",
      "kpi-card",
      "number-input",
      "data-table",
    ]);
    expect(ELEMENT_TYPES.slice(6, 12)).toEqual([
      "line-chart",
      "bar-chart",
      "histogram",
      "scatter-plot",
      "box-plot",
      "summary-statistics",
    ]);
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
      expect(definition.rendererKey).toBe(definition.type);
      expect(definition.editorRendererKey).toBe(definition.type);
      expect(definition.runtimeRendererKey).toBe(definition.type);
      expect(definition.validatorKey).toBe(definition.type);
      expect(definition.migrations).toEqual([]);
      const fieldIds = definition.propertySchema.fields.map(({ id }) => id);
      expect(new Set(fieldIds).size).toBe(fieldIds.length);
      expect(
        new Set(definition.propertySchema.fields.map(({ tab }) => tab)),
      ).toEqual(new Set(ELEMENT_PROPERTY_TABS.map(({ id }) => id)));
      expect(fieldIds).not.toContain("advanced.customCss");
      for (const target of ["props", "style"] as const) {
        const schemaKeys = definition.propertySchema.fields
          .filter((field) => field.target === target && !field.readOnly)
          .map(({ id }) => id.slice(id.indexOf(".") + 1))
          .sort();
        const persistedKeys = Object.keys(
          target === "props"
            ? definition.defaultProps
            : definition.defaultStyle,
        ).sort();
        expect(schemaKeys).toEqual(persistedKeys);
      }
      for (const port of definition.bindingPorts) {
        expect(port.side).toBe(port.direction === "input" ? "left" : "right");
      }
    }
    expect(
      ELEMENT_DEFINITIONS.find(({ type }) => type === "data-table")
        ?.supportedRenderStates,
    ).toEqual(ELEMENT_RENDER_STATES);
    for (const definition of ELEMENT_DEFINITIONS.slice(6, 12)) {
      expect(definition.category).toBe("statistics");
      expect(definition.supportedRenderStates).toEqual(ELEMENT_RENDER_STATES);
      expect(
        definition.bindingPorts.some(
          (port) =>
            port.required && port.direction === "input" && port.side === "left",
        ),
      ).toBe(true);
      expect(definition.defaultProps).toMatchObject({
        title: expect.any(String),
        emptyLabel: expect.any(String),
      });
      expect(definition.defaultProps).not.toHaveProperty("previewData");
      expect(definition.defaultProps).not.toHaveProperty("sampleData");
    }
    expect(
      ELEMENT_DEFINITIONS.find(({ type }) => type === "line-chart")
        ?.defaultProps,
    ).toMatchObject({ curve: "monotone", showLegend: true, showGrid: true });
    expect(
      ELEMENT_DEFINITIONS.find(({ type }) => type === "histogram")
        ?.defaultProps,
    ).toMatchObject({ binCount: 10, showGrid: true });
    expect(
      ELEMENT_DEFINITIONS.find(({ type }) => type === "scatter-plot")
        ?.defaultProps,
    ).toMatchObject({ showTrendline: false });
    expect(
      ELEMENT_DEFINITIONS.find(({ type }) => type === "box-plot")?.defaultProps,
    ).toMatchObject({ showOutliers: true });
    expect(
      ELEMENT_DEFINITIONS.find(({ type }) => type === "summary-statistics")
        ?.defaultProps,
    ).toMatchObject({
      precision: 2,
      showCount: true,
      showMean: true,
      showMedian: true,
      showStdDev: true,
      showMin: true,
      showMax: true,
    });
    expect(ELEMENT_TYPES.slice(12)).toEqual([
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
    for (const definition of ELEMENT_DEFINITIONS.slice(12)) {
      expect(definition.category).toBe("basic");
      expect(definition.supportedRenderStates).toEqual(["DATA"]);
    }
  });
});
