import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CANONICAL_PHASE6_ROUTES,
  PHASE6_BROWSER_EVIDENCE_PATH,
  PHASE6_EVIDENCE_PATH,
  REQUIRED_COMMAND_TYPES,
  REQUIRED_PHASE6_ELEMENT_TYPES,
  REQUIRED_PHASE6_TEST_CAPABILITIES,
  REQUIRED_PROPERTY_TABS,
  REQUIRED_RENDER_STATES,
  calculateRegistryChecksum,
  inspectPhase6Backend,
  inspectPhase6BrowserEvidence,
  inspectPhase6Frontend,
  inspectPhase6RouteContract,
  inspectPhase6Schema,
  inspectPhase6TestInventory,
  inspectRegistrySnapshot,
  stableRegistryJson,
  validatePhase6,
} from "../../scripts/verify-phase6.mjs";

function sourceFile(path, source) {
  return { path, source };
}

function propertyFields() {
  const option = [{ value: "default", label: "Default" }];
  const field = (tab, name, control, valueType, target, extra = {}) => ({
    id: `${tab}.${name}`,
    tab,
    label: name,
    control,
    valueType,
    target,
    required: true,
    readOnly: false,
    ...extra,
  });
  return [
    field("general", "displayName", "text", "string", "element", {
      maxLength: 120,
    }),
    field("general", "internalName", "text", "string", "props", {
      maxLength: 120,
    }),
    field("general", "elementId", "read-only", "string", "computed", {
      readOnly: true,
    }),
    field("general", "visible", "switch", "boolean", "element"),
    field("general", "disabled", "switch", "boolean", "props"),
    field("general", "locked", "switch", "boolean", "element"),
    field("general", "tooltip", "text", "string", "props", {
      required: false,
      maxLength: 500,
    }),
    field("general", "accessibilityLabel", "text", "string", "props", {
      required: false,
      maxLength: 240,
    }),
    field("style", "width", "read-only", "number", "layout", {
      readOnly: true,
    }),
    field("style", "height", "read-only", "number", "layout", {
      readOnly: true,
    }),
    field("style", "padding", "slider", "number", "style", {
      min: 0,
      max: 64,
      step: 1,
    }),
    field("style", "margin", "slider", "number", "style", {
      min: 0,
      max: 64,
      step: 1,
    }),
    field("style", "backgroundToken", "theme-token", "enum", "style", {
      options: option,
    }),
    field("style", "backgroundCustom", "color", "string", "style", {
      required: false,
      maxLength: 32,
    }),
    field("style", "borderToken", "theme-token", "enum", "style", {
      options: option,
    }),
    field("style", "borderWidth", "slider", "number", "style", {
      min: 0,
      max: 8,
      step: 1,
    }),
    field("style", "borderStyle", "select", "enum", "style", {
      options: option,
    }),
    field("style", "radius", "slider", "number", "style", {
      min: 0,
      max: 48,
      step: 1,
    }),
    field("style", "shadow", "select", "enum", "style", {
      options: option,
    }),
    field("style", "textColorToken", "theme-token", "enum", "style", {
      options: option,
    }),
    field("style", "fontSize", "slider", "number", "style", {
      min: 10,
      max: 72,
      step: 1,
    }),
    field("style", "fontWeight", "select", "enum", "style", {
      options: option,
    }),
    field("style", "textAlign", "select", "enum", "style", {
      options: option,
    }),
    field("style", "contentAlign", "select", "enum", "style", {
      options: option,
    }),
    field("data", "bindingStatus", "binding-status", "string", "computed", {
      readOnly: true,
    }),
    field("interaction", "supportedEvents", "read-only", "string", "computed", {
      readOnly: true,
    }),
    field("validation", "status", "read-only", "string", "computed", {
      readOnly: true,
    }),
    field("advanced", "type", "read-only", "string", "computed", {
      readOnly: true,
    }),
    field("advanced", "typeVersion", "read-only", "number", "computed", {
      readOnly: true,
    }),
  ];
}

function registryDefinition(type, category, port = null) {
  return {
    type,
    typeVersion: 1,
    label: type,
    description: `${type} element`,
    category,
    iconName: "Square",
    rendererKey: type,
    editorRendererKey: type,
    runtimeRendererKey: type,
    validatorKey: type,
    defaultName: type,
    defaultProps: { disabled: false, tooltip: "", accessibleName: "" },
    defaultStyle: { background: "card" },
    defaultEvents: [],
    layout: { defaultW: 4, defaultH: 4, minW: 2, minH: 2, maxW: 12, maxH: 20 },
    propertySchema: { fields: propertyFields() },
    bindingPorts: port
      ? [
          {
            id: `${type}-port`,
            label: "Value",
            direction: port,
            side: port === "input" ? "left" : "right",
            valueType: "unknown",
            required: false,
            maxConnections: 1,
          },
        ]
      : [],
    events: [{ id: "onClick", label: "Click" }],
    supportedRenderStates:
      category === "data" || category === "statistics"
        ? [...REQUIRED_RENDER_STATES]
        : category === "input"
          ? ["EMPTY", "ERROR", "DATA"]
          : ["DATA"],
    migrations: [],
  };
}

