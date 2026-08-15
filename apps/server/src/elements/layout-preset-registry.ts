import { createHash } from "node:crypto";

import {
  CANVAS_GRID,
  LAYOUT_PRESET_DEFINITIONS,
  LAYOUT_PRESET_IDS,
  LAYOUT_PRESET_SCHEMA_VERSION,
  type LayoutPresetDefinition,
  type LayoutPresetId,
  type LayoutPresetProposedElementDto,
  type LayoutPresetRegistryDto,
} from "@webeditor/domain";

import { assertApi } from "../errors.js";
import {
  elementDefinition,
  rectanglesOverlap,
  validateElementStoredState,
} from "./element-registry.js";

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
  schemaVersion: LAYOUT_PRESET_SCHEMA_VERSION,
  definitions: LAYOUT_PRESET_DEFINITIONS,
} as const;

export const LAYOUT_PRESET_REGISTRY_CHECKSUM = createHash("sha256")
  .update(stableJson(registryPayload))
  .digest("hex");

const definitionsById = new Map<LayoutPresetId, LayoutPresetDefinition>(
  LAYOUT_PRESET_DEFINITIONS.map((definition) => [definition.id, definition]),
);
const presetIds = new Set<string>(LAYOUT_PRESET_IDS);

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  label: string,
): void {
  if (
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  ) {
    throw new Error(`${label} fields are invalid`);
  }
}

function assertPrimitiveRecord(value: unknown, label: string): void {
  const candidate = record(value, label);
  if (
    Object.keys(candidate).length > 100 ||
    Object.entries(candidate).some(
      ([key, item]) =>
        key === "__proto__" ||
        key === "prototype" ||
        key === "constructor" ||
        !(
          item === null ||
          typeof item === "string" ||
          typeof item === "boolean" ||
          (typeof item === "number" && Number.isFinite(item))
        ),
    )
  ) {
    throw new Error(`${label} values are invalid`);
  }
}

function assertSuggestedSchema(value: unknown): void {
  if (value === null) return;
  const proposal = record(value, "Suggested schema");
  exactKeys(proposal, ["id", "label", "tables"], "Suggested schema");
  if (
    typeof proposal.id !== "string" ||
    !/^[a-z][a-z0-9-]{0,119}$/.test(proposal.id) ||
    typeof proposal.label !== "string" ||
    proposal.label.length === 0 ||
    !Array.isArray(proposal.tables) ||
    proposal.tables.length === 0 ||
    proposal.tables.length > 20
  ) {
    throw new Error("Suggested schema is invalid");
  }
  const forbidden =
    /\b(?:select|insert|update|delete|drop|alter|pragma|sql|query|statement|migration)\b/i;
  const allStrings: string[] = [proposal.id, proposal.label];
  const tableTemplateIds = new Set<string>();
  for (const tableValue of proposal.tables) {
    const table = record(tableValue, "Suggested table");
    exactKeys(
      table,
      ["templateId", "displayName", "fields"],
      "Suggested table",
    );
    if (
      typeof table.templateId !== "string" ||
      !/^[a-z][a-z0-9-]{0,119}$/.test(table.templateId) ||
      tableTemplateIds.has(table.templateId) ||
      typeof table.displayName !== "string" ||
      table.displayName.length === 0 ||
      !Array.isArray(table.fields) ||
      table.fields.length === 0 ||
      table.fields.length > 100
    ) {
      throw new Error("Suggested table is invalid");
    }
    tableTemplateIds.add(table.templateId);
    allStrings.push(table.templateId, table.displayName);
    const fieldTemplateIds = new Set<string>();
    for (const fieldValue of table.fields) {
      const field = record(fieldValue, "Suggested field");
      exactKeys(
        field,
        ["templateId", "displayName", "dataType", "nullable"],
        "Suggested field",
      );
      if (
        typeof field.templateId !== "string" ||
        !/^[a-z][a-z0-9-]{0,119}$/.test(field.templateId) ||
        fieldTemplateIds.has(field.templateId) ||
        typeof field.displayName !== "string" ||
        field.displayName.length === 0 ||
        !["TEXT", "INTEGER", "REAL", "BOOLEAN", "DATETIME"].includes(
          field.dataType as string,
        ) ||
        typeof field.nullable !== "boolean"
      ) {
        throw new Error("Suggested field is invalid");
      }
      fieldTemplateIds.add(field.templateId);
      allStrings.push(
        field.templateId,
        field.displayName,
        field.dataType as string,
      );
    }
  }
  if (allStrings.some((item) => forbidden.test(item))) {
    throw new Error("Suggested schema cannot contain executable language");
  }
}

