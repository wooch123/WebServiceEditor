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
  extractRouteInventory,
  routeKey,
  validatePhase5,
} from "./verify-phase5.mjs";

export const PHASE6_EVIDENCE_PATH =
  "artifacts/phase6/element-registry-inspector-validation.json";
export const PHASE6_BROWSER_EVIDENCE_PATH =
  "artifacts/phase6/browser-inspector-validation.json";

export const REQUIRED_PHASE6_REQUIREMENTS = Object.freeze(["REQ-015"]);
export const REQUIRED_PHASE6_ELEMENT_TYPES = Object.freeze([
  "text",
  "button",
  "container",
  "kpi-card",
  "number-input",
  "data-table",
]);
export const REQUIRED_PROPERTY_TABS = Object.freeze([
  "general",
  "style",
  "data",
  "interaction",
  "validation",
  "advanced",
]);
export const REQUIRED_RENDER_STATES = Object.freeze([
  "EMPTY",
  "LOADING",
  "ERROR",
  "DATA",
]);
export const REQUIRED_COMMAND_TYPES = Object.freeze([
  "ADD",
  "MOVE",
  "RESIZE",
  "LOCK",
  "BATCH_LAYOUT",
  "DELETE",
  "PROPERTIES",
]);
export const REQUIRED_COMMON_PROPERTY_IDS = Object.freeze([
  "general.displayName",
  "general.internalName",
  "general.elementId",
  "general.visible",
  "general.disabled",
  "general.locked",
  "general.tooltip",
  "general.accessibilityLabel",
  "style.width",
  "style.height",
  "style.padding",
  "style.margin",
  "style.backgroundToken",
  "style.backgroundCustom",
  "style.borderToken",
  "style.borderWidth",
  "style.borderStyle",
  "style.radius",
  "style.shadow",
  "style.textColorToken",
  "style.fontSize",
  "style.fontWeight",
  "style.textAlign",
  "style.contentAlign",
  "data.bindingStatus",
  "interaction.supportedEvents",
  "validation.status",
  "advanced.type",
  "advanced.typeVersion",
]);

const PROPERTY_CONTROLS = Object.freeze([
  "text",
  "textarea",
  "number",
  "slider",
  "switch",
  "select",
  "theme-token",
  "color",
  "icon",
  "field-ref",
  "page-ref",
  "binding-ref",
  "read-only",
  "binding-status",
]);

export const CANONICAL_PHASE6_ROUTES = Object.freeze([
  { method: "GET", path: "/api/v1/elements/registry" },
  { method: "GET", path: "/api/v1/elements/registry/:elementType" },
  { method: "GET", path: "/api/v1/elements/:elementId" },
  { method: "PATCH", path: "/api/v1/elements/:elementId" },
  {
    method: "GET",
    path: "/api/v1/projects/:projectId/element-history",
  },
  {
    method: "POST",
    path: "/api/v1/projects/:projectId/element-history/undo",
  },
  {
    method: "POST",
    path: "/api/v1/projects/:projectId/element-history/redo",
  },
  {
    method: "GET",
    path: "/api/v1/runtime/:projectId/pages/:pageId",
  },
]);

export const REQUIRED_PHASE6_TEST_CAPABILITIES = Object.freeze([
  "registry-checksum-order-and-detail-api",
  "registry-one-entry-all-projections",
  "registry-schema-and-defaults-exhaustive",
  "sqlite-v5-forward-migration-preserves-v4",
  "property-validation-security-and-no-write",
  "property-save-reload-restart-and-idempotency",
  "property-revision-conflict-and-rollback",
  "history-all-command-types",
  "history-undo-redo-exact-and-monotonic",
  "history-linear-branch-discard",
  "history-success-only-and-operation-idempotency",
  "history-cross-project-and-stale-command-rejection",
  "lifecycle-property-and-history-preservation",
  "immutable-published-runtime-source",
  "runtime-hidden-and-page-ownership",
  "palette-inspector-inventory-registry-projection",
  "all-property-tabs-and-fields-generated",
  "property-debounce-blur-ack-and-retry",
  "property-race-and-input-key-isolation",
  "pending-property-action-coordination",
  "truthful-binding-status-and-render-states",
  "editor-runtime-renderer-separation",
  "runtime-all-types-and-grid-layout",
  "undo-redo-controls-and-shortcuts",
  "equal-sibling-control-geometry",
  "responsive-right-inspector",
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

function sortedObject(value) {
  if (Array.isArray(value)) return value.map(sortedObject);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => [key, sortedObject(value[key])]),
  );
}

export function stableRegistryJson(value) {
  return JSON.stringify(sortedObject(value));
}