function completeRegistry() {
  const categories = ["basic", "basic", "basic", "statistics", "input", "data"];
  const definitions = REQUIRED_PHASE6_ELEMENT_TYPES.map((type, index) =>
    registryDefinition(
      type,
      categories[index],
      type === "number-input"
        ? "output"
        : type === "data-table"
          ? "input"
          : null,
    ),
  );
  const registry = {
    schemaVersion: 1,
    tabs: REQUIRED_PROPERTY_TABS.map((id) => ({ id, label: id })),
    definitions,
  };
  return { ...registry, checksum: calculateRegistryChecksum(registry) };
}

const completeRoutes = CANONICAL_PHASE6_ROUTES.map(
  ({ method, path }) =>
    `server.${method.toLowerCase()}("${path}", async (request) => handler(request));`,
).join("\n");

const completeSchema = `
  export const LATEST_METADATA_SCHEMA_VERSION = 5;
  const elementRegistryPropertiesHistory = \`
    CREATE TABLE elements (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, page_id TEXT NOT NULL,
      type TEXT NOT NULL, type_version INTEGER NOT NULL, name TEXT NOT NULL,
      props_json TEXT NOT NULL, style_json TEXT NOT NULL, events_json TEXT NOT NULL,
      locked INTEGER NOT NULL, hidden INTEGER NOT NULL, revision INTEGER NOT NULL
    );
    CREATE TABLE element_commands (
      id TEXT NOT NULL, project_id TEXT NOT NULL, page_id TEXT NOT NULL,
      element_id TEXT, command_type TEXT NOT NULL CHECK (command_type IN
        ('ADD','MOVE','RESIZE','LOCK','BATCH_LAYOUT','DELETE','PROPERTIES')),
      idempotency_key TEXT NOT NULL, request_hash TEXT NOT NULL,
      before_json TEXT, after_json TEXT, response_status INTEGER NOT NULL,
      response_json TEXT NOT NULL, before_layout_revision INTEGER NOT NULL,
      after_layout_revision INTEGER NOT NULL, created_at TEXT NOT NULL,
      history_state TEXT CHECK (history_state IN ('APPLIED','UNDONE','DISCARDED')),
      history_sequence INTEGER CHECK (history_sequence > 0), history_updated_at TEXT,
      PRIMARY KEY (id), UNIQUE(id, project_id), UNIQUE(project_id, idempotency_key)
    );
    CREATE TABLE element_history_operations (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, command_id TEXT,
      requested_command_id TEXT NOT NULL,
      operation_type TEXT NOT NULL CHECK (operation_type IN ('UNDO','REDO')),
      idempotency_key TEXT NOT NULL, request_hash TEXT NOT NULL,
      response_status INTEGER NOT NULL, response_json TEXT NOT NULL,
      created_at TEXT NOT NULL, UNIQUE(project_id, idempotency_key),
      FOREIGN KEY (command_id, project_id)
        REFERENCES element_commands(id, project_id) ON DELETE CASCADE
    );
    INSERT INTO elements SELECT * FROM elements_v4;
    INSERT INTO element_commands SELECT * FROM element_commands_v4;
    PRAGMA foreign_key_check;
  \`;
  const migration = { version: 5, name: "element-registry-properties-history", sql: elementRegistryPropertiesHistory };
  if (userVersion > LATEST_METADATA_SCHEMA_VERSION) throw new Error("Refusing unknown future metadata schema version");
  const migrate = database.transaction(() => migration); migrate.immediate();
`;

function completeBackendFiles() {
  return [
    sourceFile(
      "apps/server/src/elements/element-registry.ts",
      `
        const byType = new Map(ELEMENT_DEFINITIONS.map((definition) => [definition.type, definition]));
        const ELEMENT_REGISTRY_CHECKSUM = registryChecksum(stableJson({ schemaVersion, tabs, definitions }));
        function elementDefinition(type, typeVersion) {
          const definition = byType.get(type);
          if (!definition) throw new ApiError(400, "INVALID_ELEMENT_TYPE");
          if (typeVersion !== ELEMENT_TYPE_VERSION) throw new ApiError(400, "ELEMENT_TYPE_VERSION");
          return definition;
        }
        function registry() { return { schemaVersion, checksum: ELEMENT_REGISTRY_CHECKSUM, tabs, definitions }; }
        function detail(elementType) { const item = byType.get(elementType); if (!item) throw new ApiError(404, "ELEMENT_NOT_FOUND"); return item; }
      `,
    ),
    sourceFile(
      "apps/server/src/elements/element-repository.ts",
      `
        const historyState = "APPLIED"; const history_sequence = nextSequence();
        function history() { return select("history_state", "APPLIED", "UNDONE", "DISCARDED", "response_status"); }
        function discardRedoBranch() { update("DISCARDED", "abandoned redo branch"); }
        function successful(command) { return command.response_status < 400; }
        function storeOperation(input) { return { request_hash: input.requestHash, idempotencyKey: input.idempotencyKey }; }
        function restore(entry) { return update("revision = revision + 1", entry.id); }
      `,
    ),
    sourceFile(
      "apps/server/src/elements/element-service.ts",
      `
        function patch(change) {
          if (change.kind === "PROPERTIES") return database.transaction(() => {
            const fieldById = new Map(definition.propertySchema.fields.map((field) => [field.id, field]));
            for (const key of Object.keys(change.values)) {
              if (["__proto__", "prototype", "constructor"].includes(key)) throw new ApiError(400, "UNKNOWN_ELEMENT_PROPERTY");
              const field = fieldById.get(key); if (!field || field.readOnly) throw new ApiError(400, "UNKNOWN_ELEMENT_PROPERTY");
              if (field.required && change.values[key] == null) throw new ApiError(400, "INVALID_PROPERTY");
              if (field.valueType === "number" && !Number.isFinite(change.values[key])) throw new ApiError(400, "INVALID_PROPERTY");
              if (field.maxLength && change.values[key].length > field.maxLength) throw new ApiError(400, "INVALID_PROPERTY");
              if (field.min !== undefined || field.max !== undefined) validateBounds(field, change.values[key]);
            }
            bumpProjectRevision(projectRevision); return store("PROPERTIES");
          })();
        }
        function mutateHistory({ expectedProjectRevision, expectedCommandId, idempotencyKey }) {
          const requestHash = hash(idempotencyKey); bumpProjectRevision(expectedProjectRevision);
          return updateRevision("revision = revision + 1", "layoutRevision");
        }
      `,
    ),
    sourceFile(
      "apps/server/src/pages/page-service.ts",
      `
        function runtimePage(projectId, pageId) {
          const version = latestVersion(projectId); const snapshot = JSON.parse(version.snapshot_json);
          const page = snapshot.pages.find((candidate) => candidate.id === pageId);
          const elements = snapshot.elements.filter((entry) => entry.element.pageId === page.id && !entry.element.hidden);
          return { page, elements };
        }
      `,
    ),
    sourceFile(
      "apps/server/src/projects/project-service.ts",
      `function exportProject() { return { elements: entries.map(({ props, style, events }) => ({ props, style, events })) }; }`,
    ),
    sourceFile("apps/server/src/routes/elements.ts", completeRoutes),
  ];
}