function assertDefinitionIntegrity(definition: LayoutPresetDefinition): void {
  if (
    definition.version !== 1 ||
    !presetIds.has(definition.id) ||
    definition.name.trim().length === 0 ||
    definition.name.length > 120 ||
    definition.description.trim().length === 0 ||
    definition.description.length > 500 ||
    !/^[A-Z][A-Za-z0-9]{0,119}$/.test(definition.iconName) ||
    !["dashboard", "statistics", "data", "general"].includes(
      definition.category,
    ) ||
    definition.elementCount !== definition.elements.length ||
    definition.elements.length === 0 ||
    definition.elements.length > 100 ||
    definition.bindingPlaceholders.length === 0
  ) {
    throw new Error(`Layout Preset ${definition.id} inventory is invalid`);
  }
  const templateIds = new Set<string>();
  const layouts: {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
  }[] = [];
  const expectedPlaceholders: {
    readonly templateId: string;
    readonly portId: string;
    readonly status: "UNCONNECTED";
  }[] = [];
  for (const template of definition.elements) {
    if (
      !/^[a-z][a-z0-9-]{0,119}$/.test(template.templateId) ||
      templateIds.has(template.templateId) ||
      template.name.trim().length === 0 ||
      template.name.trim().length > 120 ||
      Object.hasOwn(template.props, "previewData") ||
      Object.hasOwn(template.props, "sampleData")
    ) {
      throw new Error(`Layout Preset ${definition.id} template is invalid`);
    }
    templateIds.add(template.templateId);
    const element = elementDefinition(template.elementType);
    validateElementStoredState(element, {
      props: { ...element.defaultProps, ...template.props },
      style: { ...element.defaultStyle, ...template.style },
      events: element.defaultEvents,
    });
    const layout = template.layout;
    if (
      !Number.isSafeInteger(layout.x) ||
      !Number.isSafeInteger(layout.y) ||
      !Number.isSafeInteger(layout.w) ||
      !Number.isSafeInteger(layout.h) ||
      layout.x < 0 ||
      layout.y < 0 ||
      layout.x + layout.w > CANVAS_GRID.columns ||
      layout.w < element.layout.minW ||
      layout.w > element.layout.maxW ||
      layout.h < element.layout.minH ||
      layout.h > element.layout.maxH ||
      layouts.some((other) => rectanglesOverlap(layout, other))
    ) {
      throw new Error(`Layout Preset ${definition.id} geometry is invalid`);
    }
    layouts.push(layout);
    for (const port of element.bindingPorts) {
      if (port.required && port.direction === "input" && port.side === "left") {
        expectedPlaceholders.push({
          templateId: template.templateId,
          portId: port.id,
          status: "UNCONNECTED",
        });
      }
    }
  }
  const expectedElements = [
    ...new Set(definition.elements.map(({ elementType }) => elementType)),
  ];
  if (
    stableJson(expectedPlaceholders) !==
      stableJson(definition.bindingPlaceholders) ||
    stableJson(expectedElements) !== stableJson(definition.requiredElements)
  ) {
    throw new Error(`Layout Preset ${definition.id} topology is invalid`);
  }
  assertSuggestedSchema(definition.suggestedSchema);
  if (
    definition.validationScenario !== null &&
    (Object.keys(definition.validationScenario).length !== 2 ||
      !Object.hasOwn(definition.validationScenario, "id") ||
      !Object.hasOwn(definition.validationScenario, "label") ||
      typeof definition.validationScenario.id !== "string" ||
      typeof definition.validationScenario.label !== "string")
  ) {
    throw new Error(`Layout Preset ${definition.id} scenario is invalid`);
  }
}

