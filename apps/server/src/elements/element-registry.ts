import { createHash } from "node:crypto";

import {
  CANVAS_GRID,
  ELEMENT_DEFINITIONS,
  ELEMENT_PROPERTY_TABS,
  ELEMENT_REGISTRY_SCHEMA_VERSION,
  ELEMENT_TYPES,
  RESIZE_HANDLES,
  type ElementBindingStatusDto,
  type ElementDefinition,
  type ElementEntryDto,
  type ElementLayoutDto,
  type ElementPropertyField,
  type ElementPropertyValue,
  type ElementRegistryDto,
  type ElementRenderStateDto,
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

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

const registryPayload = {
  schemaVersion: ELEMENT_REGISTRY_SCHEMA_VERSION,
  tabs: ELEMENT_PROPERTY_TABS,
  definitions: ELEMENT_DEFINITIONS,
} as const;

export const ELEMENT_REGISTRY_CHECKSUM = createHash("sha256")
  .update(stableJson(registryPayload))
  .digest("hex");

export function elementRegistry(): ElementRegistryDto {
  return { ...registryPayload, checksum: ELEMENT_REGISTRY_CHECKSUM };
}

export function elementDefinition(value: unknown): ElementDefinition {
  assertApi(
    typeof value === "string" && elementTypeSet.has(value),
    400,
    "INVALID_ELEMENT_TYPE",
    "Element type is invalid",
  );
  return byType.get(value as ElementType) as ElementDefinition;
}

export function elementPropertyField(
  definition: ElementDefinition,
  value: unknown,
): ElementPropertyField {
  assertApi(
    typeof value === "string" &&
      value.length <= 160 &&
      value !== "__proto__" &&
      value !== "prototype" &&
      value !== "constructor",
    400,
    "INVALID_ELEMENT_PROPERTY",
    "Element property ID is invalid",
  );
  const field = definition.propertySchema.fields.find(
    (candidate) => candidate.id === value,
  );
  assertApi(
    field !== undefined,
    400,
    "UNKNOWN_ELEMENT_PROPERTY",
    "Element property is not declared by the Registry",
    { propertyId: value },
  );
  return field;
}

function propertyKey(field: ElementPropertyField): string {
  const separator = field.id.indexOf(".");
  return separator === -1 ? field.id : field.id.slice(separator + 1);
}

function assertNumberInputBounds(
  props: Readonly<Record<string, unknown>>,
  code:
    "INVALID_PROJECT_ELEMENT_PROPERTY_STATE" | "INVALID_ELEMENT_PROPERTY_VALUE",
): void {
  const minimum = props.minimum;
  const maximum = props.maximum;
  const defaultValue = props.defaultValue;
  assertApi(
    minimum === null ||
      maximum === null ||
      (typeof minimum === "number" &&
        typeof maximum === "number" &&
        minimum <= maximum),
    400,
    code,
    "Number Input minimum cannot exceed maximum",
  );
  assertApi(
    typeof defaultValue === "number" &&
      (minimum === null ||
        (typeof minimum === "number" && defaultValue >= minimum)) &&
      (maximum === null ||
        (typeof maximum === "number" && defaultValue <= maximum)),
    400,
    code,
    "Number Input default value must be within its minimum and maximum",
  );
}

export function validateElementStoredState(
  definition: ElementDefinition,
  value: {
    readonly props: unknown;
    readonly style: unknown;
    readonly events: unknown;
  },
): {
  readonly props: Readonly<Record<string, ElementPropertyValue>>;
  readonly style: Readonly<Record<string, ElementPropertyValue>>;
  readonly events: readonly [];
} {
  const validateRecord = (
    candidate: unknown,
    target: "props" | "style",
  ): Readonly<Record<string, ElementPropertyValue>> => {
    assertApi(
      typeof candidate === "object" &&
        candidate !== null &&
        !Array.isArray(candidate) &&
        Buffer.byteLength(JSON.stringify(candidate), "utf8") <= 65_536,
      400,
      "INVALID_PROJECT_ELEMENT_PROPERTY_STATE",
      `Element ${target} are invalid`,
    );
    const record = candidate as Record<string, unknown>;
    const keys = Object.keys(record);
    assertApi(
      keys.length <= 100,
      400,
      "INVALID_PROJECT_ELEMENT_PROPERTY_STATE",
      `Element ${target} contain too many values`,
    );
    const defaults =
      target === "props" ? definition.defaultProps : definition.defaultStyle;
    const output: Record<string, ElementPropertyValue> = {};
    for (const key of keys) {
      assertApi(
        key !== "__proto__" && key !== "prototype" && key !== "constructor",
        400,
        "INVALID_PROJECT_ELEMENT_PROPERTY_STATE",
        `Element ${target} key is invalid`,
      );
      const field = definition.propertySchema.fields.find(
        (item) => item.target === target && propertyKey(item) === key,
      );
      assertApi(
        field !== undefined,
        400,
        "UNKNOWN_PROJECT_ELEMENT_PROPERTY",
        `Element ${target} key is not declared by the Registry`,
        { key },
      );
    }
    const merged = { ...defaults, ...record };
    for (const [key, item] of Object.entries(merged)) {
      const field = definition.propertySchema.fields.find(
        (candidateField) =>
          candidateField.target === target &&
          propertyKey(candidateField) === key,
      );
      if (field === undefined) {
        throw new Error(
          `Registry default ${target}.${key} has no Property field`,
        );
      }
      output[key] = validateElementPropertyValue(field, item);
    }
    return output;
  };
  assertApi(
    Array.isArray(value.events) && value.events.length === 0,
    400,
    "INVALID_PROJECT_ELEMENT_EVENTS",
    "Element events are not supported before the Action Registry is available",
  );
  const props = validateRecord(value.props, "props");
  const style = validateRecord(value.style, "style");
  if (definition.type === "number-input") {
    assertNumberInputBounds(props, "INVALID_PROJECT_ELEMENT_PROPERTY_STATE");
  }
  return { props, style, events: [] };
}

function enumValues(field: ElementPropertyField): readonly string[] {
  return field.options?.map(({ value }) => value) ?? [];
}

export function validateElementPropertyValue(
  field: ElementPropertyField,
  value: unknown,
): ElementPropertyValue {
  assertApi(
    !field.readOnly && field.target !== "computed" && field.target !== "layout",
    400,
    "ELEMENT_PROPERTY_READ_ONLY",
    "Element property is read only",
    { propertyId: field.id },
  );
  if (value === null) {
    assertApi(
      !field.required,
      400,
      "ELEMENT_PROPERTY_REQUIRED",
      "Element property is required",
      { propertyId: field.id },
    );
    return null;
  }
  if (field.valueType === "number") {
    assertApi(
      typeof value === "number" &&
        Number.isFinite(value) &&
        (field.min === undefined || value >= field.min) &&
        (field.max === undefined || value <= field.max),
      400,
      "INVALID_ELEMENT_PROPERTY_VALUE",
      "Element property number is outside its allowed range",
      { propertyId: field.id },
    );
    return value;
  }
  if (field.valueType === "boolean") {
    assertApi(
      typeof value === "boolean",
      400,
      "INVALID_ELEMENT_PROPERTY_VALUE",
      "Element property must be a boolean",
      { propertyId: field.id },
    );
    return value;
  }
  assertApi(
    typeof value === "string" &&
      Buffer.byteLength(value, "utf8") <= (field.maxLength ?? 10_000),
    400,
    "INVALID_ELEMENT_PROPERTY_VALUE",
    "Element property text is invalid or too long",
    { propertyId: field.id },
  );
  if (field.valueType === "enum") {
    assertApi(
      enumValues(field).includes(value),
      400,
      "INVALID_ELEMENT_PROPERTY_VALUE",
      "Element property option is invalid",
      { propertyId: field.id },
    );
  }
  if (field.id === "general.displayName") {
    assertApi(
      value.trim().length >= 1 && value.trim().length <= 120,
      400,
      "INVALID_ELEMENT_PROPERTY_VALUE",
      "Display name is invalid",
      { propertyId: field.id },
    );
    return value.trim();
  }
  if (field.id === "general.internalName") {
    assertApi(
      /^[A-Za-z][A-Za-z0-9_]{0,119}$/.test(value),
      400,
      "INVALID_ELEMENT_PROPERTY_VALUE",
      "Internal name is invalid",
      { propertyId: field.id },
    );
  }
  if (field.control === "theme-token") {
    assertApi(
      /^[a-z][a-z0-9-]{0,79}$/.test(value),
      400,
      "INVALID_ELEMENT_PROPERTY_VALUE",
      "Theme token is invalid",
      { propertyId: field.id },
    );
  }
  if (field.control === "color" && value.length > 0) {
    assertApi(
      /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value),
      400,
      "INVALID_ELEMENT_PROPERTY_VALUE",
      "Custom color must be a hexadecimal color",
      { propertyId: field.id },
    );
  }
  return value;
}

