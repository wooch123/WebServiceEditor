import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { extname, relative, resolve, sep } from "node:path";
import process from "node:process";

import {
  REPOSITORY_ROOT,
  Validation,
  finishVerification,
  isMainModule,
  unexpectedFailure,
} from "./lib/verification.mjs";
import {
  calculateRegistryChecksum,
  inspectRegistrySnapshot,
  validatePhase6,
} from "./verify-phase6.mjs";
import { extractRouteInventory, routeKey } from "./verify-phase5.mjs";

export const PHASE7_EVIDENCE_PATH =
  "artifacts/phase7/statistical-elements-layout-presets-validation.json";
export const PHASE7_BROWSER_EVIDENCE_PATH =
  "artifacts/phase7/browser-statistics-presets-validation.json";

export const REQUIRED_PHASE7_REQUIREMENTS = Object.freeze(["REQ-012"]);
export const REQUIRED_PHASE6_ELEMENT_PREFIX = Object.freeze([
  "text",
  "button",
  "container",
  "kpi-card",
  "number-input",
  "data-table",
]);
export const REQUIRED_STATISTICAL_ELEMENT_TYPES = Object.freeze([
  "line-chart",
  "bar-chart",
  "histogram",
  "scatter-plot",
  "box-plot",
  "summary-statistics",
]);
export const REQUIRED_PHASE7_ELEMENT_TYPES = Object.freeze([
  ...REQUIRED_PHASE6_ELEMENT_PREFIX,
  ...REQUIRED_STATISTICAL_ELEMENT_TYPES,
]);
export const REQUIRED_LAYOUT_PRESET_IDS = Object.freeze([
  "analysis-dashboard",
  "blank-grid",
  "board",
  "chat",
  "comparison-dashboard",
  "correlation-analysis",
  "data-browser",
  "data-entry",
  "data-table",
  "distribution-analysis",
  "executive-dashboard",
  "experiment-comparison",
  "form",
  "kpi-dashboard",
  "master-detail",
  "monitoring-dashboard",
  "quality-dashboard",
  "regression-analysis",
  "report",
  "settings",
  "spc-dashboard",
  "trend-analysis",
]);
export const REQUIRED_LAYOUT_PRESET_CATEGORIES = Object.freeze([
  "dashboard",
  "statistics",
  "data",
  "general",
]);
export const REQUIRED_STATISTICAL_RENDER_STATES = Object.freeze([
  "EMPTY",
  "LOADING",
  "ERROR",
  "DATA",
]);
export const REQUIRED_PRESET_MODES = Object.freeze(["ADD", "REPLACE"]);

export const CANONICAL_PHASE7_ROUTES = Object.freeze([
  { method: "GET", path: "/api/v1/layout-presets" },
  { method: "GET", path: "/api/v1/layout-presets/:presetId" },
  {
    method: "POST",
    path: "/api/v1/pages/:pageId/layout-presets/:presetId/preview",
  },
  {
    method: "POST",
    path: "/api/v1/pages/:pageId/layout-presets/:presetId/apply",
  },
  {
    method: "GET",
    path: "/api/v1/pages/:pageId/layout-preset-instances",
  },
]);

export const REQUIRED_PHASE7_TEST_CAPABILITIES = Object.freeze([
  "statistical-registry-exact-six-and-all-projections",
  "statistical-properties-ports-states-and-no-demo-data",
  "statistical-editor-runtime-theme-accessibility",
  "statistical-empty-loading-error-data",
  "statistical-reduced-motion-and-resize-preview",
  "histogram-bin-count-changes-rendered-bins",
  "box-plot-show-outliers-changes-rendered-marks",
  "preset-registry-exact-22-checksum-order",
  "preset-all-real-templates-count-coordinates",
  "preset-required-port-placeholders",
  "preset-live-structured-preview-no-screenshot",
  "preset-preview-no-write-and-apply-exact-snapshot",
  "preset-coordinate-checksum-and-template-mapping",
  "preset-add-relative-geometry-and-collision",
  "preset-replace-impact-confirmation-and-locked-refusal",
  "preset-preview-expiry-stale-reuse-and-cross-scope",
  "preset-apply-idempotency-and-transaction-rollback",
  "preset-single-history-command-undo-redo-branch",
  "preset-instance-reload-and-restart",
  "preset-draft-published-runtime-isolation",
  "preset-clone-export-import-remap",
  "preset-trash-restore-purge-ownership",
  "sqlite-v6-forward-migration-preserves-v5",
  "suggested-schema-runtime-db-checksum-unchanged",
  "preset-add-replace-equal-sibling-geometry",
  "preset-browser-responsive-419",
]);

const SOURCE_EXTENSIONS = new Set([
  ".cjs",
  ".cts",
  ".css",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".sql",
  ".ts",
  ".tsx",
]);

function repositoryPath(repositoryRoot, absolutePath) {
  return relative(repositoryRoot, absolutePath).split(sep).join("/");
}