function completeFrontendFiles() {
  return [
    sourceFile(
      "apps/web/src/services/elements-api.ts",
      `
        export { type ElementType } from "@webeditor/domain";
        function listElementRegistry() { return request("/api/v1/elements/registry"); }
        function getElementHistory() { return request("/api/v1/projects/id/element-history"); }
      `,
    ),
    sourceFile(
      "apps/web/src/features/elements/element-definitions.ts",
      `function elementDefinitionMap(definitions) { return new Map(definitions.map((definition) => [definition.type, definition])); } const inventory = registry.definitions;`,
    ),
    sourceFile(
      "apps/web/src/features/elements/ElementPalette.tsx",
      `function Palette({ definitions }) { return definitions.map((definition) => <button data-testid={\`palette-item-\${definition.type}\`} />); }`,
    ),
    sourceFile(
      "apps/web/src/features/elements/ElementPropertyInspector.tsx",
      `
        const PROPERTY_SAVE_DEBOUNCE = 500;
        const schemaControls = ["theme-token", "slider", "color", "icon", "field-ref", "page-ref", "binding-ref", "binding-status"];
        function Inspector({ registry, definition }) {
          const [saving, setSaving] = useState(false); const [saved, setSaved] = useState(false); const [retry, setRetry] = useState(false);
          function debounce() { setTimeout(flush, PROPERTY_SAVE_DEBOUNCE); }
          function flush() { setSaving(true); patch().then(() => setSaved(true)).catch(() => setRetry(true)); }
          function isolate(event) { if (["ArrowUp","Delete","Escape","Control","Meta"].includes(event.key)) event.stopPropagation(); }
          const statuses = ["NOT_APPLICABLE", "UNCONNECTED"];
          return <Tabs role="tablist" aria-label="속성 탭"><div className="property-inspector-tabs">{registry.tabs.map((tab) => <TabsTrigger value={tab.id} />)}</div>{definition.propertySchema.fields.map((field) => <label data-testid={\`property-field-\${field.id}\`} onBlur={flush} onKeyDown={isolate}>{field.control === "switch" ? <Switch /> : field.control === "select" ? <Select /> : field.control === "textarea" ? <textarea /> : field.control === "number" ? <input type="number" /> : field.readOnly ? <output /> : <input />}</label>)}<span>{saving ? "저장 중" : saved ? "저장됨" : retry ? "저장 오류 재시도" : "변경됨"}</span></Tabs>;
        }
      `,
    ),
    sourceFile(
      "apps/web/src/features/elements/ElementRenderer.tsx",
      `const rendererByType = { text: Text, button: Button, container: Container, "kpi-card": Kpi, "number-input": NumberInput, "data-table": DataTable }; const states = ["EMPTY","LOADING","ERROR","DATA"];`,
    ),
    sourceFile(
      "apps/web/src/features/runtime/RuntimeElementRenderer.tsx",
      `function RuntimeElementRenderer(entry) { const runtimeRendererByType = { text: Text, button: Button, container: Container, "kpi-card": Kpi, "number-input": NumberInput, "data-table": DataTable }; return ["EMPTY","LOADING","ERROR","DATA"].map((state) => runtimeRendererByType[entry.type](state)); }`,
    ),
    sourceFile(
      "apps/web/src/features/runtime/PublishedRuntime.tsx",
      `function PublishedRuntime() { return <main aria-label="게시 엘리먼트"><RuntimeElementRenderer /></main>; }`,
    ),
    sourceFile(
      "apps/web/src/features/elements/ElementWorkspace.tsx",
      `listElementRegistry(); function shortcut(event) { if ((event.ctrlKey || event.metaKey) && event.key === "z") mutate(event.shiftKey ? "redo" : "undo"); }`,
    ),
    sourceFile(
      "apps/web/src/App.tsx",
      `<aside className="inspector-panel"><Inspector /></aside><div className="element-history-controls"><button>undo</button><button>redo</button></div>`,
    ),
    sourceFile(
      "apps/web/src/styles.css",
      `
        .editor-workspace { display: grid; grid-template-columns: 17em minmax(34em, 1fr) 20em; }
        .property-tabs-list { display: grid; grid-template-columns: repeat(6, 1fr); }
        .property-tabs-list [data-slot="tabs-trigger"] { width: 100%; height: var(--control-height); }
        .element-inspector-actions { display: flex; }
        .element-inspector-actions [data-slot="button"] { height: var(--control-height); flex: 1; }
        .element-history-controls { display: flex; }
        .element-history-controls [data-slot="button"] { height: var(--control-height); flex: 1; }
      `,
    ),
  ];
}