export interface ElementPropertyProjection {
  readonly name: string;
  readonly props: Readonly<Record<string, unknown>>;
  readonly style: Readonly<Record<string, unknown>>;
  readonly locked: boolean;
  readonly hidden: boolean;
}

export function projectElementProperties(
  entry: ElementEntryDto,
  definition: ElementDefinition,
  values: Readonly<Record<string, unknown>>,
): ElementPropertyProjection {
  assertApi(
    typeof values === "object" && values !== null && !Array.isArray(values),
    400,
    "INVALID_ELEMENT_PROPERTIES",
    "Element property values must be an object",
  );
  const keys = Object.keys(values);
  assertApi(
    keys.length >= 1 && keys.length <= 100,
    400,
    "INVALID_ELEMENT_PROPERTIES",
    "Element property update must contain between 1 and 100 values",
  );
  let name = entry.element.name;
  let locked = entry.element.locked;
  let hidden = entry.element.hidden;
  const props: Record<string, unknown> = { ...entry.element.props };
  const style: Record<string, unknown> = { ...entry.element.style };
  for (const id of keys) {
    assertApi(
      Object.prototype.hasOwnProperty.call(values, id) &&
        id !== "__proto__" &&
        id !== "prototype" &&
        id !== "constructor",
      400,
      "INVALID_ELEMENT_PROPERTY",
      "Element property ID is invalid",
    );
    const field = elementPropertyField(definition, id);
    const value = validateElementPropertyValue(field, values[id]);
    if (id === "general.displayName") {
      name = value as string;
    } else if (id === "general.visible") {
      hidden = !(value as boolean);
    } else if (id === "general.locked") {
      locked = value as boolean;
    } else if (field.target === "props") {
      props[propertyKey(field)] = value;
    } else if (field.target === "style") {
      style[propertyKey(field)] = value;
    } else {
      throw new Error(`Unmapped Registry property ${field.id}`);
    }
  }
  if (definition.type === "number-input") {
    assertNumberInputBounds(props, "INVALID_ELEMENT_PROPERTY_VALUE");
  }
  return { name, props, style, locked, hidden };
}

