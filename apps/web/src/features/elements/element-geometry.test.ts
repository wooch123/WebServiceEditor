import { afterEach, describe, expect, it, vi } from "vitest";
import { ELEMENT_DEFINITIONS } from "@webeditor/domain";

import type {
  ElementLayoutDto,
  PlacementCandidateDto,
} from "@/services/elements-api";
import { elementDefinitionSizeLabel } from "./element-definitions";
import {
  CANVAS_PADDING,
  CANVAS_ZOOM_LEVELS,
  DESKTOP_COLUMNS,
  GRID_GAP,
  GRID_ROW_HEIGHT,
  gridColumnWidth,
  gridToPixelRect,
  normalizeCanvasPointer,
  placementCandidateIsFresh,
  placementMatchesLayout,
  snapPlacementCell,
} from "./element-geometry";

afterEach(() => {
  vi.useRealTimers();
});

describe("Phase 5 canvas contract", () => {
  it("pins the desktop grid, zoom matrix, and kernel registry", () => {
    expect({
      columns: DESKTOP_COLUMNS,
      rowHeight: GRID_ROW_HEIGHT,
      gap: GRID_GAP,
      padding: CANVAS_PADDING,
    }).toEqual({ columns: 24, rowHeight: 8, gap: 8, padding: 16 });
    expect(CANVAS_ZOOM_LEVELS).toEqual([0.5, 0.75, 1, 1.25, 1.5, 2]);
    expect(
      ELEMENT_DEFINITIONS.map((definition) => ({
        type: definition.type,
        defaultSizeLabel: elementDefinitionSizeLabel(definition),
      })),
    ).toEqual([
      { type: "text", defaultSizeLabel: "6 × 5" },
      { type: "button", defaultSizeLabel: "4 × 5" },
      { type: "container", defaultSizeLabel: "12 × 12" },
      { type: "kpi-card", defaultSizeLabel: "6 × 10" },
      { type: "number-input", defaultSizeLabel: "6 × 7" },
      { type: "data-table", defaultSizeLabel: "12 × 16" },
      { type: "line-chart", defaultSizeLabel: "12 × 18" },
      { type: "bar-chart", defaultSizeLabel: "12 × 18" },
      { type: "histogram", defaultSizeLabel: "12 × 18" },
      { type: "scatter-plot", defaultSizeLabel: "12 × 18" },
      { type: "box-plot", defaultSizeLabel: "12 × 18" },
      { type: "summary-statistics", defaultSizeLabel: "8 × 14" },
      { type: "heading", defaultSizeLabel: "10 × 5" },
      { type: "divider", defaultSizeLabel: "12 × 3" },
      { type: "image", defaultSizeLabel: "8 × 12" },
      { type: "badge", defaultSizeLabel: "4 × 4" },
      { type: "icon", defaultSizeLabel: "3 × 5" },
      { type: "link", defaultSizeLabel: "5 × 4" },
      { type: "spacer", defaultSizeLabel: "6 × 4" },
      { type: "tabs", defaultSizeLabel: "12 × 12" },
      { type: "accordion", defaultSizeLabel: "12 × 14" },
      { type: "text-input", defaultSizeLabel: "6 × 7" },
      { type: "text-area", defaultSizeLabel: "8 × 12" },
      { type: "select", defaultSizeLabel: "6 × 7" },
      { type: "multi-select", defaultSizeLabel: "7 × 12" },
      { type: "checkbox", defaultSizeLabel: "5 × 5" },
      { type: "radio", defaultSizeLabel: "7 × 10" },
      { type: "switch", defaultSizeLabel: "5 × 5" },
      { type: "date-picker", defaultSizeLabel: "6 × 7" },
      { type: "date-range", defaultSizeLabel: "10 × 10" },
      { type: "slider", defaultSizeLabel: "7 × 7" },
      { type: "file-upload", defaultSizeLabel: "8 × 7" },
    ]);
  });

  it("corrects viewport, scroll, canvas offset, and zoom exactly", () => {
    expect(
      normalizeCanvasPointer({
        clientX: 350,
        clientY: 260,
        viewportLeft: 100,
        viewportTop: 80,
        scrollLeft: 90,
        scrollTop: 54,
        canvasOffsetLeft: 20,
        canvasOffsetTop: 10,
        zoom: 2,
      }),
    ).toEqual({
      rawCanvasX: 250,
      rawCanvasY: 180,
      correctedCanvasX: 160,
      correctedCanvasY: 112,
    });
  });

  it.each(CANVAS_ZOOM_LEVELS)(
    "keeps scroll and canvas offsets stable at %s zoom",
    (zoom) => {
      const pointer = normalizeCanvasPointer({
        clientX: 420,
        clientY: 320,
        viewportLeft: 120,
        viewportTop: 80,
        scrollLeft: 96,
        scrollTop: 64,
        canvasOffsetLeft: 48,
        canvasOffsetTop: 16,
        zoom,
      });
      expect(pointer.rawCanvasX).toBe(300);
      expect(pointer.rawCanvasY).toBe(240);
      expect(pointer.correctedCanvasX).toBeCloseTo(348 / zoom, 8);
      expect(pointer.correctedCanvasY).toBeCloseTo(288 / zoom, 8);
    },
  );

  it("uses one grid-to-pixel transform for preview and placed geometry", () => {
    const canvasWidth = 1200;
    const column = gridColumnWidth(canvasWidth);
    expect(column).toBe(41);
    expect(gridToPixelRect({ x: 4, y: 12, w: 8, h: 10 }, canvasWidth)).toEqual({
      left: 212,
      top: 208,
      width: 384,
      height: 152,
    });

    const layout: ElementLayoutDto = {
      elementId: "element-1",
      breakpoint: "desktop",
      x: 4,
      y: 12,
      w: 8,
      h: 10,
      minW: 2,
      minH: 3,
      maxW: 24,
      maxH: 20,
    };
    const candidate: PlacementCandidateDto = {
      candidateId: "candidate-1",
      pageId: "page-1",
      elementType: "text",
      breakpoint: "desktop",
      x: 4,
      y: 12,
      w: 8,
      h: 10,
      valid: true,
      collisionResolved: false,
      layoutRevision: 3,
      projectRevision: 9,
      expiresAt: "2026-08-16T00:00:30.000Z",
    };
    expect(placementMatchesLayout(candidate, layout)).toBe(true);
    expect(placementMatchesLayout({ ...candidate, x: 5 }, layout)).toBe(false);
  });

  it("matches server round-and-clamp snapping across the half-cell boundary", () => {
    const canvasWidth = 1200;
    const halfStride = (gridColumnWidth(canvasWidth) + GRID_GAP) / 2;
    expect(
      snapPlacementCell({
        correctedCanvasX: CANVAS_PADDING + halfStride - 0.01,
        correctedCanvasY: CANVAS_PADDING,
        canvasWidth,
        defaultW: 6,
      }),
    ).toEqual({ column: 0, row: 0 });
    expect(
      snapPlacementCell({
        correctedCanvasX: CANVAS_PADDING + halfStride,
        correctedCanvasY: CANVAS_PADDING + 8,
        canvasWidth,
        defaultW: 6,
      }),
    ).toEqual({ column: 1, row: 1 });
    expect(
      snapPlacementCell({
        correctedCanvasX: 100_000,
        correctedCanvasY: -100,
        canvasWidth,
        defaultW: 6,
      }),
    ).toEqual({ column: 18, row: 0 });
  });

  it("refreshes candidates before the expiry safety margin", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-16T00:00:00.000Z"));
    expect(
      placementCandidateIsFresh({
        expiresAt: "2026-08-16T00:00:01.001Z",
      }),
    ).toBe(true);
    expect(
      placementCandidateIsFresh({
        expiresAt: "2026-08-16T00:00:01.000Z",
      }),
    ).toBe(false);
  });
});
