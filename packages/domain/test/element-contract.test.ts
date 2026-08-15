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

  it("keeps the Phase 6 registry deterministic, real, and size-bounded", () => {
    expect(ELEMENT_DEFINITIONS.map(({ type }) => type)).toEqual(ELEMENT_TYPES);
    expect(ELEMENT_DEFINITIONS).toHaveLength(6);
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
  });
});
