import type {
  CanvasPointerDto,
  ElementLayoutDto,
  PlacementCandidateDto,
} from "@/services/elements-api";

export const DESKTOP_COLUMNS = 24;
export const GRID_ROW_HEIGHT = 8;
export const GRID_GAP = 8;
export const CANVAS_PADDING = 16;
export const CANVAS_ZOOM_LEVELS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

export interface GridPixelRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function gridColumnWidth(canvasWidth: number): number {
  const usable =
    canvasWidth - CANVAS_PADDING * 2 - GRID_GAP * (DESKTOP_COLUMNS - 1);
  return usable / DESKTOP_COLUMNS;
}

export function snapPlacementCell(input: {
  correctedCanvasX: number;
  correctedCanvasY: number;
  canvasWidth: number;
  defaultW: number;
}): { column: number; row: number } {
  const strideX = gridColumnWidth(input.canvasWidth) + GRID_GAP;
  const strideY = GRID_ROW_HEIGHT + GRID_GAP;
  return {
    column: Math.max(
      0,
      Math.min(
        DESKTOP_COLUMNS - input.defaultW,
        Math.round((input.correctedCanvasX - CANVAS_PADDING) / strideX),
      ),
    ),
    row: Math.max(
      0,
      Math.round((input.correctedCanvasY - CANVAS_PADDING) / strideY),
    ),
  };
}

export function placementCandidateIsFresh(
  candidate: Pick<PlacementCandidateDto, "expiresAt">,
  now = Date.now(),
  safetyMarginMs = 1_000,
): boolean {
  return Date.parse(candidate.expiresAt) - now > safetyMarginMs;
}

export function gridToPixelRect(
  layout: Pick<ElementLayoutDto, "x" | "y" | "w" | "h">,
  canvasWidth: number,
): GridPixelRect {
  const columnWidth = gridColumnWidth(canvasWidth);
  return {
    left: Math.round(CANVAS_PADDING + (columnWidth + GRID_GAP) * layout.x),
    top: Math.round(CANVAS_PADDING + (GRID_ROW_HEIGHT + GRID_GAP) * layout.y),
    width: Math.round(
      columnWidth * layout.w + GRID_GAP * Math.max(0, layout.w - 1),
    ),
    height: Math.round(
      GRID_ROW_HEIGHT * layout.h + GRID_GAP * Math.max(0, layout.h - 1),
    ),
  };
}

export function normalizeCanvasPointer(input: {
  clientX: number;
  clientY: number;
  viewportLeft: number;
  viewportTop: number;
  scrollLeft: number;
  scrollTop: number;
  canvasOffsetLeft: number;
  canvasOffsetTop: number;
  zoom: number;
}): CanvasPointerDto {
  const rawCanvasX = input.clientX - input.viewportLeft;
  const rawCanvasY = input.clientY - input.viewportTop;
  return {
    rawCanvasX,
    rawCanvasY,
    correctedCanvasX:
      (rawCanvasX + input.scrollLeft - input.canvasOffsetLeft) / input.zoom,
    correctedCanvasY:
      (rawCanvasY + input.scrollTop - input.canvasOffsetTop) / input.zoom,
  };
}

export function placementMatchesLayout(
  candidate: PlacementCandidateDto,
  layout: ElementLayoutDto,
): boolean {
  return (
    candidate.x === layout.x &&
    candidate.y === layout.y &&
    candidate.w === layout.w &&
    candidate.h === layout.h
  );
}

export function layoutChanged(
  before: ElementLayoutDto,
  after: Pick<ElementLayoutDto, "x" | "y" | "w" | "h">,
): boolean {
  return (
    before.x !== after.x ||
    before.y !== after.y ||
    before.w !== after.w ||
    before.h !== after.h
  );
}