export function elementBindingStatus(
  definition: ElementDefinition,
): ElementBindingStatusDto {
  if (definition.bindingPorts.length === 0) {
    return {
      status: "NOT_APPLICABLE",
      ports: [],
      message: "No binding ports",
    };
  }
  return {
    status: "UNCONNECTED",
    ports: definition.bindingPorts.map((port) => ({
      portId: port.id,
      status: "UNCONNECTED" as const,
      message: "Not connected",
    })),
    message: "Not connected",
  };
}

export function elementRenderState(
  definition: ElementDefinition,
): ElementRenderStateDto {
  const hasRequiredInput = definition.bindingPorts.some(
    (port) => port.direction === "input" && port.required,
  );
  return hasRequiredInput
    ? { state: "EMPTY", message: "No connected data" }
    : { state: "DATA", message: null };
}

export function elementPropertyValues(
  entry: ElementEntryDto,
  definition: ElementDefinition,
): Readonly<Record<string, ElementPropertyValue>> {
  const props = { ...definition.defaultProps, ...entry.element.props };
  const style = { ...definition.defaultStyle, ...entry.element.style };
  const bindingStatus = elementBindingStatus(definition);
  const values: Record<string, ElementPropertyValue> = {};
  for (const field of definition.propertySchema.fields) {
    const key = propertyKey(field);
    if (field.id === "general.displayName")
      values[field.id] = entry.element.name;
    else if (field.id === "general.elementId")
      values[field.id] = entry.element.id;
    else if (field.id === "general.visible")
      values[field.id] = !entry.element.hidden;
    else if (field.id === "general.locked")
      values[field.id] = entry.element.locked;
    else if (field.id === "style.width") values[field.id] = entry.layout.w;
    else if (field.id === "style.height") values[field.id] = entry.layout.h;
    else if (field.id === "data.bindingStatus")
      values[field.id] = bindingStatus.status;
    else if (field.id === "interaction.supportedEvents") {
      values[field.id] = definition.events.map(({ id }) => id).join(", ");
    } else if (field.id === "validation.status") {
      values[field.id] =
        bindingStatus.status === "UNCONNECTED" &&
        definition.bindingPorts.some((port) => port.required)
          ? "WARNING"
          : "PASS";
    } else if (field.id === "advanced.type") values[field.id] = definition.type;
    else if (field.id === "advanced.typeVersion") {
      values[field.id] = definition.typeVersion;
    } else if (field.target === "props") {
      values[field.id] = (props[key] ?? null) as ElementPropertyValue;
    } else if (field.target === "style") {
      values[field.id] = (style[key] ?? null) as ElementPropertyValue;
    } else {
      values[field.id] = null;
    }
  }
  return values;
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