function testCase(title, body) {
  return `it(${JSON.stringify(title)}, async () => { ${body}; expect(result).toBeDefined(); });`;
}

function completeBehavioralFiles() {
  const domain = [
    testCase(
      "registry deterministic checksum order",
      "const result = registry.checksum + order",
    ),
    testCase(
      "one additional fixture projects palette inspector inventory editor runtime",
      "const result = projectOneEntry(); expect(result.palette).toBe(true); expect(result.inspector).toBe(true); expect(result.inventory).toBe(true); expect(result.editor).toBe(true); expect(result.runtime).toBe(true)",
    ),
    testCase(
      "every propertySchema default layout bindingPorts render states",
      "const result = definitions.map(validate)",
    ),
  ].join("\n");
  const server = [
    testCase(
      "registry detail unknown elementType returns 404 not found",
      "const result = await detailUnknown()",
    ),
    testCase(
      "schema version 5 migration upgrades v4 and preserves element command rows",
      "const result = migrateV4()",
    ),
    testCase(
      "property unknown read-only rejects 400 with unchanged revision",
      "const result = rejectUnknown()",
    ),
    testCase(
      "property non-finite NaN Infinity oversized too long rejects",
      "const result = rejectBounds()",
    ),
    testCase(
      "property __proto__ prototype constructor rejects",
      "const result = rejectPollution()",
    ),
    testCase(
      "property patch save reload restart idempotency replay",
      "const result = restart()",
    ),
    testCase(
      "property stale revision conflict returns 409",
      "const result = stale()",
    ),
    testCase(
      "property 500 failure rollback unchanged retry",
      "const result = rollback()",
    ),
    testCase(
      "history undo redo ADD MOVE RESIZE LOCK BATCH_LAYOUT DELETE PROPERTIES",
      "const result = allCommands()",
    ),
    testCase(
      "undo redo exact same ID stable ID monotonic revision greater",
      "const result = roundTrip()",
    ),
    testCase(
      "undo then new command discards redo branch canRedo false",
      "const result = branch()",
    ),
    testCase(
      "history excludes failed 4xx error command",
      "const result = failedHistory()",
    ),
    testCase(
      "undo redo idempotency replays same response",
      "const result = replay()",
    ),
    testCase(
      "history cross-project ownership rejects 409",
      "const result = crossProject()",
    ),
    testCase(
      "redo stale expectedCommandId rejects 409",
      "const result = staleCommand()",
    ),
    testCase(
      "clone export import round-trip preserves props style events properties equal",
      "const result = lifecycleProperties()",
    ),
    testCase(
      "clone import starts with empty zero history new stack",
      "const result = emptyHistory()",
    ),
    testCase(
      "trash restore round-trip preserves property and history",
      "const result = restoreHistory()",
    ),
    testCase(
      "published runtime remains immutable after draft until republish",
      "const result = immutable()",
    ),
    testCase("runtime omits hidden element", "const result = hidden()"),
    testCase(
      "runtime rejects another page ownership 404",
      "const result = wrongPage()",
    ),
  ].join("\n");
  const web = [
    testCase(
      "registry projects palette inspector inventory",
      "const result = renderRegistry()",
    ),
    testCase(
      "every schema field generated across all property tabs",
      "const result = ELEMENT_DEFINITIONS.flatMap((definition) => definition.propertySchema.fields.map((field) => propertyTabs[field.tab] + `property-field-${field.id}`))",
    ),
    testCase(
      "property 500ms debounce timer saves once",
      "const result = advanceTimer()",
    ),
    testCase("property blur flush patches save", "const result = blur()"),
    testCase(
      "saving becomes saved only after response resolve acknowledgement",
      "const result = resolveRequest()",
    ),
    testCase(
      "network failure exposes error retry and not saved",
      "const result = rejectRequest()",
    ),
    testCase(
      "property out-of-order stale race ignores old response and keeps latest",
      "const result = race()",
    ),
    testCase(
      "property pending 500ms debounce blocks undo redo lock delete actions",
      "const result = actionsDisabled()",
    ),
    testCase(
      "consecutive edits switch between two elements use latest monotonic projectRevision on second request",
      "const result = editElementAThenElementB()",
    ),
    testCase(
      "inspector input Arrow Delete Escape Ctrl Meta stopPropagation does not move or delete",
      "const result = keys()",
    ),
    testCase(
      "binding reports NOT_APPLICABLE and UNCONNECTED",
      "const result = bindingStatus()",
    ),
    testCase(
      "renderer render state EMPTY LOADING ERROR DATA",
      "const result = states()",
    ),
    testCase(
      "editor and runtime renderers remain separate with no editor import",
      "const result = boundaries()",
    ),
    testCase(
      "runtime renders every registry type in grid layout",
      "const result = types.map(render)",
    ),
    testCase(
      "undo redo button controls disable at history boundary",
      "const result = controls()",
    ),
    testCase(
      "Ctrl Meta Shift z keyboard shortcut",
      "const result = shortcut()",
    ),
    testCase(
      "tab action undo redo geometry rect width height equal same",
      "const result = measure()",
    ),
    testCase(
      "1280 desktop inspector remains right",
      "const result = desktop()",
    ),
    testCase(
      "419 mobile inspector reachable with bounded overflow width",
      "const result = mobile()",
    ),
  ].join("\n");
  return [
    sourceFile("packages/domain/test/element-registry.test.ts", domain),
    sourceFile(
      "apps/server/test/integration/element-properties.test.ts",
      server,
    ),
    sourceFile(
      "apps/web/src/features/elements/ElementPropertyInspector.test.tsx",
      web,
    ),
  ];
}

