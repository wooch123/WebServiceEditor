import {
  CANVAS_GRID,
  ELEMENT_DEFINITIONS,
  ELEMENT_TYPES,
  RESIZE_HANDLES,
  type ElementDefinition,
  type ElementLayoutDto,
  type ElementSizeRule,
  type ElementType,
  type ResizeHandle,
} from "@webeditor/domain";

import { assertApi } from "../errors.js";

const byType = new Map<ElementType, ElementDefinition>(
  ELEMENT_DEFINITIONS.map((definition) => [definition.type, definition]),
);
const elementTypeSet = new Set<string>(ELEMENT_TYPES);
const resizeHandleSet = new Set<string>(RESIZE_HANDLES);

export function elementDefinition(value: unknown): ElementDefinition {
  assertApi(
    typeof value === "string" && elementTypeSet.has(value),
    400,
    "INVALID_ELEMENT_TYPE",
    "Element type is invalid",
  );
  return byType.get(value as ElementType) as ElementDefinition;
}

export function resizeHandle(value: unknown): ResizeHandle {
  assertApi(
    typeof value === "string" && resizeHandleSet.has(value),
    400,
    "INVALID_RESIZE_HANDLE",
    "Resize handle is invalid",
  );
  return value as ResizeHandle;
}

export function assertGridInteger(value: unknown): number {
  assertApi(
    Number.isSafeInteger(value),
    400,
    "INVALID_ELEMENT_LAYOUT",
    "Element layout must use integer grid units",
  );
  return value as number;
}

export interface GridRectangle {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export function rectanglesOverlap(
  left: GridRectangle,
  right: GridRectangle,
): boolean {
  return (
    left.x < right.x + right.w &&
    left.x + left.w > right.x &&
    left.y < right.y + right.h &&
    left.y + left.h > right.y
  );
}

export function clampMove(
  xValue: unknown,
  yValue: unknown,
  size: Pick<GridRectangle, "w" | "h">,
): GridRectangle {
  const x = assertGridInteger(xValue);
  const y = assertGridInteger(yValue);
  return {
    x: Math.max(0, Math.min(CANVAS_GRID.columns - size.w, x)),
    y: Math.max(0, y),
    ...size,
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export function normalizeResize(
  current: GridRectangle,
  limits: ElementSizeRule,
  handle: ResizeHandle,
  requestedValue: GridRectangle,
): GridRectangle {
  const requested = {
    x: assertGridInteger(requestedValue.x),
    y: assertGridInteger(requestedValue.y),
    w: assertGridInteger(requestedValue.w),
    h: assertGridInteger(requestedValue.h),
  };
  assertApi(
    requested.w >= 1 && requested.h >= 1,
    400,
    "INVALID_ELEMENT_LAYOUT",
    "Element size must be positive",
  );

  const movesWest = handle.includes("w");
  const movesEast = handle.includes("e");
  const movesNorth = handle.includes("n");
  const movesSouth = handle.includes("s");
  const currentRight = current.x + current.w;
  const currentBottom = current.y + current.h;

  assertApi(
    (movesWest || requested.x === current.x) &&
      (movesEast || requested.x + requested.w === currentRight) &&
      (movesNorth || requested.y === current.y) &&
      (movesSouth || requested.y + requested.h === currentBottom),
    400,
    "INVALID_ELEMENT_LAYOUT",
    "Resize geometry does not match its handle",
  );

  let left = current.x;
  let right = currentRight;
  let top = current.y;
  let bottom = currentBottom;

  if (movesWest) {
    left = clamp(
      requested.x,
      Math.max(0, currentRight - limits.maxW),
      currentRight - limits.minW,
    );
  }
  if (movesEast) {
    right = clamp(
      requested.x + requested.w,
      current.x + limits.minW,
      Math.min(CANVAS_GRID.columns, current.x + limits.maxW),
    );
  }
  if (movesNorth) {
    top = clamp(
      requested.y,
      Math.max(0, currentBottom - limits.maxH),
      currentBottom - limits.minH,
    );
  }
  if (movesSouth) {
    bottom = clamp(
      requested.y + requested.h,
      current.y + limits.minH,
      current.y + limits.maxH,
    );
  }

  return { x: left, y: top, w: right - left, h: bottom - top };
}

export function layoutLimits(
  layout: Pick<ElementLayoutDto, "minW" | "minH" | "maxW" | "maxH">,
): ElementSizeRule {
  return {
    defaultW: layout.minW,
    defaultH: layout.minH,
    minW: layout.minW,
    minH: layout.minH,
    maxW: layout.maxW,
    maxH: layout.maxH,
  };
}
