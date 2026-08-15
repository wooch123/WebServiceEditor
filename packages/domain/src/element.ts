export const ELEMENT_SCHEMA_VERSION = 1 as const;
export const ELEMENT_TYPE_VERSION = 1 as const;
export const EDITABLE_BREAKPOINT = "desktop" as const;

export const CANVAS_GRID = {
  columns: 24,
  rowHeight: 8,
  gap: 8,
  padding: 16,
} as const;

export const ELEMENT_TYPES = [
  "text",
  "button",
  "container",
  "kpi-card",
] as const;
export const RESIZE_HANDLES = [
  "n",
  "s",
  "e",
  "w",
  "ne",
  "nw",
  "se",
  "sw",
] as const;
export const BATCH_LAYOUT_MODES = ["COMPLETE", "PARTIAL"] as const;

export type ElementType = (typeof ELEMENT_TYPES)[number];
export type ResizeHandle = (typeof RESIZE_HANDLES)[number];
export type BatchLayoutMode = (typeof BATCH_LAYOUT_MODES)[number];
export type EditableBreakpoint = typeof EDITABLE_BREAKPOINT;

export interface ElementSizeRule {
  readonly defaultW: number;
  readonly defaultH: number;
  readonly minW: number;
  readonly minH: number;
  readonly maxW: number;
  readonly maxH: number;
}

export interface ElementDefinition {
  readonly type: ElementType;
  readonly typeVersion: typeof ELEMENT_TYPE_VERSION;
  readonly label: string;
  readonly category: "basic" | "statistics";
  readonly iconName: string;
  readonly defaultName: string;
  readonly defaultProps: Readonly<Record<string, unknown>>;
  readonly defaultStyle: Readonly<Record<string, unknown>>;
  readonly defaultEvents: readonly unknown[];
  readonly layout: ElementSizeRule;
}

export const ELEMENT_DEFINITIONS = [
  {
    type: "text",
    typeVersion: ELEMENT_TYPE_VERSION,
    label: "Text",
    category: "basic",
    iconName: "Type",
    defaultName: "Text",
    defaultProps: { text: "Text" },
    defaultStyle: {},
    defaultEvents: [],
    layout: { defaultW: 6, defaultH: 5, minW: 2, minH: 3, maxW: 24, maxH: 20 },
  },
  {
    type: "button",
    typeVersion: ELEMENT_TYPE_VERSION,
    label: "Button",
    category: "basic",
    iconName: "RectangleHorizontal",
    defaultName: "Button",
    defaultProps: { label: "Button" },
    defaultStyle: {},
    defaultEvents: [],
    layout: { defaultW: 4, defaultH: 5, minW: 2, minH: 4, maxW: 12, maxH: 10 },
  },
  {
    type: "container",
    typeVersion: ELEMENT_TYPE_VERSION,
    label: "Container",
    category: "basic",
    iconName: "PanelTop",
    defaultName: "Container",
    defaultProps: {},
    defaultStyle: {},
    defaultEvents: [],
    layout: {
      defaultW: 12,
      defaultH: 12,
      minW: 4,
      minH: 6,
      maxW: 24,
      maxH: 60,
    },
  },
  {
    type: "kpi-card",
    typeVersion: ELEMENT_TYPE_VERSION,
    label: "KPI Card",
    category: "statistics",
    iconName: "ChartNoAxesCombined",
    defaultName: "KPI Card",
    defaultProps: { label: "Value", value: "0" },
    defaultStyle: {},
    defaultEvents: [],
    layout: { defaultW: 6, defaultH: 10, minW: 4, minH: 8, maxW: 12, maxH: 20 },
  },
] as const satisfies readonly ElementDefinition[];

export interface ElementDto {
  readonly id: string;
  readonly projectId: string;
  readonly pageId: string;
  readonly type: ElementType;
  readonly typeVersion: typeof ELEMENT_TYPE_VERSION;
  readonly name: string;
  readonly props: Readonly<Record<string, unknown>>;
  readonly style: Readonly<Record<string, unknown>>;
  readonly events: readonly unknown[];
  readonly locked: boolean;
  readonly hidden: boolean;
  readonly revision: number;
}

export interface ElementLayoutDto {
  readonly elementId: string;
  readonly breakpoint: EditableBreakpoint;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly minW: number;
  readonly minH: number;
  readonly maxW: number;
  readonly maxH: number;
}

export interface ElementEntryDto {
  readonly element: ElementDto;
  readonly layout: ElementLayoutDto;
}

export interface ElementListDto {
  readonly pageId: string;
  readonly breakpoint: EditableBreakpoint;
  readonly layoutRevision: number;
  readonly projectRevision: number;
  readonly elements: readonly ElementEntryDto[];
}

export interface CanvasPointerDto {
  readonly rawCanvasX: number;
  readonly rawCanvasY: number;
  readonly correctedCanvasX: number;
  readonly correctedCanvasY: number;
}

export interface PlacementCandidateDto {
  readonly candidateId: string;
  readonly pageId: string;
  readonly elementType: ElementType;
  readonly breakpoint: EditableBreakpoint;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly valid: boolean;
  readonly collisionResolved: boolean;
  readonly layoutRevision: number;
  readonly projectRevision: number;
  readonly expiresAt: string;
}

export interface CreatePlacementCandidateRequest {
  readonly elementType: ElementType;
  readonly pointer: CanvasPointerDto;
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  readonly expectedLayoutRevision: number;
  readonly expectedProjectRevision: number;
}

export interface CreateElementRequest {
  readonly elementType: ElementType;
  readonly expectedLayoutRevision: number;
  readonly expectedProjectRevision: number;
  readonly idempotencyKey: string;
}

export interface CreateElementFromPlacementRequest {
  readonly candidateId: string;
  readonly expectedLayoutRevision: number;
  readonly expectedProjectRevision: number;
  readonly idempotencyKey: string;
}

export type ElementChange =
  | { readonly kind: "MOVE"; readonly x: number; readonly y: number }
  | {
      readonly kind: "RESIZE";
      readonly handle: ResizeHandle;
      readonly x: number;
      readonly y: number;
      readonly w: number;
      readonly h: number;
    }
  | { readonly kind: "LOCK"; readonly locked: boolean };

export interface PatchElementRequest {
  readonly expectedRevision: number;
  readonly expectedLayoutRevision: number;
  readonly expectedProjectRevision: number;
  readonly idempotencyKey: string;
  readonly change: ElementChange;
}

export interface DeleteElementRequest {
  readonly expectedRevision: number;
  readonly expectedLayoutRevision: number;
  readonly expectedProjectRevision: number;
  readonly idempotencyKey: string;
}

export interface BatchLayoutItem {
  readonly elementId: string;
  readonly expectedRevision: number;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface BatchLayoutRequest {
  readonly pageId: string;
  readonly expectedLayoutRevision: number;
  readonly expectedProjectRevision: number;
  readonly idempotencyKey: string;
  readonly mode: BatchLayoutMode;
  readonly items: readonly BatchLayoutItem[];
}

export interface ElementMutationDto {
  readonly entry: ElementEntryDto;
  readonly layoutRevision: number;
  readonly projectRevision: number;
  readonly commandId: string;
}