function completeBrowserEvidence() {
  const rect = (x = 0) => ({ x, y: 0, width: 100, height: 40 });
  return {
    result: "PASS",
    target: "isolated local browser session",
    url: "http://127.0.0.1:45176/",
    generatedAt: "2026-08-16T12:00:00.000Z",
    viewport: { width: 1280, height: 720 },
    inspectorTabRects: Array.from({ length: 6 }, () => rect()),
    inspectorActionRects: [rect(), rect()],
    historyControlRects: [rect(), rect()],
    rightInspectorPlacement: {
      canvasRect: { x: 270, y: 120, width: 690, height: 500 },
      inspectorRect: { x: 960, y: 120, width: 320, height: 500 },
    },
    immutableRuntimeRender: {
      publishedElementCount: 1,
      publishedValueBeforeDraft: "Before",
      draftValueAfterEdit: "After",
      publishedValueAfterDraft: "Before",
      publishedValueAfterRepublish: "After",
    },
    responsive419: {
      viewportWidth: 419,
      documentScrollWidth: 419,
      inspectorReachable: true,
      siblingGeometryPreserved: true,
    },
    consoleErrorCount: 0,
    failedRequestCount: 0,
  };
}

describe("Phase 6 validation contract", () => {
  it("passes the current repository Phase 6 gate", async () => {
    const report = await validatePhase6();
    assert.equal(
      report.result,
      "PASS",
      JSON.stringify(report.failures, null, 2),
    );
    assert.ok(report.checks >= 100);
    assert.ok(
      report.details.registryInspection.definitionCount >=
        REQUIRED_PHASE6_ELEMENT_TYPES.length,
    );
    assert.equal(report.details.requiredEvidencePath, PHASE6_EVIDENCE_PATH);
    assert.equal(
      report.details.browserEvidencePath,
      PHASE6_BROWSER_EVIDENCE_PATH,
    );
  });

  it("canonicalizes Registry objects independently of object key insertion order", () => {
    const left = { z: 1, a: { y: 2, b: 3 }, list: [{ q: 4, c: 5 }] };
    const right = { list: [{ c: 5, q: 4 }], a: { b: 3, y: 2 }, z: 1 };
    assert.equal(stableRegistryJson(left), stableRegistryJson(right));
  });

  it("rejects Registry checksum, order, shape, port, tab, and state mutations", () => {
    const baseline = completeRegistry();
    const inspected = inspectRegistrySnapshot(baseline);
    for (const property of [
      "checksumExact",
      "typeOrderExact",
      "tabOrderExact",
      "definitionShapeValid",
      "fieldShapeValid",
      "uniqueFieldsPerDefinition",
      "commonFieldsComplete",
      "allTabsRepresented",
      "portsValid",
      "renderStatesComplete",
    ])
      assert.equal(inspected[property], true, property);

    const forwardCompatibleDefinition = registryDefinition(
      "future-collaboration",
      "collaboration",
    );
    const forwardCompatibleRegistry = {
      ...baseline,
      definitions: [...baseline.definitions, forwardCompatibleDefinition],
    };
    forwardCompatibleRegistry.checksum = calculateRegistryChecksum(
      forwardCompatibleRegistry,
    );
    const forwardCompatibleInspection = inspectRegistrySnapshot(
      forwardCompatibleRegistry,
    );
    assert.equal(forwardCompatibleInspection.typeOrderExact, true);
    assert.equal(forwardCompatibleInspection.checksumExact, true);

    const mutations = [
      [
        "checksum",
        {
          ...baseline,
          definitions: baseline.definitions.map((item, index) =>
            index ? item : { ...item, label: "Changed" },
          ),
        },
        "checksumExact",
      ],
      [
        "type order",
        {
          ...baseline,
          definitions: [
            baseline.definitions[1],
            baseline.definitions[0],
            ...baseline.definitions.slice(2),
          ],
        },
        "typeOrderExact",
      ],
      [
        "required type missing",
        {
          ...baseline,
          definitions: baseline.definitions.slice(0, -1),
        },
        "typeOrderExact",
      ],
      [
        "tab order",
        { ...baseline, tabs: [...baseline.tabs].reverse() },
        "tabOrderExact",
      ],
      [
        "shape",
        {
          ...baseline,
          definitions: baseline.definitions.map((item, index) =>
            index ? item : { ...item, description: undefined },
          ),
        },
        "definitionShapeValid",
      ],
      [
        "executable projection key",
        {
          ...baseline,
          definitions: baseline.definitions.map((item, index) =>
            index ? item : { ...item, runtimeRendererKey: "missing" },
          ),
        },
        "definitionShapeValid",
      ],
      [
        "field contract",
        {
          ...baseline,
          definitions: baseline.definitions.map((item, index) =>
            index
              ? item
              : {
                  ...item,
                  propertySchema: {
                    fields: item.propertySchema.fields.map(
                      (field, fieldIndex) =>
                        fieldIndex ? field : { ...field, control: "arbitrary" },
                    ),
                  },
                },
          ),
        },
        "fieldShapeValid",
      ],
      [
        "duplicate field",
        {
          ...baseline,
          definitions: baseline.definitions.map((item, index) =>
            index
              ? item
              : {
                  ...item,
                  propertySchema: {
                    fields: [
                      ...item.propertySchema.fields,
                      item.propertySchema.fields[0],
                    ],
                  },
                },
          ),
        },
        "uniqueFieldsPerDefinition",
      ],
      [
        "common field",
        {
          ...baseline,
          definitions: baseline.definitions.map((item) => ({
            ...item,
            propertySchema: {
              fields: item.propertySchema.fields.filter(
                (field) => field.id !== "general.accessibilityLabel",
              ),
            },
          })),
        },
        "commonFieldsComplete",
      ],
      [
        "tab fields",
        {
          ...baseline,
          definitions: baseline.definitions.map((item) => ({
            ...item,
            propertySchema: {
              fields: item.propertySchema.fields.filter(
                (field) => field.tab !== "advanced",
              ),
            },
          })),
        },
        "allTabsRepresented",
      ],
      [
        "port side",
        {
          ...baseline,
          definitions: baseline.definitions.map((item) =>
            item.type === "number-input"
              ? {
                  ...item,
                  bindingPorts: item.bindingPorts.map((port) => ({
                    ...port,
                    side: "left",
                  })),
                }
              : item,
          ),
        },
        "portsValid",
      ],
      [
        "state",
        {
          ...baseline,
          definitions: baseline.definitions.map((item) =>
            item.type === "data-table"
              ? {
                  ...item,
                  supportedRenderStates: item.supportedRenderStates.filter(
                    (state) => state !== "ERROR",
                  ),
                }
              : item,
          ),
        },
        "renderStatesComplete",
      ],
    ];
    for (const [label, mutation, property] of mutations) {
      assert.equal(inspectRegistrySnapshot(mutation)[property], false, label);
    }
  });

  it("rejects a missing or unversioned Phase 6 route", () => {
    const baseline = inspectPhase6RouteContract([
      sourceFile("routes.ts", completeRoutes),
    ]);
    assert.equal(baseline.missingRoutes.length, 0);
    assert.equal(baseline.unversionedRoutes.length, 0);
    const missing = inspectPhase6RouteContract([
      sourceFile(
        "routes.ts",
        completeRoutes.replace(CANONICAL_PHASE6_ROUTES[0].path, "/removed"),
      ),
    ]);
    assert.equal(missing.missingRoutes.length, 1);
    const unversioned = inspectPhase6RouteContract([
      sourceFile(
        "routes.ts",
        `${completeRoutes}\nserver.get("/elements/registry", handler);`,
      ),
    ]);
    assert.equal(unversioned.unversionedRoutes.length, 1);

    const explicitRoutes = CANONICAL_PHASE6_ROUTES.filter(
      ({ path }) => !/element-history\/(?:undo|redo)$/u.test(path),
    )
      .map(
        ({ method, path }) =>
          `server.${method.toLowerCase()}(${JSON.stringify(path)}, handler);`,
      )
      .join("\n");
    const loop = inspectPhase6RouteContract([
      sourceFile(
        "routes.ts",
        `${explicitRoutes}\nfor (const operation of ["undo", "redo"] as const) { server.post(\`/api/v1/projects/:projectId/element-history/\${operation}\`, handler); }`,
      ),
    ]);
    assert.equal(loop.missingRoutes.length, 0);
    const brokenLoop = inspectPhase6RouteContract([
      sourceFile(
        "routes.ts",
        `${explicitRoutes}\nfor (const operation of ["undo"] as const) { server.post(\`/api/v1/projects/:projectId/element-history/\${operation}\`, handler); }`,
      ),
    ]);
    assert.ok(brokenLoop.missingRoutes.length > 0);
  });

  it("rejects v5 migration and durable-history schema mutations", () => {
    const baseline = inspectPhase6Schema(completeSchema);
    for (const property of [
      "latestVersionAtLeastFive",
      "versionFiveMigration",
      "elementTypeNotDuplicatedInSql",
      "propertyCommandConstrained",
      "allCommandTypesConstrained",
      "historyStateConstrained",
      "historySequenceConstrained",
      "historyOperationTable",
      "historyOperationIdempotency",
      "schemaCopyIntegrityEvidence",
    ])
      assert.equal(baseline[property], true, property);
    const mutations = [
      ["v5", completeSchema.replace("= 5", "= 4"), "latestVersionAtLeastFive"],
      [
        "property",
        completeSchema.replace(",'PROPERTIES'", ""),
        "propertyCommandConstrained",
      ],
      [
        "history state",
        completeSchema.replace(",'DISCARDED'", ""),
        "historyStateConstrained",
      ],
      [
        "sequence",
        completeSchema.replaceAll("history_sequence", "removed_sequence"),
        "historySequenceConstrained",
      ],
      [
        "operation request",
        completeSchema.replaceAll(
          "requested_command_id",
          "removed_requested_id",
        ),
        "historyOperationTable",
      ],
      [
        "operation idempotency",
        completeSchema.replaceAll("UNIQUE(project_id, idempotency_key)", ""),
        "historyOperationIdempotency",
      ],
      [
        "cross-project operation target",
        completeSchema.replace(
          "FOREIGN KEY (command_id, project_id)\n        REFERENCES element_commands(id, project_id) ON DELETE CASCADE",
          "FOREIGN KEY (command_id) REFERENCES element_commands(id)",
        ),
        "historyOperationIdempotency",
      ],
      [
        "copy evidence",
        completeSchema.replaceAll("PRAGMA foreign_key_check;", ""),
        "schemaCopyIntegrityEvidence",
      ],
      [
        "SQL drift",
        completeSchema.replace(
          "type TEXT NOT NULL",
          "type TEXT NOT NULL CHECK (type IN ('text'))",
        ),
        "elementTypeNotDuplicatedInSql",
      ],
    ];
    for (const [label, source, property] of mutations) {
      assert.equal(inspectPhase6Schema(source)[property], false, label);
    }
  });

  it("rejects backend property, history, Registry, and Runtime boundary mutations", () => {
    const files = completeBackendFiles();
    const baseline = inspectPhase6Backend(files);
    for (const [property, value] of Object.entries(baseline))
      assert.equal(value, true, property);
    const mutations = [
      [
        "checksum",
        /ELEMENT_REGISTRY_CHECKSUM|registryChecksum/g,
        "REMOVED",
        "deterministicRegistryApi",
      ],
      [
        "type version",
        /typeVersion|ELEMENT_TYPE_VERSION/g,
        "removed",
        "registryValidatesTypeVersion",
      ],
      ["unknown detail", /400|404/g, "500", "registryDetailRejectsUnknown"],
      ["allowlist", /fieldById/g, "removed", "strictPropertyAllowlist"],
      ["pollution", /__proto__/g, "removed", "rejectsPrototypeSensitiveKeys"],
      [
        "type and bounds",
        /Number\.isFinite/g,
        "removed",
        "validatesPropertyTypesAndBounds",
      ],
      [
        "property transaction",
        /database\.transaction/g,
        "database.atomic",
        "propertyMutationTransactional",
      ],
      ["durable states", /UNDONE/g, "removed", "historyDurable"],
      [
        "branch",
        /discardRedoBranch|abandoned redo branch/g,
        "removed",
        "historyLinearBranch",
      ],
      [
        "successful history only",
        /response_status/g,
        "removed_status",
        "historySuccessOnly",
      ],
      [
        "optimistic history",
        /expectedProjectRevision/g,
        "removedRevision",
        "undoRedoOptimisticIdempotent",
      ],
      [
        "monotonic history",
        /revision = revision \+ 1|bumpProjectRevision/g,
        "removedRevisionAdvance",
        "undoRedoMonotonic",
      ],
      [
        "published source",
        /latestVersion/g,
        "elementRepository.listActive",
        "immutableRuntimeSource",
      ],
      ["hidden", /\.hidden/g, ".removed", "runtimeFiltersPageAndHidden"],
      ["lifecycle props", /\bprops\b/g, "removed", "lifecycleOwnsProperties"],
    ];
    for (const [label, pattern, replacement, property] of mutations) {
      const mutated = files.map((file) => ({
        ...file,
        source: file.source.replace(pattern, replacement),
      }));
      assert.equal(inspectPhase6Backend(mutated)[property], false, label);
    }
  });

  it("rejects frontend projection, save, keyboard, history, and geometry mutations", () => {
    const files = completeFrontendFiles();
    const baseline = inspectPhase6Frontend(files);
    for (const [property, value] of Object.entries(baseline))
      assert.equal(value, true, property);
    const mutations = [
      ["registry", /listElementRegistry/g, "removed", "loadsRegistryApi"],
      ["palette", /definitions\.map/g, "removed", "paletteProjectsRegistry"],
      [
        "schema",
        /definition\.propertySchema\.fields/g,
        "removed",
        "inspectorProjectsSchema",
      ],
      ["tabs", /registry\.tabs/g, "removed", "allSixTabs"],
      ["controls", /textarea/g, "removed", "schemaControlProjection"],
      [
        "runtime type",
        /data-table/g,
        "removed",
        "runtimeRendererCoversRegistry",
      ],
      [
        "debounce",
        /PROPERTY_SAVE_DEBOUNCE = 500/g,
        "PROPERTY_SAVE_DEBOUNCE = 0",
        "propertyDebounceAndBlur",
      ],
      ["acknowledgement", /setSaved/g, "removed", "acknowledgedSaveState"],
      ["keys", /stopPropagation/g, "removed", "propertyKeyboardIsolation"],
      ["binding truth", /UNCONNECTED/g, "removed", "truthfulBindingStatus"],
      ["render states", /LOADING/g, "removed", "renderStates"],
      ["history", /getElementHistory/g, "removed", "historyApiAndControls"],
      ["shortcut", /shiftKey/g, "removed", "historyKeyboardShortcuts"],
      [
        "geometry",
        /height: var\(--control-height\)/g,
        "",
        "siblingGeometryCss",
      ],
      ["right inspector", /20em/g, "1fr", "rightInspectorLayout"],
    ];
    for (const [label, pattern, replacement, property] of mutations) {
      const mutated = files.map((file) => ({
        ...file,
        source: file.source.replace(pattern, replacement),
      }));
      assert.equal(inspectPhase6Frontend(mutated)[property], false, label);
    }
  });

  it("requires assertion-backed behavioral coverage rather than keywords", () => {
    const fixtures = completeBehavioralFiles();
    const baseline = inspectPhase6TestInventory(fixtures);
    assert.equal(baseline.skippedTests.length, 0);
    for (const capability of REQUIRED_PHASE6_TEST_CAPABILITIES)
      assert.equal(baseline.capabilities[capability], true, capability);

    const keywordOnly = fixtures.map((file) => ({
      ...file,
      source: file.source.replace(
        /it\("one additional fixture projects palette inspector inventory editor runtime"[\s\S]*?\}\);/u,
        `it("one additional fixture projects palette inspector inventory editor runtime", () => { const result = true; });`,
      ),
    }));
    assert.equal(
      inspectPhase6TestInventory(keywordOnly).capabilities[
        "registry-one-entry-all-projections"
      ],
      false,
    );
    const withoutCoordination = fixtures.map((file) => ({
      ...file,
      source: file.source
        .replace(
          /it\("property pending 500ms debounce blocks undo redo lock delete actions"[\s\S]*?\}\);/u,
          "",
        )
        .replace(
          /it\("consecutive edits switch between two elements use latest monotonic projectRevision on second request"[\s\S]*?\}\);/u,
          "",
        ),
    }));
    assert.equal(
      inspectPhase6TestInventory(withoutCoordination).capabilities[
        "pending-property-action-coordination"
      ],
      false,
    );
    const parameterized = inspectPhase6TestInventory([
      sourceFile(
        "apps/web/src/features/elements/parameterized.test.tsx",
        `
          it("binding status renders NOT_APPLICABLE and UNCONNECTED", () => { expect(status).toBeTruthy(); });
          it.each(["kpi-card", "data-table"])("renderer render state EMPTY LOADING ERROR DATA", () => {
            expect(rendered).toBeTruthy();
          });
        `,
      ),
    ]);
    assert.equal(
      parameterized.capabilities["truthful-binding-status-and-render-states"],
      true,
    );
    const skipped = inspectPhase6TestInventory([
      ...fixtures,
      sourceFile("apps/web/src/skip.test.ts", `it.skip("disabled", () => {});`),
    ]);
    assert.equal(skipped.skippedTests.length, 1);
  });

  it("rejects browser geometry, placement, immutable Runtime, and responsive mutations", () => {
    const evidence = completeBrowserEvidence();
    const baseline = inspectPhase6BrowserEvidence(evidence);
    for (const [property, value] of Object.entries(baseline))
      assert.equal(value, true, property);
    const mutations = [
      [
        "provenance",
        { ...evidence, target: "shared session" },
        "operationalPass",
      ],
      [
        "viewport",
        { ...evidence, viewport: { width: 1279, height: 720 } },
        "desktopViewport",
      ],
      [
        "tabs",
        { ...evidence, inspectorTabRects: evidence.inspectorTabRects.slice(1) },
        "allSixTabsEqual",
      ],
      [
        "actions",
        {
          ...evidence,
          inspectorActionRects: evidence.inspectorActionRects.map(
            (rect, index) => (index ? { ...rect, width: 99 } : rect),
          ),
        },
        "inspectorActionsEqual",
      ],
      [
        "history",
        {
          ...evidence,
          historyControlRects: [{ x: 0, y: 0, width: 100, height: 40 }],
        },
        "historyControlsEqual",
      ],
      [
        "placement",
        {
          ...evidence,
          rightInspectorPlacement: {
            canvasRect: evidence.rightInspectorPlacement.canvasRect,
            inspectorRect: {
              ...evidence.rightInspectorPlacement.inspectorRect,
              x: 900,
            },
          },
        },
        "inspectorIsRight",
      ],
      [
        "runtime",
        {
          ...evidence,
          immutableRuntimeRender: {
            ...evidence.immutableRuntimeRender,
            publishedValueAfterDraft: "After",
          },
        },
        "immutableRuntime",
      ],
      [
        "mobile",
        {
          ...evidence,
          responsive419: {
            ...evidence.responsive419,
            documentScrollWidth: 420,
          },
        },
        "responsive419",
      ],
      [
        "console",
        { ...evidence, consoleErrorCount: 1 },
        "cleanConsoleAndNetwork",
      ],
    ];
    for (const [label, mutation, property] of mutations)
      assert.equal(
        inspectPhase6BrowserEvidence(mutation)[property],
        false,
        label,
      );
  });

  it("pins the canonical Phase 6 inventories", () => {
    assert.deepEqual(REQUIRED_PHASE6_ELEMENT_TYPES, [
      "text",
      "button",
      "container",
      "kpi-card",
      "number-input",
      "data-table",
    ]);
    assert.deepEqual(REQUIRED_PROPERTY_TABS, [
      "general",
      "style",
      "data",
      "interaction",
      "validation",
      "advanced",
    ]);
    assert.deepEqual(REQUIRED_COMMAND_TYPES, [
      "ADD",
      "MOVE",
      "RESIZE",
      "LOCK",
      "BATCH_LAYOUT",
      "DELETE",
      "PROPERTIES",
    ]);
  });
});