export function validateLayoutPresetDefinitionSnapshot(
  value: unknown,
): LayoutPresetDefinition {
  const definition = record(value, "Layout Preset snapshot");
  exactKeys(
    definition,
    [
      "id",
      "version",
      "name",
      "category",
      "description",
      "iconName",
      "requiredElements",
      "elementCount",
      "elements",
      "bindingPlaceholders",
      "suggestedSchema",
      "validationScenario",
    ],
    "Layout Preset snapshot",
  );
  if (
    !Array.isArray(definition.requiredElements) ||
    !Array.isArray(definition.elements) ||
    !Array.isArray(definition.bindingPlaceholders)
  ) {
    throw new Error("Layout Preset snapshot arrays are invalid");
  }
  for (const templateValue of definition.elements) {
    const template = record(templateValue, "Layout Preset template");
    exactKeys(
      template,
      ["templateId", "elementType", "name", "props", "style", "layout"],
      "Layout Preset template",
    );
    assertPrimitiveRecord(template.props, "Layout Preset props");
    assertPrimitiveRecord(template.style, "Layout Preset style");
    exactKeys(
      record(template.layout, "Layout Preset layout"),
      ["x", "y", "w", "h"],
      "Layout Preset layout",
    );
  }
  for (const placeholderValue of definition.bindingPlaceholders) {
    exactKeys(
      record(placeholderValue, "Layout Preset placeholder"),
      ["templateId", "portId", "status"],
      "Layout Preset placeholder",
    );
  }
  const typed = definition as unknown as LayoutPresetDefinition;
  assertDefinitionIntegrity(typed);
  return typed;
}

function assertRegistryIntegrity(): void {
  if (
    LAYOUT_PRESET_DEFINITIONS.length !== LAYOUT_PRESET_IDS.length ||
    LAYOUT_PRESET_DEFINITIONS.some(
      (definition, index) => definition.id !== LAYOUT_PRESET_IDS[index],
    )
  ) {
    throw new Error("Layout Preset Registry order is invalid");
  }
  for (const definition of LAYOUT_PRESET_DEFINITIONS) {
    validateLayoutPresetDefinitionSnapshot(definition);
  }
}

assertRegistryIntegrity();

export function layoutPresetRegistry(): LayoutPresetRegistryDto {
  return { ...registryPayload, checksum: LAYOUT_PRESET_REGISTRY_CHECKSUM };
}

export function layoutPresetDefinition(value: unknown): LayoutPresetDefinition {
  assertApi(
    typeof value === "string" && presetIds.has(value),
    404,
    "LAYOUT_PRESET_NOT_FOUND",
    "Layout Preset was not found",
  );
  return definitionsById.get(value as LayoutPresetId) as LayoutPresetDefinition;
}

export function layoutPresetCoordinateChecksum(
  proposedElements: readonly LayoutPresetProposedElementDto[],
): string {
  const coordinates = [...proposedElements]
    .sort((left, right) => left.templateId.localeCompare(right.templateId))
    .map(({ templateId, entry }) => ({
      templateId,
      elementId: entry.element.id,
      type: entry.element.type,
      x: entry.layout.x,
      y: entry.layout.y,
      w: entry.layout.w,
      h: entry.layout.h,
    }));
  return createHash("sha256").update(stableJson(coordinates)).digest("hex");
}

export function canonicalLayoutPresetJson(value: unknown): string {
  return stableJson(value);
}