async function collectFiles(repositoryRoot, roots, predicate = () => true) {
  const files = [];
  async function visit(absolutePath) {
    let entries;
    try {
      entries = await readdir(absolutePath, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries.sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      if (["dist", "node_modules", ".git"].includes(entry.name)) continue;
      const child = resolve(absolutePath, entry.name);
      if (entry.isDirectory()) await visit(child);
      else if (entry.isFile()) {
        const path = repositoryPath(repositoryRoot, child);
        if (predicate(path)) {
          files.push({ path, source: await readFile(child, "utf8") });
        }
      }
    }
  }
  for (const root of roots) await visit(resolve(repositoryRoot, root));
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function combinedSource(files) {
  return files
    .map(({ path, source }) => `\n/* ${path} */\n${source}`)
    .join("\n");
}

function sourceForPath(files, pattern) {
  return files
    .filter(({ path }) => pattern.test(path))
    .map(({ source }) => source)
    .join("\n");
}

function exactArray(actual, expected) {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

function uniqueStrings(values) {
  return (
    Array.isArray(values) &&
    values.every((value) => typeof value === "string" && value.length > 0) &&
    new Set(values).size === values.length
  );
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!plainObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => [key, stableObject(value[key])]),
  );
}

export function stablePresetRegistryJson(value) {
  return JSON.stringify(stableObject(value));
}

export function calculatePresetRegistryChecksum(registry) {
  return createHash("sha256")
    .update(
      stablePresetRegistryJson({
        schemaVersion: registry?.schemaVersion,
        definitions: registry?.definitions,
      }),
    )
    .digest("hex");
}

export function canonicalPresetCoordinates(proposedElements) {
  if (!Array.isArray(proposedElements)) return null;
  const coordinates = proposedElements.map((proposal) => ({
    templateId: proposal?.templateId,
    elementId: proposal?.entry?.element?.id,
    type: proposal?.entry?.element?.type,
    x: proposal?.entry?.layout?.x,
    y: proposal?.entry?.layout?.y,
    w: proposal?.entry?.layout?.w,
    h: proposal?.entry?.layout?.h,
  }));
  if (
    coordinates.some(
      (coordinate) =>
        typeof coordinate.templateId !== "string" ||
        coordinate.templateId.length === 0 ||
        typeof coordinate.elementId !== "string" ||
        coordinate.elementId.length === 0 ||
        typeof coordinate.type !== "string" ||
        coordinate.type.length === 0 ||
        ![coordinate.x, coordinate.y, coordinate.w, coordinate.h].every(
          Number.isSafeInteger,
        ),
    )
  )
    return null;
  return coordinates.sort(
    (left, right) =>
      left.templateId.localeCompare(right.templateId) ||
      left.elementId.localeCompare(right.elementId),
  );
}

export function calculatePresetCoordinateChecksum(proposedElements) {
  const coordinates = canonicalPresetCoordinates(proposedElements);
  if (coordinates === null) return null;
  return createHash("sha256")
    .update(stablePresetRegistryJson(coordinates))
    .digest("hex");
}

export function inspectPresetCoordinateSnapshot(snapshot) {
  const proposed = Array.isArray(snapshot?.proposedElements)
    ? snapshot.proposedElements
    : [];
  const canonical = canonicalPresetCoordinates(proposed);
  const presented = proposed.map((proposal) => ({
    templateId: proposal?.templateId,
    elementId: proposal?.entry?.element?.id,
    type: proposal?.entry?.element?.type,
    x: proposal?.entry?.layout?.x,
    y: proposal?.entry?.layout?.y,
    w: proposal?.entry?.layout?.w,
    h: proposal?.entry?.layout?.h,
  }));
  return {
    proposedElementsComplete:
      proposed.length > 0 &&
      canonical !== null &&
      uniqueStrings(proposed.map(({ templateId }) => templateId)) &&
      uniqueStrings(proposed.map((proposal) => proposal?.entry?.element?.id)) &&
      proposed.every(
        (proposal) =>
          plainObject(proposal?.entry?.element) &&
          plainObject(proposal?.entry?.layout),
      ),
    canonicalOrder:
      canonical !== null &&
      JSON.stringify(presented) === JSON.stringify(canonical),
    checksumFormat: /^[a-f0-9]{64}$/u.test(snapshot?.coordinateChecksum ?? ""),
    checksumExact:
      canonical !== null &&
      snapshot?.coordinateChecksum ===
        calculatePresetCoordinateChecksum(proposed),
  };
}

function propertyKey(fieldId) {
  const separator = fieldId.indexOf(".");
  return separator < 0 ? fieldId : fieldId.slice(separator + 1);
}

const FORBIDDEN_DEMO_DATA_KEYS = new Set([
  "data",
  "dataset",
  "points",
  "previewData",
  "rows",
  "sampleData",
  "series",
  "values",
]);

export function inspectPhase7ElementRegistry(registry) {
  const baseInspection = inspectRegistrySnapshot(registry);
  const definitions = Array.isArray(registry?.definitions)
    ? registry.definitions
    : [];
  const typeOrder = definitions.map(({ type }) => type);
  const statistical = definitions.filter(({ type }) =>
    REQUIRED_STATISTICAL_ELEMENT_TYPES.includes(type),
  );
  const definitionByType = new Map(
    definitions.map((definition) => [definition.type, definition]),
  );
  const typeFieldsMatchDefaults = statistical.every((definition) => {
    const fields = Array.isArray(definition?.propertySchema?.fields)
      ? definition.propertySchema.fields
      : [];
    const declaredProps = new Set(
      fields
        .filter(({ target }) => target === "props")
        .map(({ id }) => propertyKey(id)),
    );
    const declaredStyle = new Set(
      fields
        .filter(({ target }) => target === "style")
        .map(({ id }) => propertyKey(id)),
    );
    return (
      plainObject(definition.defaultProps) &&
      plainObject(definition.defaultStyle) &&
      Object.keys(definition.defaultProps).every((key) =>
        declaredProps.has(key),
      ) &&
      Object.keys(definition.defaultStyle).every((key) =>
        declaredStyle.has(key),
      )
    );
  });
  const requiredPorts = statistical.every((definition) => {
    const ports = Array.isArray(definition.bindingPorts)
      ? definition.bindingPorts
      : [];
    return (
      ports.length > 0 &&
      ports.some(
        (port) =>
          typeof port.id === "string" &&
          port.id.length > 0 &&
          port.required === true &&
          port.direction === "input" &&
          port.side === "left",
      ) &&
      ports.every(
        (port) =>
          (port.direction === "input" && port.side === "left") ||
          (port.direction === "output" && port.side === "right"),
      )
    );
  });
  const noDemoDefaults = statistical.every(
    (definition) =>
      plainObject(definition.defaultProps) &&
      Object.keys(definition.defaultProps).every(
        (key) => !FORBIDDEN_DEMO_DATA_KEYS.has(key),
      ),
  );
  const layoutRules = statistical.every((definition) => {
    const layout = definition.layout;
    return (
      plainObject(layout) &&
      [
        layout.defaultW,
        layout.defaultH,
        layout.minW,
        layout.minH,
        layout.maxW,
        layout.maxH,
      ].every(Number.isSafeInteger) &&
      layout.minW >= 1 &&
      layout.minH >= 1 &&
      layout.minW <= layout.defaultW &&
      layout.defaultW <= layout.maxW &&
      layout.maxW <= 24 &&
      layout.minH <= layout.defaultH &&
      layout.defaultH <= layout.maxH
    );
  });
  const exactRenderStates = statistical.every((definition) =>
    exactArray(
      definition.supportedRenderStates,
      REQUIRED_STATISTICAL_RENDER_STATES,
    ),
  );
  return {
    registryChecksumExact:
      typeof registry?.checksum === "string" &&
      registry.checksum === calculateRegistryChecksum(registry),
    exactTwelveTypeOrder:
      typeOrder.length >= REQUIRED_PHASE7_ELEMENT_TYPES.length &&
      REQUIRED_PHASE7_ELEMENT_TYPES.every(
        (type, index) => typeOrder[index] === type,
      ),
    exactStatisticalSix:
      statistical.length === REQUIRED_STATISTICAL_ELEMENT_TYPES.length &&
      exactArray(
        statistical.map(({ type }) => type),
        REQUIRED_STATISTICAL_ELEMENT_TYPES,
      ),
    uniqueTypes: uniqueStrings(typeOrder),
    phase6ContractStillValid:
      baseInspection.schemaVersion &&
      baseInspection.checksumExact &&
      baseInspection.tabOrderExact &&
      baseInspection.definitionShapeValid &&
      baseInspection.layoutRulesValid &&
      baseInspection.fieldShapeValid &&
      baseInspection.uniqueFieldsPerDefinition &&
      baseInspection.commonFieldsComplete &&
      baseInspection.allTabsRepresented &&
      baseInspection.portsValid &&
      baseInspection.eventsValid,
    statisticalCategory: statistical.every(
      ({ category }) => category === "statistics",
    ),
    executableProjectionKeys: statistical.every(
      (definition) =>
        definition.rendererKey === definition.type &&
        definition.editorRendererKey === definition.type &&
        definition.runtimeRendererKey === definition.type &&
        definition.validatorKey === definition.type,
    ),
    requiredLeftInputPorts: requiredPorts,
    allFourRenderStates: exactRenderStates,
    defaultsDeclaredByProperties: typeFieldsMatchDefaults,
    noPersistedDemoDataDefaults: noDemoDefaults,
    layoutRulesValid: layoutRules,
    definitionsByTypeComplete: REQUIRED_PHASE7_ELEMENT_TYPES.every((type) =>
      definitionByType.has(type),
    ),
  };
}

function rectanglesOverlap(left, right) {
  return !(
    left.x + left.w <= right.x ||
    right.x + right.w <= left.x ||
    left.y + left.h <= right.y ||
    right.y + right.h <= left.y
  );
}

function layoutValid(layout) {
  return (
    plainObject(layout) &&
    [layout.x, layout.y, layout.w, layout.h].every(Number.isSafeInteger) &&
    layout.x >= 0 &&
    layout.y >= 0 &&
    layout.w >= 1 &&
    layout.h >= 1 &&
    layout.x + layout.w <= 24
  );
}

const SUGGESTED_FIELD_TYPES = new Set([
  "TEXT",
  "INTEGER",
  "REAL",
  "BOOLEAN",
  "DATETIME",
]);

function exactKeys(value, expected) {
  return (
    plainObject(value) &&
    exactArray(Object.keys(value).sort(), [...expected].sort())
  );
}

function suggestedSchemaValid(schema) {
  if (schema === null) return true;
  return (
    exactKeys(schema, ["id", "label", "tables"]) &&
    typeof schema.id === "string" &&
    schema.id.length > 0 &&
    typeof schema.label === "string" &&
    schema.label.length > 0 &&
    Array.isArray(schema.tables) &&
    schema.tables.length > 0 &&
    uniqueStrings(schema.tables.map(({ templateId }) => templateId)) &&
    schema.tables.every(
      (table) =>
        exactKeys(table, ["templateId", "displayName", "fields"]) &&
        typeof table.templateId === "string" &&
        table.templateId.length > 0 &&
        typeof table.displayName === "string" &&
        table.displayName.length > 0 &&
        Array.isArray(table.fields) &&
        table.fields.length > 0 &&
        uniqueStrings(table.fields.map(({ templateId }) => templateId)) &&
        table.fields.every(
          (field) =>
            exactKeys(field, [
              "templateId",
              "displayName",
              "dataType",
              "nullable",
            ]) &&
            typeof field.templateId === "string" &&
            field.templateId.length > 0 &&
            typeof field.displayName === "string" &&
            field.displayName.length > 0 &&
            SUGGESTED_FIELD_TYPES.has(field.dataType) &&
            typeof field.nullable === "boolean",
        ),
    )
  );
}

export function inspectLayoutPresetRegistry(
  registry,
  elementRegistry,
  canonicalIds = REQUIRED_LAYOUT_PRESET_IDS,
) {
  const definitions = Array.isArray(registry?.definitions)
    ? registry.definitions
    : [];
  const elementDefinitions = Array.isArray(elementRegistry?.definitions)
    ? elementRegistry.definitions
    : [];
  const elementByType = new Map(
    elementDefinitions.map((definition) => [definition.type, definition]),
  );
  const ids = definitions.map(({ id }) => id);
  const allTemplates = definitions.flatMap((definition) =>
    Array.isArray(definition.elements) ? definition.elements : [],
  );
  const definitionsValid = definitions.every(
    (definition) =>
      typeof definition.id === "string" &&
      Number.isSafeInteger(definition.version) &&
      definition.version >= 1 &&
      typeof definition.name === "string" &&
      definition.name.trim().length > 0 &&
      REQUIRED_LAYOUT_PRESET_CATEGORIES.includes(definition.category) &&
      typeof definition.description === "string" &&
      definition.description.trim().length > 0 &&
      typeof definition.iconName === "string" &&
      definition.iconName.length > 0 &&
      Array.isArray(definition.elements) &&
      definition.elements.length > 0 &&
      definition.elementCount === definition.elements.length &&
      Array.isArray(definition.requiredElements) &&
      uniqueStrings(definition.requiredElements) &&
      Array.isArray(definition.bindingPlaceholders) &&
      definition.bindingPlaceholders.length > 0 &&
      suggestedSchemaValid(definition.suggestedSchema) &&
      (definition.validationScenario === null ||
        plainObject(definition.validationScenario)),
  );
  const templateShape = definitions.every((definition) => {
    const templates = definition.elements;
    return (
      uniqueStrings(templates.map(({ templateId }) => templateId)) &&
      templates.every((template) => {
        const elementDefinition = elementByType.get(template.elementType);
        const limits = elementDefinition?.layout;
        return (
          typeof template.templateId === "string" &&
          typeof template.elementType === "string" &&
          elementDefinition !== undefined &&
          typeof template.name === "string" &&
          template.name.trim().length > 0 &&
          plainObject(template.props) &&
          plainObject(template.style) &&
          layoutValid(template.layout) &&
          plainObject(limits) &&
          template.layout.w >= limits.minW &&
          template.layout.w <= limits.maxW &&
          template.layout.h >= limits.minH &&
          template.layout.h <= limits.maxH
        );
      })
    );
  });
  const noOverlap = definitions.every((definition) => {
    const templates = definition.elements;
    return templates.every((template, index) =>
      templates
        .slice(index + 1)
        .every((other) => !rectanglesOverlap(template.layout, other.layout)),
    );
  });
  const requiredElementsExact = definitions.every((definition) => {
    const actualTypes = [
      ...new Set(definition.elements.map(({ elementType }) => elementType)),
    ];
    return exactArray(definition.requiredElements, actualTypes);
  });
  const placeholdersValid = definitions.every((definition) => {
    const templateById = new Map(
      definition.elements.map((template) => [template.templateId, template]),
    );
    return (
      definition.bindingPlaceholders.length > 0 &&
      uniqueStrings(
        definition.bindingPlaceholders.map(
          ({ templateId, portId }) => `${templateId}:${portId}`,
        ),
      ) &&
      definition.bindingPlaceholders.every((placeholder) => {
        const template = templateById.get(placeholder.templateId);
        const elementDefinition = elementByType.get(template?.elementType);
        return (
          template !== undefined &&
          placeholder.status === "UNCONNECTED" &&
          typeof placeholder.portId === "string" &&
          elementDefinition?.bindingPorts?.some(
            (port) =>
              port.id === placeholder.portId &&
              port.required === true &&
              port.direction === "input" &&
              port.side === "left",
          )
        );
      })
    );
  });
  const screenshotOnlyForbidden = definitions.every(
    (definition) =>
      !("thumbnail" in definition) &&
      !/(?:data:image|https?:\/\/|\.png\b|\.jpe?g\b|\.webp\b|\.gif\b)/iu.test(
        JSON.stringify(definition),
      ),
  );
  return {
    schemaVersion: registry?.schemaVersion === 1,
    checksumFormat: /^[a-f0-9]{64}$/u.test(registry?.checksum ?? ""),
    checksumExact:
      registry?.checksum === calculatePresetRegistryChecksum(registry),
    exactCanonicalOrder: exactArray(ids, canonicalIds),
    uniqueIds: uniqueStrings(ids),
    exactCount: definitions.length === canonicalIds.length,
    allCategoriesRepresented: REQUIRED_LAYOUT_PRESET_CATEGORIES.every(
      (category) =>
        definitions.some((definition) => definition.category === category),
    ),
    definitionShapeValid: definitionsValid,
    allTemplatesReal:
      templateShape && allTemplates.length >= definitions.length,
    exactElementCounts: definitions.every(
      (definition) => definition.elementCount === definition.elements.length,
    ),
    coordinatesBounded: allTemplates.every((template) =>
      layoutValid(template.layout),
    ),
    noTemplateOverlap: noOverlap,
    requiredElementsExact,
    placeholdersRequiredAndValid: placeholdersValid,
    suggestedSchemaReadOnlyBoundary:
      definitions.some(({ suggestedSchema }) => suggestedSchema !== null) &&
      definitions.every(({ suggestedSchema }) =>
        suggestedSchemaValid(suggestedSchema),
      ),
    screenshotOnlyForbidden,
  };
}

function uniqueRoutes(routes) {
  const seen = new Set();
  return routes.filter((route) => {
    const key = routeKey(route);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function inspectPhase7RouteContract(files) {
  const routes = uniqueRoutes(extractRouteInventory(combinedSource(files)));
  const keys = new Set(routes.map(routeKey));
  return {
    routes,
    missingRoutes: CANONICAL_PHASE7_ROUTES.filter(
      (route) => !keys.has(routeKey(route)),
    ),
    unversionedRoutes: routes.filter(
      (route) =>
        /layout-presets|layout-preset-instances/u.test(route.path) &&
        !route.path.startsWith("/api/v1/"),
    ),
  };
}

function tableBlock(source, tableName) {
  const match = source.match(
    new RegExp(`CREATE\\s+TABLE\\s+${tableName}\\s*\\(([\\s\\S]*?)\\);`, "iu"),
  );
  return match?.[1] ?? "";
}

export function inspectPhase7Schema(source) {
  const instance = tableBlock(source, "layout_preset_instances");
  const membership = tableBlock(source, "layout_preset_instance_elements");
  const placeholders = tableBlock(source, "element_binding_placeholders");
  const commands =
    tableBlock(source, "element_commands_v6") ||
    tableBlock(source, "element_commands");
  return {
    latestVersionAtLeastSix:
      /LATEST_METADATA_SCHEMA_VERSION\s*=\s*(?:[6-9]|[1-9]\d+)/u.test(source),
    namedVersionSixMigration:
      /version\s*:\s*6/u.test(source) &&
      /statistical-elements-layout-presets/u.test(source),
    schemaChecksumExported:
      /STATISTICAL_ELEMENTS_LAYOUT_PRESETS_SCHEMA_CHECKSUM/u.test(source),
    futureVersionFailClosed:
      /userVersion\s*>\s*LATEST_METADATA_SCHEMA_VERSION/u.test(source) &&
      /unknown future metadata schema version/iu.test(source),
    migrationTransactional:
      /\.transaction\s*\(/u.test(source) && /\.immediate\s*\(/u.test(source),
    instanceTable: instance.length > 0,
    membershipTable: membership.length > 0,
    placeholderTable: placeholders.length > 0,
    instanceOwnership:
      /project_id/iu.test(instance) &&
      /page_id/iu.test(instance) &&
      /preset_id/iu.test(instance) &&
      /preset_version/iu.test(instance) &&
      /registry_checksum/iu.test(instance) &&
      /APPLIED/iu.test(instance) &&
      /UNDONE/iu.test(instance) &&
      /DISCARDED/iu.test(instance),
    membershipOwnership:
      /instance_id/iu.test(membership) &&
      /element_id/iu.test(membership) &&
      /template_id/iu.test(membership) &&
      /FOREIGN KEY/iu.test(membership) &&
      /ON DELETE CASCADE/iu.test(membership),
    placeholderOwnership:
      /instance_id/iu.test(placeholders) &&
      /element_id/iu.test(placeholders) &&
      /template_id/iu.test(placeholders) &&
      /port_id/iu.test(placeholders) &&
      /UNCONNECTED/iu.test(placeholders) &&
      /FOREIGN KEY/iu.test(placeholders) &&
      /ON DELETE CASCADE/iu.test(placeholders),
    presetCommandConstrained: /PRESET_APPLY/u.test(commands),
    priorCommandTypesPreserved: [
      "ADD",
      "MOVE",
      "RESIZE",
      "LOCK",
      "BATCH_LAYOUT",
      "DELETE",
      "PROPERTIES",
    ].every((type) => commands.includes(type)),
  };
}

export function inspectPhase7Backend(files) {
  const registry = sourceForPath(files, /layout-preset-registry\.(?:ts|js)$/u);
  const service = sourceForPath(files, /layout-preset-service\.(?:ts|js)$/u);
  const repository = sourceForPath(
    files,
    /(?:layout-preset|element)-repository\.(?:ts|js)$/u,
  );
  const previewStore = sourceForPath(
    files,
    /layout-preset-preview-store\.(?:ts|js)$/u,
  );
  const projectService = sourceForPath(
    files,
    /projects\/project-service\.(?:ts|js)$/u,
  );
  const all = combinedSource(files);
  return {
    deterministicPresetRegistry:
      /LAYOUT_PRESET_DEFINITIONS/u.test(registry) &&
      /LAYOUT_PRESET_REGISTRY_CHECKSUM/u.test(registry) &&
      /stable/iu.test(registry),
    presetDefinitionAllowlist:
      /LAYOUT_PRESET_IDS/u.test(registry) &&
      /INVALID_LAYOUT_PRESET|LAYOUT_PRESET_NOT_FOUND/u.test(registry),
    previewCapacityAndTtl:
      /256/u.test(previewStore) &&
      /300_?000|5\s*\*\s*60\s*\*\s*1000/u.test(previewStore),
    previewScopeBound: [
      "projectId",
      "pageId",
      "presetId",
      "presetVersion",
      "registryChecksum",
      "mode",
      "projectRevision",
      "layoutRevision",
    ].every((field) => previewStore.includes(field)),
    previewNoDurableWrite:
      /preview/iu.test(service) &&
      !/\b(?:INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/iu.test(
        previewStore,
      ),
    applySnapshotOnly:
      /previewId/u.test(service) &&
      /consume/iu.test(service) &&
      /idempot/iu.test(service),
    coordinateChecksumBoundary:
      /coordinateChecksum/u.test(service + repository + previewStore) &&
      /templateId/u.test(service + repository + previewStore) &&
      /elementId/u.test(service + repository + previewStore),
    addAndReplace: /\bADD\b/u.test(service) && /\bREPLACE\b/u.test(service),
    lockedReplaceRefusal: /locked/iu.test(service) && /REPLACE/u.test(service),
    oneRevisionAdvance:
      /increment|advance|revision/iu.test(service) &&
      /layoutRevision/iu.test(service) &&
      /projectRevision/iu.test(service),
    atomicPresetHistory:
      /PRESET_APPLY/u.test(service + repository) &&
      /transaction/iu.test(service + repository),
    durableInstanceReads:
      /layout_preset_instances/iu.test(repository) &&
      /layout_preset_instance_elements/iu.test(repository) &&
      /element_binding_placeholders/iu.test(repository),
    suggestedSchemaNotExecuted:
      /suggestedSchema/u.test(all) &&
      !/\b(?:CREATE|ALTER|DROP)\s+TABLE\b/iu.test(service),
    lifecycleSnapshotExport:
      /listExportableLayoutPresetInstances/u.test(projectService) &&
      /layoutPresetInstances/u.test(projectService) &&
      /presetSnapshot/u.test(projectService),
    lifecycleSnapshotImportRemap:
      /layoutPresetInstances/u.test(projectService) &&
      /insertLayoutPresetInstance/u.test(projectService) &&
      /insertLayoutPresetMembership/u.test(projectService) &&
      /attachImportedLayoutPresetPlaceholder/u.test(projectService) &&
      /pageIdMap/u.test(projectService) &&
      /elementIdMap/u.test(projectService) &&
      /\bIMPORT\b/u.test(projectService),
    lifecycleAndDefinitionOwnership:
      /layoutPreset|presetInstance|layout_preset/iu.test(all) &&
      /definitionState/u.test(repository) &&
      /presetInstances/u.test(repository) &&
      /presetInstanceElements/u.test(repository) &&
      /bindingPlaceholders/u.test(repository) &&
      /purge/iu.test(projectService),
  };
}

function cssBlock(source, selector) {
  const start = source.indexOf(selector);
  if (start < 0) return "";
  const open = source.indexOf("{", start);
  if (open < 0) return "";
  const close = source.indexOf("}", open);
  return close < 0 ? "" : source.slice(open + 1, close);
}

export function inspectPhase7Frontend(files) {
  const presetApi = sourceForPath(files, /layout-presets-api\.(?:ts|js)$/u);
  const browser = sourceForPath(files, /LayoutPresetBrowser\.(?:tsx|jsx)$/u);
  const editor = sourceForPath(files, /ElementRenderer\.(?:tsx|jsx)$/u);
  const runtime = sourceForPath(files, /RuntimeElementRenderer\.(?:tsx|jsx)$/u);
  const statistical = sourceForPath(
    files,
    /statistical-rendering\.(?:tsx|jsx)$/u,
  );
  const styles = sourceForPath(files, /styles\.css$/u);
  const allProduction = combinedSource(files);
  const rawColor = /(?:#[0-9a-f]{3,8}\b|rgba?\(|hsla?\()/iu;
  const previewFixtureUsages = [
    ...allProduction.matchAll(/LAYOUT_PRESET_PREVIEW_DATA/gu),
  ].length;
  const modeCss = cssBlock(styles, ".layout-preset-modes");
  const modeItemCss = cssBlock(
    styles,
    '.layout-preset-modes [data-slot="toggle-group-item"]',
  );
  const actionCss = cssBlock(styles, ".layout-preset-actions");
  const actionItemCss = cssBlock(
    styles,
    '.layout-preset-actions [data-slot="button"]',
  );
  const replaceActionCss = cssBlock(styles, ".layout-preset-replace-actions");
  const replaceActionItemCss = cssBlock(
    styles,
    '.layout-preset-replace-actions [data-slot="button"]',
  );
  return {
    apiContract:
      /listLayoutPresets/u.test(presetApi) &&
      /getLayoutPreset/u.test(presetApi) &&
      /previewLayoutPreset/u.test(presetApi) &&
      /applyLayoutPreset/u.test(presetApi) &&
      /listLayoutPresetInstances/u.test(presetApi),
    browserProjectsRegistry:
      /listLayoutPresets/u.test(browser) &&
      /definitions\.map|presets\.map/u.test(browser),
    liveStructuredPreview:
      /templateId/u.test(browser) &&
      /layout\.x|\.x/u.test(browser) &&
      /layout\.y|\.y/u.test(browser) &&
      /layout\.w|\.w/u.test(browser) &&
      /layout\.h|\.h/u.test(browser) &&
      !/<img\b|background-image\s*:|url\s*\(/iu.test(browser),
    previewBeforeApply:
      /previewLayoutPreset/u.test(browser) &&
      /previewId/u.test(browser) &&
      /applyLayoutPreset/u.test(browser),
    addReplaceControls:
      /\bADD\b/u.test(browser) && /\bREPLACE\b/u.test(browser),
    replaceImpactConfirmation:
      /impact|existingElementCount|deletedElementIds|warnings/iu.test(
        browser,
      ) &&
      /confirm/iu.test(browser) &&
      /REPLACE/u.test(browser),
    warningBadge:
      /UNCONNECTED|미연결/u.test(browser + editor + runtime) &&
      /Badge/u.test(browser + editor + runtime),
    allStatisticalRendererKeys: REQUIRED_STATISTICAL_ELEMENT_TYPES.every(
      (type) => editor.includes(type) && runtime.includes(type),
    ),
    separateEditorRuntimeRenderers:
      editor.length > 0 &&
      runtime.length > 0 &&
      /StatisticalVisualization/u.test(editor) &&
      /StatisticalVisualization/u.test(runtime),
    semanticChartTokens:
      /var\(--chart-[1-8]\)/u.test(statistical) && !rawColor.test(statistical),
    accessibleCharts:
      /accessibilityLayer/u.test(statistical) &&
      /aria-label/u.test(statistical) &&
      /figcaption/u.test(statistical),
    reducedMotionAndResize:
      /isAnimationActive=\{false\}/u.test(statistical) &&
      /compact|resize/iu.test(statistical + editor + runtime),
    histogramBinCountMaterialized:
      /binCount/u.test(statistical) &&
      /histogramBins?|binnedSeries|build\w*Bins/iu.test(statistical),
    boxOutlierMarksMaterialized:
      /showOutliers\s*&&[\s\S]{0,600}(?:<Scatter\b|outlier\w*\.map\s*\()/u.test(
        statistical,
      ),
    truthfulStates: REQUIRED_STATISTICAL_RENDER_STATES.every((state) =>
      statistical.includes(state),
    ),
    previewFixtureScoped:
      /LAYOUT_PRESET_PREVIEW_DATA/u.test(statistical) &&
      previewFixtureUsages >= 2 &&
      previewFixtureUsages <= 3 &&
      !editor.includes("LAYOUT_PRESET_PREVIEW_DATA") &&
      !runtime.includes("LAYOUT_PRESET_PREVIEW_DATA"),
    equalSiblingGeometry:
      /grid-template-columns\s*:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/iu.test(
        modeCss,
      ) &&
      /grid-template-columns\s*:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/iu.test(
        actionCss,
      ) &&
      /grid-template-columns\s*:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/iu.test(
        replaceActionCss,
      ) &&
      [modeItemCss, actionItemCss, replaceActionItemCss].every(
        (block) =>
          /width\s*:\s*100%/iu.test(block) &&
          /height\s*:\s*var\(--control-height\)/iu.test(block),
      ),
    responsiveReachability:
      /@media\s*\(max-width:\s*720px\)[\s\S]*\.layout-preset-dialog[\s\S]*\.layout-preset-browser[\s\S]*overflow-y\s*:\s*auto/u.test(
        styles,
      ),
  };
}

function extractTestCases(file) {
  const cases = [];
  const pattern =
    /\b(?:it|test)(?:\.each\([^)]*\))?\s*\(\s*(["'`])([\s\S]*?)\1\s*,\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{/gu;
  for (const match of file.source.matchAll(pattern)) {
    const start = match.index ?? 0;
    const next = file.source
      .slice(start + match[0].length)
      .search(/\n\s*(?:it|test)(?:\.each)?\s*\(/u);
    const end = next < 0 ? file.source.length : start + match[0].length + next;
    const body = file.source.slice(start, end);
    cases.push({ path: file.path, title: match[2], body });
  }
  return cases;
}

function assertionCount(testCase) {
  return [
    ...testCase.body.matchAll(
      /\b(?:expect|assert(?:\.[a-zA-Z]+)?|deepEqual|strictEqual)\s*\(/gu,
    ),
  ].length;
}

function behavioral(cases, patterns, minAssertions = 1) {
  return cases.some((testCase) => {
    const haystack = `${testCase.title}\n${testCase.body}`;
    return (
      patterns.every((pattern) => pattern.test(haystack)) &&
      assertionCount(testCase) >= minAssertions
    );
  });
}

function collective(cases, groups) {
  return groups.every((patterns) => behavioral(cases, patterns));
}

function renderedCountBehavior(cases, patterns) {
  return cases.some((testCase) => {
    const haystack = `${testCase.title}\n${testCase.body}`;
    return (
      patterns.every((pattern) => pattern.test(haystack)) &&
      /rerender/iu.test(testCase.body) &&
      /querySelectorAll|getAllBy/iu.test(testCase.body) &&
      /toHaveLength|\.length/iu.test(testCase.body) &&
      assertionCount(testCase) >= 2
    );
  });
}

export function inspectPhase7TestInventory(files) {
  const skippedTests = [];
  for (const file of files) {
    for (const pattern of [
      /\b(?:it|test|describe)\.skip\s*\(/gu,
      /\b(?:it|test|describe)\.todo\s*\(/gu,
      /\b(?:xit|xtest|xdescribe)\s*\(/gu,
    ]) {
      if (pattern.test(file.source)) skippedTests.push(file.path);
    }
  }
  const cases = files.flatMap(extractTestCases);
  const capabilities = {
    "statistical-registry-exact-six-and-all-projections": behavioral(cases, [
      /six|6|all statistical/iu,
      /registry|palette/iu,
      /runtime|inspector/iu,
    ]),
    "statistical-properties-ports-states-and-no-demo-data": collective(cases, [
      [/statistical|chart/iu, /propert|port/iu, /required|left|input/iu],
      [/demo|sample|persisted/iu, /data|dataset/iu],
    ]),
    "statistical-editor-runtime-theme-accessibility": behavioral(cases, [
      /statistical|chart/iu,
      /editor/iu,
      /runtime/iu,
      /theme|semantic|accessib/iu,
    ]),
    "statistical-empty-loading-error-data": behavioral(cases, [
      /EMPTY/iu,
      /LOADING/iu,
      /ERROR/iu,
      /DATA/iu,
    ]),
    "statistical-reduced-motion-and-resize-preview": behavioral(cases, [
      /reduced motion|animation/iu,
      /resize|compact|lightweight/iu,
    ]),
    "histogram-bin-count-changes-rendered-bins": renderedCountBehavior(cases, [
      /histogram/iu,
      /bin.?count/iu,
      /render|mark|bar|bin/iu,
    ]),
    "box-plot-show-outliers-changes-rendered-marks": renderedCountBehavior(
      cases,
      [/box.?plot/iu, /show.?outliers/iu, /render|mark|point|outlier/iu],
    ),
    "preset-registry-exact-22-checksum-order": behavioral(cases, [
      /22|all preset/iu,
      /checksum/iu,
      /order|registry/iu,
    ]),
    "preset-all-real-templates-count-coordinates": behavioral(cases, [
      /preset/iu,
      /real/iu,
      /element.?count|counted/iu,
      /coordinate|overlap|bound/iu,
    ]),
    "preset-required-port-placeholders": behavioral(cases, [
      /placeholder/iu,
      /port/iu,
      /UNCONNECTED|left|input/iu,
    ]),
    "preset-live-structured-preview-no-screenshot": behavioral(cases, [
      /live|structured/iu,
      /preview/iu,
      /screenshot|image/iu,
    ]),
    "preset-preview-no-write-and-apply-exact-snapshot": behavioral(cases, [
      /preview/iu,
      /no.?write|without writ|exact/iu,
      /apply|coordinate/iu,
    ]),
    "preset-coordinate-checksum-and-template-mapping": behavioral(cases, [
      /coordinate.?checksum/iu,
      /template.?id/iu,
      /tamper|order|exact/iu,
    ]),
    "preset-add-relative-geometry-and-collision": behavioral(cases, [
      /ADD/iu,
      /relative|translation/iu,
      /collision|existing/iu,
    ]),
    "preset-replace-impact-confirmation-and-locked-refusal": collective(cases, [
      [/REPLACE/iu, /impact|confirm/iu],
      [/REPLACE/iu, /locked/iu, /refus|reject|409/iu],
    ]),
    "preset-preview-expiry-stale-reuse-and-cross-scope": behavioral(cases, [
      /expir/iu,
      /stale/iu,
      /reus/iu,
      /cross.?page|cross.?preset|scope/iu,
    ]),
    "preset-apply-idempotency-and-transaction-rollback": collective(cases, [
      [/preset|apply/iu, /idempoten/iu],
      [/preset|apply/iu, /rollback|failure|interrupt/iu],
    ]),
    "preset-single-history-command-undo-redo-branch": behavioral(cases, [
      /PRESET_APPLY|preset/iu,
      /undo/iu,
      /redo/iu,
      /branch|discard/iu,
    ]),
    "preset-instance-reload-and-restart": behavioral(cases, [
      /preset/iu,
      /instance/iu,
      /reload/iu,
      /restart/iu,
    ]),
    "preset-draft-published-runtime-isolation": behavioral(cases, [
      /preset|statistical/iu,
      /draft/iu,
      /published|runtime/iu,
      /republish|immutable/iu,
    ]),
    "preset-clone-export-import-remap": behavioral(cases, [
      /preset/iu,
      /clone/iu,
      /export/iu,
      /import/iu,
      /remap|ownership/iu,
    ]),
    "preset-trash-restore-purge-ownership": behavioral(cases, [
      /preset/iu,
      /trash/iu,
      /restore/iu,
      /purge/iu,
      /orphan|ownership/iu,
    ]),
    "sqlite-v6-forward-migration-preserves-v5": behavioral(cases, [
      /preset|statistical/iu,
      /v6|version 6|migration/iu,
      /v5|version 5/iu,
      /preserv|forward/iu,
    ]),
    "suggested-schema-runtime-db-checksum-unchanged": behavioral(cases, [
      /suggested.?schema/iu,
      /runtime.?db|database/iu,
      /checksum/iu,
      /unchanged|no.?write/iu,
    ]),
    "preset-add-replace-equal-sibling-geometry": behavioral(cases, [
      /ADD|추가/iu,
      /REPLACE|교체/iu,
      /equal|geometry|same size/iu,
    ]),
    "preset-browser-responsive-419": behavioral(cases, [
      /419/iu,
      /reach|overflow|responsive/iu,
    ]),
  };
  return {
    skippedTests: [...new Set(skippedTests)].sort(),
    caseCount: cases.length,
    capabilities,
  };
}

function positiveRect(rect) {
  return (
    plainObject(rect) &&
    [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) &&
    rect.width > 0 &&
    rect.height > 0
  );
}

function sameSize(rects) {
  if (!Array.isArray(rects) || rects.length < 2 || !rects.every(positiveRect))
    return false;
  const [{ width, height }] = rects;
  return rects.every(
    (rect) =>
      Math.abs(rect.width - width) <= 0.02 &&
      Math.abs(rect.height - height) <= 0.02,
  );
}

function normalizedCoordinates(value) {
  if (!Array.isArray(value)) return null;
  const coordinates = value.map((item) => ({
    templateId: item?.templateId,
    elementId: item?.elementId,
    type: item?.type,
    x: item?.x,
    y: item?.y,
    w: item?.w,
    h: item?.h,
  }));
  if (
    coordinates.some(
      (item) =>
        typeof item.templateId !== "string" ||
        typeof item.elementId !== "string" ||
        typeof item.type !== "string" ||
        ![item.x, item.y, item.w, item.h].every(Number.isSafeInteger),
    )
  )
    return null;
  return coordinates.sort((left, right) =>
    left.templateId.localeCompare(right.templateId),
  );
}

function evidenceCoordinateChecksum(value) {
  const coordinates = normalizedCoordinates(value);
  if (coordinates === null) return null;
  return createHash("sha256")
    .update(stablePresetRegistryJson(coordinates))
    .digest("hex");
}

function sameCoordinates(left, right) {
  const normalizedLeft = normalizedCoordinates(left);
  const normalizedRight = normalizedCoordinates(right);
  return (
    normalizedLeft !== null &&
    normalizedRight !== null &&
    JSON.stringify(normalizedLeft) === JSON.stringify(normalizedRight)
  );
}

export function inspectPhase7BrowserEvidence(evidence) {
  const inventory = evidence?.presetInventory;
  const browser = evidence?.presetBrowser;
  const structured = browser?.structuredPreview;
  const add = evidence?.addApply;
  const replace = evidence?.replaceApply;
  const statistical = evidence?.statisticalRender;
  const runtime = evidence?.immutableRuntime;
  const responsive = evidence?.responsive419;
  const coordinates = normalizedCoordinates(structured?.coordinates);
  return {
    operationalPass:
      evidence?.schemaVersion === 1 &&
      evidence?.result === "PASS" &&
      evidence?.target === "isolated local browser session" &&
      /^http:\/\/127\.0\.0\.1:\d+\/$/u.test(evidence?.url ?? "") &&
      Number.isFinite(Date.parse(evidence?.generatedAt ?? "")),
    desktopViewport:
      evidence?.viewport?.width === 1280 && evidence?.viewport?.height === 720,
    exactPresetInventory:
      inventory?.expectedCount === REQUIRED_LAYOUT_PRESET_IDS.length &&
      inventory?.visibleCount === REQUIRED_LAYOUT_PRESET_IDS.length &&
      exactArray(inventory?.ids, REQUIRED_LAYOUT_PRESET_IDS),
    equalModeControls: sameSize(browser?.modeControlRects),
    equalActionControls: sameSize(browser?.actionControlRects),
    equalImpactControls: sameSize(browser?.impactActionRects),
    structuredLivePreview:
      typeof structured?.presetId === "string" &&
      structured?.usesImage === false &&
      Number.isSafeInteger(structured?.expectedElementCount) &&
      structured.expectedElementCount > 0 &&
      structured?.renderedElementCount === structured.expectedElementCount &&
      coordinates !== null &&
      coordinates.length === structured.expectedElementCount,
    previewApplyCoordinatesExact:
      add?.exactCoordinates === true &&
      add?.previewElementCount > 0 &&
      add?.appliedElementCount === add.previewElementCount &&
      sameCoordinates(add?.previewCoordinates, add?.appliedCoordinates),
    previewApplyCoordinateChecksum:
      /^[a-f0-9]{64}$/u.test(add?.previewCoordinateChecksum ?? "") &&
      add?.previewCoordinateChecksum ===
        evidenceCoordinateChecksum(add?.previewCoordinates) &&
      add?.appliedCoordinateChecksum === add.previewCoordinateChecksum &&
      add?.instanceCoordinateChecksum === add.previewCoordinateChecksum &&
      evidenceCoordinateChecksum(add?.appliedCoordinates) ===
        add.previewCoordinateChecksum,
    durableInstanceReload: add?.durableInstanceAfterReload === true,
    replaceImpactAndUndo:
      replace?.existingCount > 0 &&
      replace?.impactRemovalCount === replace.existingCount &&
      replace?.confirmationRequired === true &&
      replace?.appliedCount > 0 &&
      replace?.undoRestoredCount === replace.existingCount,
    statisticalCoverage:
      exactArray(statistical?.types, REQUIRED_STATISTICAL_ELEMENT_TYPES) &&
      Array.isArray(statistical?.semanticChartVariables) &&
      statistical.semanticChartVariables.length > 0 &&
      statistical.semanticChartVariables.every((token) =>
        /^--chart-[1-8]$/u.test(token),
      ),
    statisticalAccessibilityAndMotion:
      statistical?.accessibleTextCount >=
        REQUIRED_STATISTICAL_ELEMENT_TYPES.length &&
      statistical?.reducedMotionAnimationCount === 0 &&
      statistical?.resizePreviewDuringDrag === true &&
      statistical?.fullRenderAfterResize === true,
    immutableRuntime:
      runtime?.publishedCountBeforeDraft > 0 &&
      runtime?.publishedCountAfterDraft === runtime.publishedCountBeforeDraft &&
      runtime?.draftCountAfterApply !== runtime.publishedCountAfterDraft &&
      runtime?.publishedCountAfterRepublish === runtime.draftCountAfterApply,
    responsive419:
      responsive?.viewportWidth === 419 &&
      responsive?.documentScrollWidth === 419 &&
      responsive?.browserReachable === true &&
      responsive?.controlsReachable === true &&
      responsive?.siblingGeometryPreserved === true,
    cleanConsoleAndNetwork:
      evidence?.consoleErrorCount === 0 && evidence?.failedRequestCount === 0,
  };
}

async function loadSourceRegistries(repositoryRoot) {
  const serverRoot = resolve(repositoryRoot, "apps/server");
  const result = spawnSync(
    process.execPath,
    [
      "--conditions=development",
      "--import",
      "tsx",
      "--input-type=module",
      "--eval",
      [
        'const elements = await import("./src/elements/element-registry.ts");',
        'const presets = await import("./src/elements/layout-preset-registry.ts");',
        "process.stdout.write(JSON.stringify({elements: elements.elementRegistry(), presets: presets.layoutPresetRegistry()}));",
      ].join(" "),
    ],
    {
      cwd: serverRoot,
      encoding: "utf8",
      env: process.env,
      maxBuffer: 8 * 1024 * 1024,
    },
  );
  if (result.status !== 0) {
    throw new Error(
      `Cannot load Phase 7 source registries: ${result.stderr || result.error?.message || `exit ${result.status}`}`,
    );
  }
  return JSON.parse(result.stdout);
}

async function inspectGovernance(repositoryRoot, validation) {
  let traceability = { requirements: [] };
  try {
    traceability = JSON.parse(
      await readFile(
        resolve(repositoryRoot, "docs/requirement-traceability.json"),
        "utf8",
      ),
    );
  } catch (error) {
    validation.check(false, "Phase 7 traceability JSON can be read", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  const requirements = Object.fromEntries(
    (traceability.requirements ?? []).map((requirement) => [
      requirement.id,
      requirement,
    ]),
  );
  const requirement = requirements["REQ-012"];
  validation.check(Boolean(requirement), "REQ-012 is present in traceability");
  if (requirement) {
    validation.equal(
      requirement.phase,
      7,
      "REQ-012 remains assigned to Phase 7",
    );
    validation.check(
      [
        "IMPLEMENTED",
        "VERIFIED",
        "EXHAUSTIVELY VERIFIED",
        "OPERATIONALLY VERIFIED",
        "RELEASED",
      ].includes(requirement.status),
      "REQ-012 has reached an implemented completion state",
    );
    validation.check(
      requirement.implementation?.length > 0,
      "REQ-012 references implementation",
    );
    validation.check(
      requirement.tests?.includes("scripts/verify-phase7.mjs"),
      "REQ-012 references scripts/verify-phase7.mjs",
    );
    validation.check(
      requirement.evidence?.includes(PHASE7_EVIDENCE_PATH),
      `REQ-012 references ${PHASE7_EVIDENCE_PATH}`,
    );
    validation.check(
      requirement.evidence?.includes(PHASE7_BROWSER_EVIDENCE_PATH),
      `REQ-012 references ${PHASE7_BROWSER_EVIDENCE_PATH}`,
    );
  }
  for (const id of ["REQ-016", "REQ-018", "REQ-031", "REQ-037"]) {
    validation.check(
      requirements[id]?.phase > 7 &&
        ["NOT STARTED", "IN PROGRESS", "VERIFIED"].includes(
          requirements[id]?.status,
        ),
      `${id} remains assigned to a later Phase`,
      { requirement: requirements[id] },
    );
  }
  const adr = await readFile(
    resolve(
      repositoryRoot,
      "docs/adr/0008-statistical-elements-and-layout-presets.md",
    ),
    "utf8",
  );
  validation.check(/Status:\s*accepted/iu.test(adr), "ADR 0008 is accepted");
  validation.check(
    /256-entry, five-minute cache/iu.test(adr) &&
      /layout_preset_instances/u.test(adr) &&
      /PRESET_APPLY/u.test(adr),
    "ADR 0008 fixes preview, persistence, and history ownership",
  );
  return { requirements: Object.values(requirements) };
}

export async function validatePhase7({
  repositoryRoot = REPOSITORY_ROOT,
  includeGovernance = true,
  includePhase6Regression = true,
  includeBrowserEvidence = true,
} = {}) {
  const validation = new Validation(
    "Phase 7 Statistical Elements and Layout Preset instances",
  );
  const sourcePredicate = (path) =>
    SOURCE_EXTENSIONS.has(extname(path)) &&
    !/\.(?:test|spec)\.[^.]+$/u.test(path) &&
    !/(?:^|\/)test(?:s)?\//u.test(path);
  const serverFiles = await collectFiles(
    repositoryRoot,
    ["apps/server/src"],
    sourcePredicate,
  );
  const domainFiles = await collectFiles(
    repositoryRoot,
    ["packages/domain/src"],
    sourcePredicate,
  );
  const webFiles = await collectFiles(
    repositoryRoot,
    ["apps/web/src"],
    sourcePredicate,
  );
  const testFiles = await collectFiles(
    repositoryRoot,
    [
      "apps/server/test",
      "packages/domain/test",
      "apps/web/src",
      "e2e",
      "tests/e2e",
    ],
    (path) =>
      SOURCE_EXTENSIONS.has(extname(path)) &&
      (/\.(?:test|spec)\.[^.]+$/u.test(path) ||
        /(?:^|\/)test(?:s)?\//u.test(path)),
  );

  let registries = { elements: {}, presets: {} };
  try {
    registries = await loadSourceRegistries(repositoryRoot);
    validation.check(true, "the source Element and Preset registries execute");
  } catch (error) {
    validation.check(
      false,
      "the source Element and Preset registries execute",
      {
        error: error instanceof Error ? error.message : String(error),
      },
    );
  }

  let corpusIds = [];
  try {
    const corpus = JSON.parse(
      await readFile(
        resolve(repositoryRoot, "webeditor_project_corpus_v3.json"),
        "utf8",
      ),
    );
    corpusIds = corpus?.coverage?.layoutPresets ?? [];
    validation.check(
      exactArray(corpusIds, REQUIRED_LAYOUT_PRESET_IDS),
      "the canonical corpus fixes the accepted 22-Preset order",
    );
  } catch (error) {
    validation.check(false, "the canonical corpus can be read", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const elementInspection = inspectPhase7ElementRegistry(registries.elements);
  for (const [property, message] of [
    ["registryChecksumExact", "Element Registry checksum remains exact"],
    [
      "exactTwelveTypeOrder",
      "Element Registry preserves the ordered Phase 7 12-type prefix",
    ],
    ["exactStatisticalSix", "Phase 7 adds exactly six statistical types"],
    ["uniqueTypes", "Element Registry type IDs remain unique"],
    ["phase6ContractStillValid", "Phase 6 Element contracts remain valid"],
    ["statisticalCategory", "new definitions are statistical Elements"],
    [
      "executableProjectionKeys",
      "new definitions register all renderer and validator keys",
    ],
    [
      "requiredLeftInputPorts",
      "statistical inputs are required left-side target ports",
    ],
    [
      "allFourRenderStates",
      "statistical Elements declare all four truthful states",
    ],
    [
      "defaultsDeclaredByProperties",
      "statistical defaults are Property-declared",
    ],
    [
      "noPersistedDemoDataDefaults",
      "statistical defaults contain no demo dataset",
    ],
    ["layoutRulesValid", "statistical layout limits are bounded"],
  ])
    validation.check(elementInspection[property], message);

  const presetInspection = inspectLayoutPresetRegistry(
    registries.presets,
    registries.elements,
    corpusIds.length > 0 ? corpusIds : REQUIRED_LAYOUT_PRESET_IDS,
  );
  for (const [property, message] of [
    ["schemaVersion", "Preset Registry schema version is canonical"],
    ["checksumFormat", "Preset Registry checksum is a lowercase SHA-256"],
    [
      "checksumExact",
      "Preset Registry checksum matches independent canonicalization",
    ],
    ["exactCanonicalOrder", "Preset Registry exactly matches corpus order"],
    ["uniqueIds", "Preset IDs are unique"],
    ["exactCount", "Preset Registry contains exactly 22 entries"],
    ["allCategoriesRepresented", "all four Preset categories are represented"],
    ["definitionShapeValid", "every Preset definition has the accepted shape"],
    ["allTemplatesReal", "every Preset creates at least one real Element"],
    ["exactElementCounts", "every Preset elementCount matches its templates"],
    ["coordinatesBounded", "all Preset grid coordinates are valid"],
    ["noTemplateOverlap", "Preset templates do not overlap"],
    [
      "requiredElementsExact",
      "requiredElements exactly describes each template",
    ],
    [
      "placeholdersRequiredAndValid",
      "every Preset has valid required-port placeholders",
    ],
    [
      "suggestedSchemaReadOnlyBoundary",
      "Phase 7 never carries executable schema mutation",
    ],
    [
      "screenshotOnlyForbidden",
      "Preset previews are structural rather than screenshots",
    ],
  ])
    validation.check(presetInspection[property], message);

  const routeInspection = inspectPhase7RouteContract(serverFiles);
  validation.check(
    routeInspection.missingRoutes.length === 0,
    "all accepted Phase 7 routes are registered",
    { missing: routeInspection.missingRoutes.map(routeKey) },
  );
  validation.check(
    routeInspection.unversionedRoutes.length === 0,
    "Phase 7 routes are versioned",
    { routes: routeInspection.unversionedRoutes.map(routeKey) },
  );

  const schemaInspection = inspectPhase7Schema(combinedSource(serverFiles));
  for (const [property, message] of [
    ["latestVersionAtLeastSix", "metadata schema advances to at least v6"],
    ["namedVersionSixMigration", "the accepted named v6 migration is present"],
    ["schemaChecksumExported", "the v6 migration checksum is exported"],
    ["futureVersionFailClosed", "unknown future metadata versions fail closed"],
    ["migrationTransactional", "v6 migration runs transactionally"],
    ["instanceTable", "durable Preset instances are stored"],
    ["membershipTable", "stable template-to-Element membership is stored"],
    ["placeholderTable", "required-port placeholders are stored"],
    ["instanceOwnership", "Preset instances constrain lifecycle history state"],
    ["membershipOwnership", "Preset membership has cascading ownership"],
    ["placeholderOwnership", "placeholders have cascading composite ownership"],
    [
      "presetCommandConstrained",
      "SQLite accepts PRESET_APPLY history commands",
    ],
    [
      "priorCommandTypesPreserved",
      "all Phase 5–6 Element command types remain allowed",
    ],
  ])
    validation.check(schemaInspection[property], message);

  const backendInspection = inspectPhase7Backend([
    ...serverFiles,
    ...domainFiles,
  ]);
  for (const [property, message] of [
    [
      "deterministicPresetRegistry",
      "Preset Registry is deterministic and checksummed",
    ],
    [
      "presetDefinitionAllowlist",
      "Preset detail reads use the Registry allowlist",
    ],
    [
      "previewCapacityAndTtl",
      "Preview cache is bounded to 256 entries and five minutes",
    ],
    [
      "previewScopeBound",
      "Preview snapshots are bound to every accepted scope field",
    ],
    [
      "previewNoDurableWrite",
      "Preview storage is transient and performs no durable write",
    ],
    [
      "applySnapshotOnly",
      "Apply consumes only an idempotent server preview snapshot",
    ],
    [
      "coordinateChecksumBoundary",
      "Preview and durable Apply share a canonical coordinate checksum",
    ],
    ["addAndReplace", "ADD and REPLACE modes are both implemented"],
    ["lockedReplaceRefusal", "REPLACE refuses locked Element removal"],
    [
      "oneRevisionAdvance",
      "Preset Apply advances Project and layout revisions",
    ],
    ["atomicPresetHistory", "Preset Apply records one atomic history command"],
    [
      "durableInstanceReads",
      "instance, membership, and placeholder rows are durable",
    ],
    [
      "suggestedSchemaNotExecuted",
      "Preset service does not execute suggested schema",
    ],
    [
      "lifecycleSnapshotExport",
      "Project export preserves original Preset instance snapshots",
    ],
    [
      "lifecycleSnapshotImportRemap",
      "Clone and import remap Preset membership and placeholder ownership",
    ],
    [
      "lifecycleAndDefinitionOwnership",
      "Preset ownership participates in project lifecycle definitions",
    ],
  ])
    validation.check(backendInspection[property], message);

  const frontendInspection = inspectPhase7Frontend(webFiles);
  for (const [property, message] of [
    [
      "apiContract",
      "web API exposes Registry, Preview, Apply, and instance reads",
    ],
    ["browserProjectsRegistry", "Preset Browser is Registry-generated"],
    [
      "liveStructuredPreview",
      "Preset preview renders live template coordinates",
    ],
    ["previewBeforeApply", "Apply requires a server Preview ID"],
    [
      "addReplaceControls",
      "Preset Browser exposes concise ADD and REPLACE choices",
    ],
    [
      "replaceImpactConfirmation",
      "REPLACE shows impact and explicit confirmation",
    ],
    ["warningBadge", "unconnected required ports show a warning Badge"],
    [
      "allStatisticalRendererKeys",
      "Editor and Runtime cover all six renderer keys",
    ],
    [
      "separateEditorRuntimeRenderers",
      "Editor and Runtime renderer ownership stays separate",
    ],
    [
      "semanticChartTokens",
      "charts use semantic chart tokens without raw palette colors",
    ],
    ["accessibleCharts", "statistical charts expose accessible text"],
    [
      "reducedMotionAndResize",
      "charts disable animation and support lightweight resize",
    ],
    [
      "histogramBinCountMaterialized",
      "Histogram binCount changes rendered bins",
    ],
    [
      "boxOutlierMarksMaterialized",
      "Box Plot showOutliers changes rendered marks",
    ],
    ["truthfulStates", "statistical renderers implement all four states"],
    [
      "previewFixtureScoped",
      "illustrative data is scoped only to Preset preview",
    ],
    ["equalSiblingGeometry", "Preset sibling controls share explicit geometry"],
    [
      "responsiveReachability",
      "Preset Browser stays reachable at narrow width",
    ],
  ])
    validation.check(frontendInspection[property], message);

  const testInspection = inspectPhase7TestInventory(testFiles);
  validation.check(
    testInspection.skippedTests.length === 0,
    "Phase 7 tests contain no skip or TODO cases",
    { skipped: testInspection.skippedTests },
  );
  for (const capability of REQUIRED_PHASE7_TEST_CAPABILITIES) {
    validation.check(
      testInspection.capabilities[capability],
      `behavioral test inventory covers ${capability}`,
    );
  }

  let browserInspection = null;
  if (includeBrowserEvidence) {
    let evidence = {};
    try {
      evidence = JSON.parse(
        await readFile(
          resolve(repositoryRoot, PHASE7_BROWSER_EVIDENCE_PATH),
          "utf8",
        ),
      );
    } catch (error) {
      validation.check(false, "Phase 7 browser evidence can be read", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    browserInspection = inspectPhase7BrowserEvidence(evidence);
    for (const [property, message] of [
      [
        "operationalPass",
        "isolated local Phase 7 browser verification is recorded",
      ],
      ["desktopViewport", "desktop verification uses 1280×720"],
      ["exactPresetInventory", "all 22 Presets are visible in canonical order"],
      ["equalModeControls", "ADD and REPLACE controls have equal geometry"],
      ["equalActionControls", "Preview and Apply controls have equal geometry"],
      [
        "equalImpactControls",
        "impact dialog sibling actions have equal geometry",
      ],
      [
        "structuredLivePreview",
        "Browser shows a real coordinate-based Preview",
      ],
      [
        "previewApplyCoordinatesExact",
        "Preview and applied grid coordinates are identical",
      ],
      [
        "previewApplyCoordinateChecksum",
        "Preview and applied coordinate checksums are identical",
      ],
      ["durableInstanceReload", "applied Preset instance survives reload"],
      [
        "replaceImpactAndUndo",
        "REPLACE impact, confirmation, and Undo are verified",
      ],
      [
        "statisticalCoverage",
        "all six statistical types use semantic chart variables",
      ],
      [
        "statisticalAccessibilityAndMotion",
        "statistical a11y, motion, and resize behavior pass",
      ],
      [
        "immutableRuntime",
        "Draft Preset Apply stays out of Runtime until republish",
      ],
      ["responsive419", "419px Preset Browser is bounded and reachable"],
      [
        "cleanConsoleAndNetwork",
        "browser console and required requests are clean",
      ],
    ])
      validation.check(browserInspection[property], message);
  }

  let phase6Regression = null;
  if (includePhase6Regression) {
    phase6Regression = await validatePhase6({
      repositoryRoot,
      includeGovernance: false,
      includePhase5Regression: true,
      includeBrowserEvidence: false,
    });
    validation.check(
      phase6Regression.result === "PASS",
      "Phase 0–6 regression remains green",
      { failures: phase6Regression.failures },
    );
  }

  const governance = includeGovernance
    ? await inspectGovernance(repositoryRoot, validation)
    : { requirements: [] };
  return validation.result({
    elementInspection,
    presetInspection,
    routeInspection,
    schemaInspection,
    backendInspection,
    frontendInspection,
    testInventory: testInspection,
    browserInspection,
    phase6RegressionResult: phase6Regression?.result ?? "NOT_RUN",
    governanceRequirementCount: governance.requirements.length,
    requiredEvidencePath: PHASE7_EVIDENCE_PATH,
    browserEvidencePath: PHASE7_BROWSER_EVIDENCE_PATH,
  });
}

if (isMainModule(import.meta.url)) {
  try {
    await finishVerification(PHASE7_EVIDENCE_PATH, await validatePhase7());
  } catch (error) {
    await finishVerification(
      PHASE7_EVIDENCE_PATH,
      unexpectedFailure(
        "Phase 7 Statistical Elements and Layout Preset instances",
        error,
      ),
    );
  }
}