export function calculateRegistryChecksum(registry) {
  const payload = {
    schemaVersion: registry.schemaVersion,
    tabs: registry.tabs,
    definitions: registry.definitions,
  };
  return createHash("sha256").update(stableRegistryJson(payload)).digest("hex");
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

export function inspectRegistrySnapshot(registry) {
  const definitions = Array.isArray(registry?.definitions)
    ? registry.definitions
    : [];
  const tabs = Array.isArray(registry?.tabs) ? registry.tabs : [];
  const typeOrder = definitions.map((definition) => definition?.type);
  const tabOrder = tabs.map((tab) => tab?.id);
  const allFields = definitions.flatMap((definition) =>
    Array.isArray(definition?.propertySchema?.fields)
      ? definition.propertySchema.fields.map((field) => ({
          elementType: definition.type,
          ...field,
        }))
      : [],
  );
  const requiredDefinitionKeys = [
    "type",
    "typeVersion",
    "label",
    "description",
    "category",
    "iconName",
    "rendererKey",
    "editorRendererKey",
    "runtimeRendererKey",
    "validatorKey",
    "defaultName",
    "defaultProps",
    "defaultStyle",
    "defaultEvents",
    "layout",
    "propertySchema",
    "bindingPorts",
    "events",
    "supportedRenderStates",
    "migrations",
  ];
  const definitionShapeValid = definitions.every(
    (definition) =>
      requiredDefinitionKeys.every(
        (key) =>
          Object.prototype.hasOwnProperty.call(definition ?? {}, key) &&
          definition[key] !== undefined,
      ) &&
      Number.isSafeInteger(definition.typeVersion) &&
      definition.typeVersion > 0 &&
      [
        definition.type,
        definition.label,
        definition.description,
        definition.iconName,
        definition.rendererKey,
        definition.editorRendererKey,
        definition.runtimeRendererKey,
        definition.validatorKey,
        definition.defaultName,
      ].every((value) => typeof value === "string" && value.length > 0) &&
      [
        definition.rendererKey,
        definition.editorRendererKey,
        definition.runtimeRendererKey,
        definition.validatorKey,
      ].every((value) => value === definition.type) &&
      ["basic", "input", "data", "statistics"].includes(definition.category) &&
      definition.defaultProps !== null &&
      typeof definition.defaultProps === "object" &&
      !Array.isArray(definition.defaultProps) &&
      definition.defaultStyle !== null &&
      typeof definition.defaultStyle === "object" &&
      !Array.isArray(definition.defaultStyle) &&
      Array.isArray(definition.defaultEvents) &&
      Array.isArray(definition?.propertySchema?.fields) &&
      definition.propertySchema.fields.length > 0 &&
      Array.isArray(definition.bindingPorts) &&
      Array.isArray(definition.events) &&
      Array.isArray(definition.supportedRenderStates) &&
      Array.isArray(definition.migrations) &&
      definition.migrations.every(
        (migration) =>
          Number.isSafeInteger(migration?.fromVersion) &&
          Number.isSafeInteger(migration?.toVersion) &&
          migration.fromVersion > 0 &&
          migration.toVersion > migration.fromVersion &&
          typeof migration.migrationKey === "string" &&
          migration.migrationKey.length > 0,
      ),
  );
  const layoutRulesValid = definitions.every((definition) => {
    const layout = definition?.layout;
    return (
      layout !== null &&
      typeof layout === "object" &&
      ["defaultW", "defaultH", "minW", "minH", "maxW", "maxH"].every(
        (key) => Number.isSafeInteger(layout[key]) && layout[key] > 0,
      ) &&
      layout.minW <= layout.defaultW &&
      layout.defaultW <= layout.maxW &&
      layout.minH <= layout.defaultH &&
      layout.defaultH <= layout.maxH &&
      layout.maxW <= 24
    );
  });
  const fieldShapeValid = allFields.every(
    (field) =>
      typeof field.id === "string" &&
      field.id.length > 0 &&
      REQUIRED_PROPERTY_TABS.includes(field.tab) &&
      field.id.startsWith(`${field.tab}.`) &&
      typeof field.label === "string" &&
      field.label.length > 0 &&
      PROPERTY_CONTROLS.includes(field.control) &&
      ["string", "number", "boolean", "enum"].includes(field.valueType) &&
      ["element", "props", "style", "layout", "computed"].includes(
        field.target,
      ) &&
      typeof field.required === "boolean" &&
      typeof field.readOnly === "boolean" &&
      (field.description === undefined ||
        (typeof field.description === "string" &&
          field.description.length > 0)) &&
      (field.options === undefined ||
        (Array.isArray(field.options) &&
          field.options.length > 0 &&
          uniqueStrings(field.options.map((option) => option?.value)) &&
          field.options.every(
            (option) =>
              typeof option?.value === "string" &&
              typeof option?.label === "string" &&
              option.label.length > 0,
          ))) &&
      (!["select", "theme-token"].includes(field.control) ||
        (field.valueType === "enum" && field.options?.length > 0)) &&
      (field.control !== "switch" || field.valueType === "boolean") &&
      (!["number", "slider"].includes(field.control) ||
        field.valueType === "number") &&
      (![
        "text",
        "textarea",
        "color",
        "icon",
        "field-ref",
        "page-ref",
        "binding-ref",
        "binding-status",
      ].includes(field.control) ||
        field.valueType === "string") &&
      [field.min, field.max, field.step].every(
        (value) => value === undefined || Number.isFinite(value),
      ) &&
      (field.min === undefined ||
        field.max === undefined ||
        field.min <= field.max) &&
      (field.step === undefined || field.step > 0) &&
      (field.maxLength === undefined ||
        (Number.isSafeInteger(field.maxLength) && field.maxLength > 0)),
  );
  const uniqueFieldsPerDefinition = definitions.every((definition) => {
    const ids = (definition?.propertySchema?.fields ?? []).map(
      (field) => field.id,
    );
    return uniqueStrings(ids);
  });
  const commonFieldsComplete = definitions.every((definition) => {
    const ids = new Set(
      (definition?.propertySchema?.fields ?? []).map((field) => field.id),
    );
    return REQUIRED_COMMON_PROPERTY_IDS.every((id) => ids.has(id));
  });
  const portsValid = definitions.every((definition) =>
    (definition?.bindingPorts ?? []).every(
      (port) =>
        typeof port.id === "string" &&
        port.id.length > 0 &&
        ((port.direction === "input" && port.side === "left") ||
          (port.direction === "output" && port.side === "right")) &&
        typeof port.valueType === "string" &&
        typeof port.required === "boolean" &&
        (port.maxConnections === null ||
          (Number.isSafeInteger(port.maxConnections) &&
            port.maxConnections > 0)),
    ),
  );
  const eventsValid = definitions.every(
    (definition) =>
      uniqueStrings((definition?.events ?? []).map((event) => event.id)) &&
      (definition?.events ?? []).every(
        (event) => typeof event.label === "string" && event.label.length > 0,
      ),
  );
  const categories = new Set(
    definitions.map((definition) => definition.category),
  );
  const computedChecksum = calculateRegistryChecksum({
    schemaVersion: registry?.schemaVersion,
    tabs,
    definitions,
  });
  return {
    schemaVersion: registry?.schemaVersion === 1,
    checksumFormat: /^[a-f0-9]{64}$/u.test(registry?.checksum ?? ""),
    checksumExact: registry?.checksum === computedChecksum,
    typeOrderExact:
      typeOrder.length >= REQUIRED_PHASE6_ELEMENT_TYPES.length &&
      REQUIRED_PHASE6_ELEMENT_TYPES.every(
        (type, index) => typeOrder[index] === type,
      ),
    tabOrderExact: exactArray(tabOrder, REQUIRED_PROPERTY_TABS),
    uniqueTypes: uniqueStrings(typeOrder),
    uniqueTabs: uniqueStrings(tabOrder),
    definitionShapeValid,
    layoutRulesValid,
    fieldShapeValid,
    uniqueFieldsPerDefinition,
    commonFieldsComplete,
    allTabsRepresented: REQUIRED_PROPERTY_TABS.every((tab) =>
      allFields.some((field) => field.tab === tab),
    ),
    portsValid,
    eventsValid,
    categoriesComplete: ["basic", "input", "data", "statistics"].every(
      (category) => categories.has(category),
    ),
    renderStatesComplete: definitions.every((definition) => {
      const states = definition.supportedRenderStates;
      const statesValid =
        uniqueStrings(states) &&
        states.includes("DATA") &&
        states.every((state) => REQUIRED_RENDER_STATES.includes(state));
      return ["data", "statistics"].includes(definition.category)
        ? statesValid && exactArray(states, REQUIRED_RENDER_STATES)
        : statesValid;
    }),
    definitionCount: definitions.length,
    propertyFieldCount: allFields.length,
    typeOrder,
    tabOrder,
    computedChecksum,
    propertyInventory: allFields.map((field) => ({
      elementType: field.elementType,
      id: field.id,
      tab: field.tab,
      control: field.control,
      target: field.target,
      readOnly: field.readOnly,
    })),
  };
}

function uniqueRoutes(routes) {
  return [...new Map(routes.map((route) => [routeKey(route), route])).values()];
}

function extractPhase6Routes(source) {
  const routes = extractRouteInventory(source);
  const loopOperations =
    /for\s*\(\s*const\s+(?<name>[A-Za-z_$][\w$]*)\s+of\s+\[\s*["']undo["']\s*,\s*["']redo["']\s*\]/u.exec(
      source,
    )?.groups;
  if (!loopOperations?.name) return routes;
  const marker = `\${${loopOperations.name}}`;
  return routes.flatMap((route) =>
    route.path.includes(marker)
      ? [
          route,
          { ...route, path: route.path.replace(marker, "undo") },
          { ...route, path: route.path.replace(marker, "redo") },
        ]
      : [route],
  );
}

export function inspectPhase6RouteContract(files) {
  const actualRoutes = uniqueRoutes(
    files.flatMap(({ source }) => extractPhase6Routes(source)),
  ).sort((left, right) => routeKey(left).localeCompare(routeKey(right)));
  const actualKeys = new Set(actualRoutes.map(routeKey));
  const missingRoutes = CANONICAL_PHASE6_ROUTES.filter(
    (route) => !actualKeys.has(routeKey(route)),
  );
  const unversionedRoutes = actualRoutes.filter((route) =>
    /^\/(?:elements|projects|runtime)(?:\/|$)/u.test(route.path),
  );
  return { actualRoutes, missingRoutes, unversionedRoutes };
}

function tableBlock(source, tableName) {
  const escaped = tableName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = new RegExp(
    `create\\s+table(?:\\s+if\\s+not\\s+exists)?\\s+["'\\x60\\[]?${escaped}["'\\x60\\]]?\\s*\\(`,
    "iu",
  ).exec(source);
  if (!match) return "";
  const open = source.indexOf("(", match.index);
  let depth = 0;
  let quote = null;
  for (let index = open; index < source.length; index += 1) {
    const character = source[index];
    if (quote !== null) {
      if (character === quote && source[index - 1] !== "\\") quote = null;
      continue;
    }
    if (["'", '"', "`"].includes(character)) {
      quote = character;
      continue;
    }
    if (character === "(") depth += 1;
    if (character === ")") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, index);
    }
  }
  return "";
}

export function inspectPhase6Schema(source) {
  const migrationContext =
    /(?:elementRegistryPropertiesHistory|element-registry-properties-history)[\s\S]{0,24000}/iu.exec(
      source,
    )?.[0] ?? "";
  const commands =
    tableBlock(migrationContext, "element_commands_v5") ||
    tableBlock(migrationContext, "element_commands") ||
    tableBlock(source, "element_commands");
  const operations =
    tableBlock(migrationContext, "element_history_operations") ||
    tableBlock(source, "element_history_operations");
  const elements =
    tableBlock(migrationContext, "elements_v5") ||
    tableBlock(migrationContext, "elements") ||
    tableBlock(source, "elements");
  return {
    latestVersionAtLeastFive:
      /LATEST_METADATA_SCHEMA_VERSION\s*=\s*(?:[5-9]|[1-9]\d+)\b/u.test(source),
    versionFiveMigration:
      /version\s*:\s*5\b/u.test(source) &&
      /element-registry-properties-history/iu.test(source),
    futureVersionFailClosed:
      /userVersion\s*>\s*LATEST_METADATA_SCHEMA_VERSION/u.test(source) &&
      /Refusing unknown future metadata schema version/u.test(source),
    migrationTransactional:
      /\.transaction\s*\(/u.test(source) &&
      /migrate\.immediate\s*\(/u.test(source),
    elementTypeNotDuplicatedInSql:
      elements.length > 0 &&
      !/\btype\s+[\s\S]{0,500}check\s*\([\s\S]{0,500}["']text["']/iu.test(
        elements,
      ),
    propertyCommandConstrained:
      /command_type[\s\S]{0,1000}["']PROPERTIES["']/iu.test(commands),
    allCommandTypesConstrained: REQUIRED_COMMAND_TYPES.every((type) =>
      new RegExp(`["']${type}["']`, "u").test(commands),
    ),
    historyStateConstrained:
      /history_state/iu.test(commands) &&
      ["APPLIED", "UNDONE", "DISCARDED"].every((state) =>
        new RegExp(`["']${state}["']`, "u").test(commands),
      ),
    historySequenceConstrained:
      /history_sequence/iu.test(commands) &&
      /history_sequence[\s\S]{0,180}(?:integer|check|unique)/iu.test(commands),
    historyBeforeAfterPreserved:
      /before_json/iu.test(commands) && /after_json/iu.test(commands),
    historyOperationTable:
      operations.length > 0 &&
      [
        "project_id",
        "command_id",
        "requested_command_id",
        "operation_type",
        "idempotency_key",
        "request_hash",
        "response_status",
        "response_json",
      ].every((column) => new RegExp(`\\b${column}\\b`, "iu").test(operations)),
    historyOperationIdempotency:
      /unique\s*\(\s*project_id\s*,\s*idempotency_key\s*\)/iu.test(
        operations,
      ) &&
      /foreign\s+key\s*\(\s*command_id\s*,\s*project_id\s*\)\s*references\s+element_commands\s*\(\s*id\s*,\s*project_id\s*\)/iu.test(
        operations,
      ) &&
      /response_status/iu.test(operations),
    schemaCopyIntegrityEvidence:
      /insert\s+into\s+[\w"'`]+[\s\S]{0,2000}select/iu.test(migrationContext) &&
      /(?:count|integrity|foreign_key_check|quick_check|checksum)/iu.test(
        migrationContext,
      ),
    commandsPresent: commands.length > 0,
    operationsPresent: operations.length > 0,
  };
}

export function inspectPhase6Backend(files) {
  const registry = sourceForPath(files, /element-registry/iu);
  const service = sourceForPath(files, /elements\/element-service/iu);
  const repository = sourceForPath(files, /elements\/element-repository/iu);
  const runtime = sourceForPath(files, /pages\/page-service|runtime/iu);
  const routes = sourceForPath(files, /routes\/elements|routes\/pages/iu);
  const propertyContext = `${registry}\n${service}`;
  const runtimeContext =
    /(?:runtimePage|runtime.*pages|published.*element)[\s\S]{0,10000}/iu.exec(
      `${runtime}\n${routes}`,
    )?.[0] ?? "";
  return {
    deterministicRegistryApi:
      /ELEMENT_REGISTRY_CHECKSUM|registryChecksum/iu.test(registry) &&
      /schemaVersion/iu.test(registry) &&
      /definitions/iu.test(registry) &&
      /tabs/iu.test(registry),
    registryValidatesTypeVersion:
      /elementDefinition\s*\(|ELEMENT_DEFINITIONS|byType/iu.test(registry) &&
      /typeVersion|ELEMENT_TYPE_VERSION/iu.test(registry) &&
      /INVALID_ELEMENT_TYPE|ELEMENT_TYPE_VERSION/iu.test(registry),
    registryDetailRejectsUnknown:
      /registry\/:elementType|elementType/iu.test(routes) &&
      /ELEMENT_NOT_FOUND|INVALID_ELEMENT_TYPE/u.test(
        `${routes}\n${registry}`,
      ) &&
      /400|404/u.test(`${routes}\n${registry}`),
    strictPropertyAllowlist:
      /propertySchema/iu.test(propertyContext) &&
      /fieldById\s*\.\s*get|propertySchema\s*\.\s*fields\s*\.\s*find|propertyField(?:ById)?/iu.test(
        propertyContext,
      ) &&
      /UNKNOWN_ELEMENT_PROPERTY|PROPERTY.*UNKNOWN|unknown/iu.test(
        propertyContext,
      ),
    rejectsPrototypeSensitiveKeys:
      /__proto__/u.test(propertyContext) &&
      /prototype/u.test(propertyContext) &&
      /constructor/u.test(propertyContext),
    validatesPropertyTypesAndBounds:
      /valueType/iu.test(propertyContext) &&
      /readOnly/iu.test(propertyContext) &&
      /required/iu.test(propertyContext) &&
      /Number\.isFinite/iu.test(propertyContext) &&
      /maxLength/iu.test(propertyContext) &&
      /\bmin\b/iu.test(propertyContext) &&
      /\bmax\b/iu.test(propertyContext),
    propertyMutationTransactional:
      /PROPERTIES/u.test(service) &&
      /transaction\s*\(/u.test(service) &&
      /projectRevision|bumpProjectRevision/u.test(propertyContext),
    historyDurable:
      /history_state|historyState/iu.test(repository) &&
      /APPLIED/u.test(repository) &&
      /UNDONE/u.test(repository) &&
      /DISCARDED/u.test(repository),
    historyLinearBranch:
      /DISCARDED/u.test(`${service}\n${repository}`) &&
      /(?:discard|abandon)[\s\S]{0,500}(?:redo|undone|branch)/iu.test(
        `${service}\n${repository}`,
      ),
    historySuccessOnly:
      /response_status|responseStatus/iu.test(repository) &&
      /(?:<\s*400|between\s+200\s+and\s+399|success)/iu.test(
        `${service}\n${repository}`,
      ),
    undoRedoOptimisticIdempotent:
      /expectedProjectRevision/iu.test(service) &&
      /expectedCommandId/iu.test(service) &&
      /idempotencyKey/iu.test(service) &&
      /request_hash|requestHash/iu.test(`${service}\n${repository}`),
    undoRedoMonotonic:
      /revision\s*=\s*revision\s*\+\s*1|revision\s*\+\s*1|bumpProjectRevision/iu.test(
        `${service}\n${repository}`,
      ) &&
      /layoutRevision|desktop_revision/iu.test(`${service}\n${repository}`),
    immutableRuntimeSource:
      /latestVersion|project_versions|snapshot_json/iu.test(runtimeContext) &&
      !/listActiveForProject|elementRepository\.listActive/iu.test(
        runtimeContext,
      ),
    runtimeFiltersPageAndHidden:
      /pageId|page\.id/iu.test(runtimeContext) &&
      /hidden/iu.test(runtimeContext),
    lifecycleOwnsProperties: ["props", "style", "events", "elements"].every(
      (term) =>
        new RegExp(`\\b${term}\\b`, "iu").test(
          sourceForPath(files, /project-service/iu),
        ),
    ),
  };
}

function cssBlock(source, selector) {
  const index = source.indexOf(selector);
  if (index < 0) return "";
  const open = source.indexOf("{", index + selector.length);
  const close = source.indexOf("}", open + 1);
  return open < 0 || close < 0 ? "" : source.slice(open + 1, close);
}

export function inspectPhase6Frontend(files) {
  const palette = sourceForPath(files, /ElementPalette/iu);
  const inspector = sourceForPath(
    files,
    /PropertyInspector|ElementInspector/iu,
  );
  const definitions = sourceForPath(files, /element-definitions/iu);
  const editorRenderer = sourceForPath(files, /ElementRenderer/iu);
  const runtimeRenderer = sourceForPath(
    files,
    /RuntimeElementRenderer|PublishedRuntime/iu,
  );
  const runtime = sourceForPath(files, /PublishedRuntime/iu);
  const workspace = sourceForPath(files, /ElementWorkspace/iu);
  const api = sourceForPath(files, /services\/elements-api/iu);
  const app = sourceForPath(files, /apps\/web\/src\/App\.tsx$/u);
  const styles = sourceForPath(files, /styles\.css$/u);
  const localHardcodedTypes =
    /export\s+type\s+ElementType\s*=\s*["']text["'][\s\S]{0,400}["']button["']/u.test(
      api,
    );
  const inspectorTabCss =
    cssBlock(styles, '.property-tabs-list [data-slot="tabs-trigger"]') ||
    cssBlock(styles, ".property-inspector-tabs") ||
    cssBlock(styles, ".inspector-tabs");
  const inspectorActionCss =
    cssBlock(styles, '.element-inspector-actions [data-slot="button"]') ||
    cssBlock(styles, ".element-inspector-actions button");
  const historyCss =
    cssBlock(styles, '.element-history-controls [data-slot="button"]') ||
    cssBlock(styles, ".element-history-controls button");
  const workspaceCss = cssBlock(styles, ".editor-workspace");
  return {
    loadsRegistryApi:
      /listElementRegistry/iu.test(api) &&
      /elements\/registry/iu.test(api) &&
      /listElementRegistry/iu.test(`${workspace}\n${palette}`),
    paletteProjectsRegistry:
      /definitions\.map|registry\.definitions|elementDefinitions\.map/iu.test(
        palette,
      ) && !/canvasElementDefinitions\s*=\s*\[/u.test(definitions),
    inspectorProjectsSchema:
      /propertySchema\.fields|definition\.propertySchema/iu.test(inspector) &&
      /registry\??\.tabs[\s\S]{0,120}\.map|ELEMENT_PROPERTY_TABS/iu.test(
        inspector,
      ),
    inventoryProjectsRegistry:
      /inventory|registry/iu.test(`${definitions}\n${inspector}`) &&
      /definitions/iu.test(`${definitions}\n${inspector}`),
    editorRendererCoversRegistry:
      /renderer.*type|editorRenderer|rendererByType/iu.test(editorRenderer) &&
      /number-input/u.test(editorRenderer) &&
      /data-table/u.test(editorRenderer),
    runtimeRendererCoversRegistry:
      /RuntimeElementRenderer|runtimeRenderer/iu.test(runtimeRenderer) &&
      /number-input/u.test(runtimeRenderer) &&
      /data-table/u.test(runtimeRenderer),
    runtimeRendererSeparate:
      runtime.length > 0 &&
      !/ElementCanvas|PropertyInspector|ElementInspector|react-grid-layout/iu.test(
        runtime,
      ) &&
      runtimeRenderer !== editorRenderer,
    noDuplicatedLocalTypeUnion: !localHardcodedTypes,
    allSixTabs:
      (REQUIRED_PROPERTY_TABS.every((tab) =>
        new RegExp(`["']${tab}["']`, "u").test(`${inspector}\n${api}`),
      ) ||
        /registry\??\.tabs[\s\S]{0,120}\.map/iu.test(inspector)) &&
      /role=["']tablist["']|<Tabs\b/u.test(inspector),
    schemaControlProjection:
      /switch|checkbox|boolean/iu.test(inspector) &&
      /select|enum/iu.test(inspector) &&
      /theme-token/iu.test(inspector) &&
      /textarea/iu.test(inspector) &&
      /number/iu.test(inspector) &&
      /slider/iu.test(inspector) &&
      /color/iu.test(inspector) &&
      /icon/iu.test(inspector) &&
      /field-ref/iu.test(inspector) &&
      /page-ref/iu.test(inspector) &&
      /binding-ref/iu.test(inspector) &&
      /read-only|readOnly/iu.test(inspector) &&
      /binding-status|BindingStatus/iu.test(inspector),
    propertyDebounceAndBlur:
      /\b500\b/u.test(inspector) &&
      /setTimeout|debounce/iu.test(inspector) &&
      /onBlur|flush/iu.test(inspector),
    acknowledgedSaveState:
      /saving|저장 중/iu.test(inspector) &&
      /saved|저장됨/iu.test(inspector) &&
      /(?:patch[\s\S]{0,600}then[\s\S]{0,600}setSaved|await[\s\S]{0,600}updateElementProperties[\s\S]{0,1600}setSaveState[\s\S]{0,200}["']saved["'])/iu.test(
        inspector,
      ) &&
      /error|저장 오류/iu.test(inspector) &&
      /retry|재시도/iu.test(inspector),
    propertyKeyboardIsolation:
      /stopPropagation\s*\(/u.test(inspector) &&
      /Arrow|Delete|Escape|Control|Meta/iu.test(inspector),
    truthfulBindingStatus:
      /NOT_APPLICABLE/u.test(inspector) &&
      /UNCONNECTED|미연결/u.test(inspector) &&
      !/CONNECTED\s*[:=]\s*true|mock.*binding/iu.test(inspector),
    renderStates: REQUIRED_RENDER_STATES.every((state) =>
      new RegExp(`\\b${state}\\b`, "u").test(
        `${editorRenderer}\n${runtimeRenderer}`,
      ),
    ),
    historyApiAndControls:
      /getElementHistory/iu.test(api) &&
      /element-history/iu.test(api) &&
      /undo/iu.test(`${app}\n${workspace}\n${inspector}`) &&
      /redo/iu.test(`${app}\n${workspace}\n${inspector}`),
    historyKeyboardShortcuts:
      /Ctrl|metaKey|ctrlKey/iu.test(`${app}\n${workspace}`) &&
      /shiftKey/iu.test(`${app}\n${workspace}`) &&
      /KeyZ|["']z["']/iu.test(`${app}\n${workspace}`),
    siblingGeometryCss:
      /width\s*:|grid-template-columns|flex\s*:\s*1/iu.test(inspectorTabCss) &&
      /--control-height|height\s*:/iu.test(inspectorTabCss) &&
      /width\s*:|grid-template-columns|flex\s*:\s*1/iu.test(
        inspectorActionCss,
      ) &&
      /--control-height|height\s*:/iu.test(inspectorActionCss) &&
      /width\s*:|grid-template-columns|flex\s*:\s*1/iu.test(historyCss) &&
      /--control-height|height\s*:/iu.test(historyCss),
    rightInspectorLayout:
      /inspector-panel/u.test(app) &&
      /grid-template-columns/iu.test(workspaceCss) &&
      /20em|inspector/iu.test(workspaceCss),
  };
}

function extractTestCases(file) {
  const cases = [];
  const expression =
    /\b(?:it|test)(?:\.each\s*\([\s\S]{0,4000}?\)\s*)?\(\s*(["'`])([^"'`]+)\1\s*,/gu;
  const matches = [...file.source.matchAll(expression)];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const start = match.index ?? 0;
    const end = matches[index + 1]?.index ?? file.source.length;
    cases.push({
      path: file.path,
      title: match[2] ?? "",
      source: file.source.slice(start, end),
    });
  }
  return cases;
}

function behavioral(cases, patterns, { minAssertions = 1 } = {}) {
  return cases.some(({ source, title }) => {
    const text = `${title}\n${source}`;
    const assertionCount = [
      ...source.matchAll(/expect\s*\(|assert(?:\.[A-Za-z_$][\w$]*)?\s*\(/giu),
    ].length;
    return (
      patterns.every((pattern) => pattern.test(text)) &&
      assertionCount >= minAssertions
    );
  });
}

function collective(cases, groups) {
  return groups.every((patterns) => behavioral(cases, patterns));
}

export function inspectPhase6TestInventory(files) {
  const cases = files.flatMap(extractTestCases);
  const domainCases = cases.filter(({ path }) =>
    /packages\/domain\/test/u.test(path),
  );
  const serverCases = cases.filter(({ path }) =>
    /apps\/server\/test/u.test(path),
  );
  const webCases = cases.filter(({ path }) => /apps\/web\/src/u.test(path));
  const allSource = combinedSource(files);
  const skippedTests = [
    ...allSource.matchAll(
      /\b(?:describe|it|test)\.skip\s*\(|\b(?:xit|xdescribe)\s*\(|\.todo\s*\(/gu,
    ),
  ].map((match) => match[0]);
  const capabilities = {
    "registry-checksum-order-and-detail-api": collective(
      [...domainCases, ...serverCases],
      [
        [/registry/iu, /checksum/iu, /order|determin/iu],
        [/registry/iu, /detail|elementType|unknown/iu, /404|not found/iu],
      ],
    ),
    "registry-one-entry-all-projections": behavioral(
      [...domainCases, ...webCases],
      [
        /one|single|additional|probe|fixture/iu,
        /palette/iu,
        /inspector/iu,
        /inventory/iu,
        /editor/iu,
        /runtime/iu,
      ],
      { minAssertions: 5 },
    ),
    "registry-schema-and-defaults-exhaustive": behavioral(domainCases, [
      /every|all|forEach|map/iu,
      /propertySchema|property schema/iu,
      /default|layout|bindingPorts|render states/iu,
    ]),
    "sqlite-v5-forward-migration-preserves-v4": collective(serverCases, [
      [/schema|user_version/iu, /v?5|version 5/iu, /migration/iu],
      [/v4|version 4/iu, /preserv|upgrade|migrat/iu, /row|command|element/iu],
    ]),
    "property-validation-security-and-no-write": collective(serverCases, [
      [/property/iu, /unknown|read.only/iu, /400|reject/iu],
      [/property/iu, /non.finite|NaN|Infinity|oversize|too long/iu, /reject/iu],
      [/property/iu, /__proto__|prototype|constructor/iu, /reject/iu],
      [/property/iu, /unchanged|no write|rollback|revision/iu, /reject/iu],
    ]),
    "property-save-reload-restart-and-idempotency": behavioral(serverCases, [
      /property/iu,
      /save|patch|persist/iu,
      /reload|restart|reopen/iu,
      /idempot/iu,
    ]),
    "property-revision-conflict-and-rollback": collective(serverCases, [
      [/property/iu, /stale|revision|conflict/iu, /409/iu],
      [/property/iu, /500|failure/iu, /rollback|unchanged|retry/iu],
    ]),
    "history-all-command-types": behavioral(serverCases, [
      /history|undo|redo/iu,
      /ADD/,
      /MOVE/,
      /RESIZE/,
      /LOCK/,
      /BATCH_LAYOUT/,
      /DELETE/,
      /PROPERTIES/,
    ]),
    "history-undo-redo-exact-and-monotonic": behavioral(serverCases, [
      /undo/iu,
      /redo/iu,
      /exact|same ID|stable ID|toEqual/iu,
      /monotonic|revision|greater/iu,
    ]),
    "history-linear-branch-discard": behavioral(serverCases, [
      /undo/iu,
      /new command|new edit|branch/iu,
      /discard|cannot redo|canRedo/iu,
    ]),
    "history-success-only-and-operation-idempotency": collective(serverCases, [
      [/history/iu, /4xx|failed|error/iu, /not|exclude|zero/iu],
      [/undo|redo/iu, /idempot/iu, /replay|same response/iu],
    ]),
    "history-cross-project-and-stale-command-rejection": collective(
      serverCases,
      [
        [
          /history|undo|redo/iu,
          /cross.project|another project|ownership/iu,
          /404|409/iu,
        ],
        [
          /history|undo|redo/iu,
          /stale|expectedCommandId|expected command/iu,
          /409/iu,
        ],
      ],
    ),
    "lifecycle-property-and-history-preservation": collective(serverCases, [
      [
        /clone|export|import/iu,
        /property|props|style|events/iu,
        /preserv|same|equal|round.trip/iu,
      ],
      [/clone|import/iu, /history/iu, /empty|zero|reset|new stack/iu],
      [
        /trash|restore/iu,
        /property|history/iu,
        /preserv|same|remain|round.trip/iu,
      ],
    ]),
    "immutable-published-runtime-source": behavioral(serverCases, [
      /publish|published/iu,
      /draft/iu,
      /runtime/iu,
      /unchanged|immutable|republish/iu,
    ]),
    "runtime-hidden-and-page-ownership": collective(serverCases, [
      [/runtime/iu, /hidden/iu, /omit|not|zero/iu],
      [/runtime/iu, /page/iu, /foreign|another|ownership|404/iu],
    ]),
    "palette-inspector-inventory-registry-projection": behavioral(webCases, [
      /registry/iu,
      /palette/iu,
      /inspector/iu,
      /inventory/iu,
    ]),
    "all-property-tabs-and-fields-generated": behavioral(webCases, [
      /for\s*\([^)]*of\s+ELEMENT_DEFINITIONS|ELEMENT_DEFINITIONS\.(?:forEach|flatMap|every)/u,
      /definition\.propertySchema\.fields/u,
      /tab/iu,
      /property-field-|field\.id|getByLabelText/iu,
    ]),
    "property-debounce-blur-ack-and-retry": collective(webCases, [
      [
        /property|inspector/iu,
        /500|debounce|timer/iu,
        /one|once|calledTimes|toHaveLength\s*\(\s*1/iu,
      ],
      [/blur|flush/iu, /save|patch/iu],
      [/saving|saved/iu, /ack|resolve|response/iu],
      [/fail(?:ed|ure)?|reject|network/iu, /retry|error|not saved/iu],
    ]),
    "property-race-and-input-key-isolation": collective(webCases, [
      [
        /property|inspector|draft|save/iu,
        /race|out.of.order|stale|delay/iu,
        /latest|ignore|keeps?.*out|not\.toHave|page B/iu,
      ],
      [
        /inspector|input|field/iu,
        /Arrow|Delete|Escape|Ctrl|Meta/iu,
        /not.*move|not.*delete|stopPropagation|toHaveLength\s*\(\s*0/iu,
      ],
    ]),
    "pending-property-action-coordination": collective(webCases, [
      [
        /property|inspector/iu,
        /pending|debounce|500/iu,
        /undo|redo|lock|delete|잠금|삭제|실행 취소|다시 실행/iu,
        /block|flush|disabled/iu,
      ],
      [
        /two elements|element[- ]a|element[- ]b|consecutive|switch|rapid A and B/iu,
        /projectRevision/iu,
        /monotonic|latest|newest|second|advanc|10\s*,\s*11/iu,
      ],
    ]),
    "truthful-binding-status-and-render-states": collective(webCases, [
      [/binding|연결/iu, /NOT_APPLICABLE|해당 없음/iu, /UNCONNECTED|미연결/iu],
      [/render state|renderer/iu, /EMPTY/iu, /LOADING/iu, /ERROR/iu, /DATA/iu],
    ]),
    "editor-runtime-renderer-separation":
      behavioral(webCases, [
        /editor/iu,
        /runtime/iu,
        /separate|not.*import|no.*editor/iu,
      ]) ||
      behavioral(
        webCases,
        [
          /editorRendererByKey/u,
          /runtimeRendererByKey/u,
          /toEqual|not\.toThrow/u,
        ],
        { minAssertions: 4 },
      ),
    "runtime-all-types-and-grid-layout": behavioral(webCases, [
      /runtime/iu,
      /all|every|forEach|map/iu,
      /type|registry/iu,
      /layout|grid|x|y/iu,
    ]),
    "undo-redo-controls-and-shortcuts": collective(webCases, [
      [/undo/iu, /redo/iu, /button|control|disabled/iu],
      [/Ctrl|Meta|Control/iu, /Shift/iu, /z/iu],
    ]),
    "equal-sibling-control-geometry": behavioral(webCases, [
      /geometry|rect|width|height/iu,
      /tab|action|undo|redo/iu,
      /equal|same|toBe/iu,
    ]),
    "responsive-right-inspector": collective(webCases, [
      [
        /1280|desktop/iu,
        /editor|workspace|inspector/iu,
        /scrollWidth|overflow|right|bounded/iu,
      ],
      [
        /419|mobile|narrow|max-width|900/iu,
        /inspector/iu,
        /overflow|width|display|sheet|stack|reachable/iu,
      ],
    ]),
  };
  return {
    paths: files.map(({ path }) => path),
    caseCount: cases.length,
    skippedTests,
    capabilities,
  };
}

function positiveRect(rect) {
  return (
    rect !== null &&
    typeof rect === "object" &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height) &&
    rect.width > 0 &&
    rect.height > 0
  );
}

function sameSize(rects) {
  return (
    rects.length > 1 &&
    rects.every(
      (rect) =>
        positiveRect(rect) &&
        rect.width === rects[0].width &&
        rect.height === rects[0].height,
    )
  );
}

export function inspectPhase6BrowserEvidence(evidence) {
  const tabs = Array.isArray(evidence?.inspectorTabRects)
    ? evidence.inspectorTabRects
    : [];
  const actions = Array.isArray(evidence?.inspectorActionRects)
    ? evidence.inspectorActionRects
    : [];
  const history = Array.isArray(evidence?.historyControlRects)
    ? evidence.historyControlRects
    : [];
  const placement = evidence?.rightInspectorPlacement;
  const runtime = evidence?.immutableRuntimeRender;
  const responsive = evidence?.responsive419;
  return {
    operationalPass:
      evidence?.result === "PASS" &&
      evidence?.target === "isolated local browser session" &&
      /^http:\/\/127\.0\.0\.1:\d+\/$/u.test(evidence?.url ?? "") &&
      Number.isFinite(Date.parse(evidence?.generatedAt ?? "")),
    desktopViewport:
      evidence?.viewport?.width === 1280 && evidence?.viewport?.height === 720,
    allSixTabsEqual: tabs.length === 6 && sameSize(tabs),
    inspectorActionsEqual: actions.length >= 2 && sameSize(actions),
    historyControlsEqual: history.length === 2 && sameSize(history),
    inspectorIsRight:
      positiveRect(placement?.canvasRect) &&
      positiveRect(placement?.inspectorRect) &&
      placement.inspectorRect.x >=
        placement.canvasRect.x + placement.canvasRect.width,
    immutableRuntime:
      runtime?.publishedElementCount > 0 &&
      runtime?.publishedValueBeforeDraft ===
        runtime?.publishedValueAfterDraft &&
      runtime?.draftValueAfterEdit !== runtime?.publishedValueAfterDraft &&
      runtime?.publishedValueAfterRepublish === runtime?.draftValueAfterEdit,
    responsive419:
      responsive?.viewportWidth === 419 &&
      responsive?.documentScrollWidth === 419 &&
      responsive?.inspectorReachable === true &&
      responsive?.siblingGeometryPreserved === true,
    cleanConsoleAndNetwork:
      evidence?.consoleErrorCount === 0 && evidence?.failedRequestCount === 0,
  };
}

async function loadRegistrySnapshot(repositoryRoot) {
  const serverRoot = resolve(repositoryRoot, "apps/server");
  const result = spawnSync(
    process.execPath,
    [
      "--conditions=development",
      "--import",
      "tsx",
      "--input-type=module",
      "--eval",
      'const { elementRegistry } = await import("./src/elements/element-registry.ts"); process.stdout.write(JSON.stringify(elementRegistry()));',
    ],
    {
      cwd: serverRoot,
      encoding: "utf8",
      env: process.env,
      maxBuffer: 2 * 1024 * 1024,
    },
  );
  if (result.status !== 0) {
    throw new Error(
      `Cannot load the source Registry: ${result.stderr || result.error?.message || `exit ${result.status}`}`,
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
    validation.check(false, "Phase 6 traceability JSON can be read", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  const requirements = Object.fromEntries(
    (traceability.requirements ?? []).map((requirement) => [
      requirement.id,
      requirement,
    ]),
  );
  const requirement = requirements["REQ-015"];
  validation.check(Boolean(requirement), "REQ-015 is present in traceability");
  if (requirement) {
    validation.equal(
      requirement.phase,
      6,
      "REQ-015 remains assigned to Phase 6",
    );
    validation.check(
      [
        "IMPLEMENTED",
        "VERIFIED",
        "EXHAUSTIVELY VERIFIED",
        "OPERATIONALLY VERIFIED",
        "RELEASED",
      ].includes(requirement.status),
      "REQ-015 has reached an implemented completion state",
    );
    validation.check(
      requirement.implementation?.length > 0,
      "REQ-015 references implementation",
    );
    validation.check(
      requirement.tests?.includes("scripts/verify-phase6.mjs"),
      "REQ-015 references scripts/verify-phase6.mjs",
    );
    validation.check(
      requirement.evidence?.includes(PHASE6_EVIDENCE_PATH),
      `REQ-015 references ${PHASE6_EVIDENCE_PATH}`,
    );
  }
  for (const id of ["REQ-031", "REQ-037"]) {
    validation.check(
      requirements[id]?.phase > 6,
      `${id} remains assigned to a later Phase`,
      {
        assignedPhase: requirements[id]?.phase,
        currentStatus: requirements[id]?.status,
      },
    );
  }
  const adr = await readFile(
    resolve(
      repositoryRoot,
      "docs/adr/0007-element-registry-properties-and-history.md",
    ),
    "utf8",
  );
  validation.check(/Status:\s*accepted/iu.test(adr), "ADR 0007 is accepted");
  return { requirements: Object.values(requirements) };
}

export async function validatePhase6({
  repositoryRoot = REPOSITORY_ROOT,
  includeGovernance = true,
  includePhase5Regression = true,
  includeBrowserEvidence = true,
} = {}) {
  const validation = new Validation(
    "Phase 6 Element Registry, Property Inspector, and durable history",
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

  let registrySnapshot = {};
  try {
    registrySnapshot = await loadRegistrySnapshot(repositoryRoot);
    validation.check(true, "the source Registry module can be executed");
  } catch (error) {
    validation.check(false, "the source Registry module can be executed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  const registryInspection = inspectRegistrySnapshot(registrySnapshot);
  for (const [property, message] of [
    ["schemaVersion", "Registry schema version is canonical"],
    ["checksumFormat", "Registry checksum is a lowercase SHA-256"],
    [
      "checksumExact",
      "Registry checksum matches independent stable canonicalization",
    ],
    [
      "typeOrderExact",
      "Phase 6 Registry types remain a deterministic required prefix",
    ],
    ["tabOrderExact", "Property tab order is deterministic and canonical"],
    ["uniqueTypes", "Registry types are unique"],
    ["uniqueTabs", "Property tabs are unique"],
    [
      "definitionShapeValid",
      "Every Registry definition has all contract fields",
    ],
    ["layoutRulesValid", "Every Registry layout default and bound is valid"],
    ["fieldShapeValid", "Every Property field has a valid schema"],
    ["uniqueFieldsPerDefinition", "Property field IDs are unique per Element"],
    [
      "commonFieldsComplete",
      "Every Element exposes all common Inspector properties",
    ],
    ["allTabsRepresented", "All six Property tabs have Registry fields"],
    ["portsValid", "Binding ports preserve left-input/right-output direction"],
    ["eventsValid", "Element event inventories are unique and labeled"],
    ["categoriesComplete", "Phase 6 covers BASIC, INPUT, DATA, and STATISTICS"],
    [
      "renderStatesComplete",
      "Registry render-state capabilities are truthful and data renderers declare all four states",
    ],
  ])
    validation.check(registryInspection[property], message);

  const routeInspection = inspectPhase6RouteContract(serverFiles);
  validation.check(
    routeInspection.missingRoutes.length === 0,
    "all accepted Phase 6 routes are registered",
    { missing: routeInspection.missingRoutes.map(routeKey) },
  );
  validation.check(
    routeInspection.unversionedRoutes.length === 0,
    "Phase 6 routes are versioned",
    { routes: routeInspection.unversionedRoutes.map(routeKey) },
  );

  const schemaInspection = inspectPhase6Schema(combinedSource(serverFiles));
  for (const [property, message] of [
    ["latestVersionAtLeastFive", "metadata schema advances to at least v5"],
    ["versionFiveMigration", "the accepted named v5 migration is present"],
    ["futureVersionFailClosed", "unknown future metadata versions fail closed"],
    ["migrationTransactional", "v5 migration runs transactionally"],
    [
      "elementTypeNotDuplicatedInSql",
      "SQLite no longer duplicates the executable Registry type allowlist",
    ],
    ["propertyCommandConstrained", "SQLite accepts Property commands"],
    [
      "allCommandTypesConstrained",
      "SQLite constrains all undoable Element command types",
    ],
    [
      "historyStateConstrained",
      "history states are APPLIED, UNDONE, or DISCARDED",
    ],
    ["historySequenceConstrained", "history commands own a durable sequence"],
    ["historyBeforeAfterPreserved", "history preserves before and after state"],
    ["historyOperationTable", "Undo/Redo idempotency operations are durable"],
    [
      "historyOperationIdempotency",
      "history operations enforce Project idempotency",
    ],
    [
      "schemaCopyIntegrityEvidence",
      "v5 migration asserts copy/integrity preservation",
    ],
  ])
    validation.check(schemaInspection[property], message);

  const backendInspection = inspectPhase6Backend([
    ...serverFiles,
    ...domainFiles,
  ]);
  for (const [property, message] of [
    [
      "deterministicRegistryApi",
      "Registry API exposes versioned deterministic metadata",
    ],
    [
      "registryValidatesTypeVersion",
      "server Registry validates Element type and version",
    ],
    [
      "registryDetailRejectsUnknown",
      "Registry detail rejects unknown Element types",
    ],
    ["strictPropertyAllowlist", "Property writes use the Registry allowlist"],
    [
      "rejectsPrototypeSensitiveKeys",
      "Property writes reject prototype-sensitive keys",
    ],
    [
      "validatesPropertyTypesAndBounds",
      "Property writes validate types and bounds",
    ],
    [
      "propertyMutationTransactional",
      "Property writes and revisions are transactional",
    ],
    ["historyDurable", "Element history persists all three linear states"],
    ["historyLinearBranch", "new edits discard an abandoned Redo branch"],
    ["historySuccessOnly", "failed commands cannot enter undoable history"],
    ["undoRedoOptimisticIdempotent", "Undo/Redo is optimistic and idempotent"],
    ["undoRedoMonotonic", "Undo/Redo advances monotonic revisions"],
    [
      "immutableRuntimeSource",
      "Runtime reads only the latest immutable version",
    ],
    [
      "runtimeFiltersPageAndHidden",
      "Runtime enforces Page ownership and hidden state",
    ],
    [
      "lifecycleOwnsProperties",
      "Project lifecycle serialization preserves Element properties",
    ],
  ])
    validation.check(backendInspection[property], message);

  const frontendInspection = inspectPhase6Frontend(webFiles);
  for (const [property, message] of [
    ["loadsRegistryApi", "Editor loads the real Registry API"],
    [
      "paletteProjectsRegistry",
      "Palette is projected from Registry definitions",
    ],
    [
      "inspectorProjectsSchema",
      "Inspector is generated from Registry Property schemas",
    ],
    [
      "inventoryProjectsRegistry",
      "Element Inventory is projected from the Registry",
    ],
    [
      "editorRendererCoversRegistry",
      "Editor renderer covers both new Phase 6 types",
    ],
    [
      "runtimeRendererCoversRegistry",
      "Runtime renderer covers both new Phase 6 types",
    ],
    [
      "runtimeRendererSeparate",
      "Runtime renderer is separate from Editor controls",
    ],
    [
      "noDuplicatedLocalTypeUnion",
      "Web code does not duplicate the Registry type list",
    ],
    ["allSixTabs", "Inspector exposes the six canonical tabs"],
    [
      "schemaControlProjection",
      "Inspector maps schema controls without per-type forms",
    ],
    [
      "propertyDebounceAndBlur",
      "Property drafts debounce 500 ms and flush on blur",
    ],
    [
      "acknowledgedSaveState",
      "save state waits for acknowledgement and exposes retry",
    ],
    ["propertyKeyboardIsolation", "Inspector keys cannot mutate the Canvas"],
    [
      "truthfulBindingStatus",
      "Binding UI reports only truthful pre-Binding states",
    ],
    ["renderStates", "Editor and Runtime expose every required render state"],
    ["historyApiAndControls", "Editor exposes durable Undo/Redo controls"],
    [
      "historyKeyboardShortcuts",
      "Editor exposes Ctrl/Cmd+Z and Redo shortcuts",
    ],
    [
      "siblingGeometryCss",
      "Inspector and history siblings share explicit geometry",
    ],
    [
      "rightInspectorLayout",
      "desktop Inspector remains to the right of Canvas",
    ],
  ])
    validation.check(frontendInspection[property], message);

  const testInspection = inspectPhase6TestInventory(testFiles);
  validation.check(
    testInspection.skippedTests.length === 0,
    "Phase 6 tests contain no skip or TODO cases",
    { skipped: testInspection.skippedTests },
  );
  for (const capability of REQUIRED_PHASE6_TEST_CAPABILITIES) {
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
          resolve(repositoryRoot, PHASE6_BROWSER_EVIDENCE_PATH),
          "utf8",
        ),
      );
    } catch (error) {
      validation.check(false, "Phase 6 browser evidence can be read", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    browserInspection = inspectPhase6BrowserEvidence(evidence);
    for (const [property, message] of [
      ["operationalPass", "isolated local browser verification is recorded"],
      ["desktopViewport", "desktop verification uses 1280×720"],
      [
        "allSixTabsEqual",
        "all six Inspector tabs have equal measured geometry",
      ],
      [
        "inspectorActionsEqual",
        "Inspector sibling actions have equal geometry",
      ],
      ["historyControlsEqual", "Undo and Redo controls have equal geometry"],
      ["inspectorIsRight", "Inspector is measurably right of the Canvas"],
      [
        "immutableRuntime",
        "Draft property edits do not change Runtime until republish",
      ],
      [
        "responsive419",
        "419px layout stays bounded and keeps Inspector reachable",
      ],
      [
        "cleanConsoleAndNetwork",
        "browser console and required requests are clean",
      ],
    ])
      validation.check(browserInspection[property], message);
  }

  let phase5Regression = null;
  if (includePhase5Regression) {
    phase5Regression = await validatePhase5({
      repositoryRoot,
      includeGovernance: false,
      includePhase4Regression: true,
    });
    validation.check(
      phase5Regression.result === "PASS",
      "Phase 0–5 regression remains green",
      { failures: phase5Regression.failures },
    );
  }

  const governance = includeGovernance
    ? await inspectGovernance(repositoryRoot, validation)
    : { requirements: [] };
  return validation.result({
    registryInspection,
    routeInspection,
    schemaInspection,
    backendInspection,
    frontendInspection,
    testInventory: testInspection,
    browserInspection,
    phase5RegressionResult: phase5Regression?.result ?? "NOT_RUN",
    governanceRequirementCount: governance.requirements.length,
    requiredEvidencePath: PHASE6_EVIDENCE_PATH,
    browserEvidencePath: PHASE6_BROWSER_EVIDENCE_PATH,
  });
}

if (isMainModule(import.meta.url)) {
  try {
    await finishVerification(PHASE6_EVIDENCE_PATH, await validatePhase6());
  } catch (error) {
    await finishVerification(
      PHASE6_EVIDENCE_PATH,
      unexpectedFailure(
        "Phase 6 Element Registry, Property Inspector, and durable history",
        error,
      ),
    );
  }
}
