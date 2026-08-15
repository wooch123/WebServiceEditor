import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import {
  CANONICAL_PHASE7_ROUTES,
  PHASE7_BROWSER_EVIDENCE_PATH,
  PHASE7_EVIDENCE_PATH,
  REQUIRED_LAYOUT_PRESET_IDS,
  REQUIRED_PHASE6_ELEMENT_PREFIX,
  REQUIRED_PHASE7_ELEMENT_TYPES,
  REQUIRED_PHASE7_TEST_CAPABILITIES,
  REQUIRED_STATISTICAL_ELEMENT_TYPES,
  calculatePresetCoordinateChecksum,
  calculatePresetRegistryChecksum,
  canonicalPresetCoordinates,
  inspectLayoutPresetRegistry,
  inspectPhase7Backend,
  inspectPhase7BrowserEvidence,
  inspectPhase7ElementRegistry,
  inspectPhase7Frontend,
  inspectPhase7RouteContract,
  inspectPhase7Schema,
  inspectPhase7TestInventory,
  inspectPresetCoordinateSnapshot,
  stablePresetRegistryJson,
  validatePhase7,
} from "../../scripts/verify-phase7.mjs";
import {
  REQUIRED_COMMON_PROPERTY_IDS,
  calculateRegistryChecksum,
} from "../../scripts/verify-phase6.mjs";

function sourceFile(path, source) {
  return { path, source };
}

function commonField(id) {
  const [tab, name] = id.split(".");
  const readOnly = [
    "general.elementId",
    "style.width",
    "style.height",
    "data.bindingStatus",
    "interaction.supportedEvents",
    "validation.status",
    "advanced.type",
    "advanced.typeVersion",
  ].includes(id);
  if (["general.visible", "general.disabled", "general.locked"].includes(id)) {
    return {
      id,
      tab,
      label: name,
      control: "switch",
      valueType: "boolean",
      target:
        id === "general.visible" || id === "general.locked"
          ? "element"
          : "props",
      required: true,
      readOnly: false,
    };
  }
  if (["style.width", "style.height", "advanced.typeVersion"].includes(id)) {
    return {
      id,
      tab,
      label: name,
      control: "read-only",
      valueType: "number",
      target: id.startsWith("style.") ? "layout" : "computed",
      required: true,
      readOnly: true,
    };
  }
  if (
    [
      "style.padding",
      "style.margin",
      "style.borderWidth",
      "style.radius",
      "style.fontSize",
    ].includes(id)
  ) {
    return {
      id,
      tab,
      label: name,
      control: "slider",
      valueType: "number",
      target: "style",
      required: true,
      readOnly: false,
      min: 0,
      max: 100,
      step: 1,
    };
  }
  if (
    [
      "style.backgroundToken",
      "style.borderToken",
      "style.textColorToken",
    ].includes(id)
  ) {
    return {
      id,
      tab,
      label: name,
      control: "theme-token",
      valueType: "enum",
      target: "style",
      required: true,
      readOnly: false,
      options: [{ value: "card", label: "Card" }],
    };
  }
  if (
    [
      "style.borderStyle",
      "style.shadow",
      "style.fontWeight",
      "style.textAlign",
      "style.contentAlign",
    ].includes(id)
  ) {
    return {
      id,
      tab,
      label: name,
      control: "select",
      valueType: "enum",
      target: "style",
      required: true,
      readOnly: false,
      options: [{ value: "default", label: "Default" }],
    };
  }
  if (id === "style.backgroundCustom") {
    return {
      id,
      tab,
      label: name,
      control: "color",
      valueType: "string",
      target: "style",
      required: false,
      readOnly: false,
      maxLength: 32,
    };
  }
  return {
    id,
    tab,
    label: name,
    control: id === "data.bindingStatus" ? "binding-status" : "read-only",
    valueType: "string",
    target: readOnly
      ? "computed"
      : id === "general.displayName"
        ? "element"
        : "props",
    required: !["general.tooltip", "general.accessibilityLabel"].includes(id),
    readOnly,
    ...(readOnly ? {} : { control: "text", maxLength: 500 }),
  };
}

function elementDefinition(type, category) {
  const statistical = REQUIRED_STATISTICAL_ELEMENT_TYPES.includes(type);
  const dataLike = statistical || type === "kpi-card" || type === "data-table";
  const fields = REQUIRED_COMMON_PROPERTY_IDS.map(commonField);
  if (statistical) {
    fields.push(
      {
        id: "general.title",
        tab: "general",
        label: "Title",
        control: "text",
        valueType: "string",
        target: "props",
        required: true,
        readOnly: false,
        maxLength: 120,
      },
      {
        id: "general.emptyLabel",
        tab: "general",
        label: "Empty label",
        control: "text",
        valueType: "string",
        target: "props",
        required: true,
        readOnly: false,
        maxLength: 120,
      },
    );
  }
  return {
    type,
    typeVersion: 1,
    label: type,
    description: `${type} element`,
    category,
    iconName: "ChartNoAxesCombined",
    rendererKey: type,
    editorRendererKey: type,
    runtimeRendererKey: type,
    validatorKey: type,
    defaultName: type,
    defaultProps: statistical
      ? {
          internalName: type,
          disabled: false,
          tooltip: "",
          accessibilityLabel: type,
          title: type,
          emptyLabel: "데이터 없음",
        }
      : {
          internalName: type,
          disabled: false,
          tooltip: "",
          accessibilityLabel: type,
        },
    defaultStyle: {
      padding: 8,
      margin: 0,
      backgroundToken: "card",
      backgroundCustom: "",
      borderToken: "card",
      borderWidth: 1,
      borderStyle: "default",
      radius: 8,
      shadow: "default",
      textColorToken: "card",
      fontSize: 12,
      fontWeight: "default",
      textAlign: "default",
      contentAlign: "default",
    },
    defaultEvents: [],
    layout: {
      defaultW: dataLike ? 8 : 4,
      defaultH: dataLike ? 8 : 4,
      minW: 2,
      minH: 2,
      maxW: 24,
      maxH: 40,
    },
    propertySchema: { fields },
    bindingPorts: dataLike
      ? [
          {
            id: "data",
            label: "Data",
            direction: "input",
            side: "left",
            valueType: "rows",
            required: true,
            maxConnections: 1,
          },
        ]
      : type === "number-input"
        ? [
            {
              id: "value",
              label: "Value",
              direction: "output",
              side: "right",
              valueType: "number",
              required: false,
              maxConnections: null,
            },
          ]
        : [],
    events: [],
    supportedRenderStates: dataLike
      ? ["EMPTY", "LOADING", "ERROR", "DATA"]
      : ["DATA"],
    migrations: [],
  };
}

function completeElementRegistry() {
  const categories = [
    "basic",
    "basic",
    "basic",
    "statistics",
    "input",
    "data",
    ...REQUIRED_STATISTICAL_ELEMENT_TYPES.map(() => "statistics"),
  ];
  const registry = {
    schemaVersion: 1,
    tabs: [
      "general",
      "style",
      "data",
      "interaction",
      "validation",
      "advanced",
    ].map((id) => ({ id, label: id })),
    definitions: REQUIRED_PHASE7_ELEMENT_TYPES.map((type, index) =>
      elementDefinition(type, categories[index]),
    ),
  };
  return { ...registry, checksum: calculateRegistryChecksum(registry) };
}

function suggestedSchema() {
  return {
    id: "measurement-records",
    label: "Measurements",
    tables: [
      {
        templateId: "measurements",
        displayName: "Measurements",
        fields: [
          {
            templateId: "measured-at",
            displayName: "Measured At",
            dataType: "DATETIME",
            nullable: false,
          },
          {
            templateId: "value-a",
            displayName: "Value A",
            dataType: "REAL",
            nullable: false,
          },
          {
            templateId: "value-b",
            displayName: "Value B",
            dataType: "REAL",
            nullable: true,
          },
        ],
      },
    ],
  };
}

function presetDefinition(id, index) {
  const type = REQUIRED_STATISTICAL_ELEMENT_TYPES[index % 6];
  return {
    id,
    version: 1,
    name: id,
    category: ["dashboard", "statistics", "data", "general"][index % 4],
    description: `${id} preset`,
    iconName: "LayoutDashboard",
    requiredElements: [type],
    elementCount: 1,
    elements: [
      {
        templateId: `${id}-primary`,
        elementType: type,
        name: id,
        props: {},
        style: {},
        layout: { x: 0, y: 0, w: 8, h: 8 },
      },
    ],
    bindingPlaceholders: [
      {
        templateId: `${id}-primary`,
        portId: "data",
        status: "UNCONNECTED",
      },
    ],
    suggestedSchema: id === "data-entry" ? suggestedSchema() : null,
    validationScenario: null,
  };
}

function withPresetChecksum(registry) {
  return { ...registry, checksum: calculatePresetRegistryChecksum(registry) };
}

function completePresetRegistry() {
  return withPresetChecksum({
    schemaVersion: 1,
    definitions: REQUIRED_LAYOUT_PRESET_IDS.map(presetDefinition),
  });
}

function proposedElements() {
  return [
    {
      templateId: "a",
      entry: {
        element: { id: "element-a", type: "line-chart" },
        layout: { x: 0, y: 0, w: 8, h: 8 },
      },
    },
    {
      templateId: "b",
      entry: {
        element: { id: "element-b", type: "data-table" },
        layout: { x: 8, y: 0, w: 8, h: 8 },
      },
    },
  ];
}

function completeSchemaSource() {
  return `
    export const LATEST_METADATA_SCHEMA_VERSION = 6;
    export const STATISTICAL_ELEMENTS_LAYOUT_PRESETS_SCHEMA_CHECKSUM = "abc";
    const statisticalElementsLayoutPresets = \`
      CREATE TABLE layout_preset_instances (
        id TEXT, project_id TEXT, page_id TEXT, preset_id TEXT,
        preset_version INTEGER, registry_checksum TEXT,
        state TEXT CHECK state IN ('APPLIED','UNDONE','DISCARDED')
      );
      CREATE TABLE layout_preset_instance_elements (
        instance_id TEXT, element_id TEXT, template_id TEXT,
        FOREIGN KEY (instance_id) REFERENCES layout_preset_instances(id) ON DELETE CASCADE
      );
      CREATE TABLE element_binding_placeholders (
        instance_id TEXT, element_id TEXT, template_id TEXT, port_id TEXT,
        status TEXT CHECK status = 'UNCONNECTED',
        FOREIGN KEY (instance_id) REFERENCES layout_preset_instances(id) ON DELETE CASCADE
      );
      CREATE TABLE element_commands_v6 (
        command_type TEXT CHECK command_type IN
          ('ADD','MOVE','RESIZE','LOCK','BATCH_LAYOUT','DELETE','PROPERTIES','PRESET_APPLY')
      );
    \`;
    const migration = { version: 6, name: "statistical-elements-layout-presets", sql: statisticalElementsLayoutPresets };
    if (userVersion > LATEST_METADATA_SCHEMA_VERSION) throw new Error("unknown future metadata schema version");
    const migrate = database.transaction(() => migration); migrate.immediate();
  `;
}

function completeBackendFiles() {
  return [
    sourceFile(
      "apps/server/src/layout-presets/layout-preset-registry.ts",
      `
        const LAYOUT_PRESET_DEFINITIONS = []; const LAYOUT_PRESET_IDS = [];
        const LAYOUT_PRESET_REGISTRY_CHECKSUM = stableJson(LAYOUT_PRESET_DEFINITIONS);
        function definition(id) { if (!LAYOUT_PRESET_IDS.includes(id)) throw new ApiError("LAYOUT_PRESET_NOT_FOUND"); }
        const suggestedSchema = null;
      `,
    ),
    sourceFile(
      "apps/server/src/layout-presets/layout-preset-preview-store.ts",
      `
        const capacity = 256; const ttl = 300_000;
        class Store { create({projectId,pageId,presetId,presetVersion,registryChecksum,mode,projectRevision,layoutRevision,coordinateChecksum,templateId,elementId}) {}
          consume(previewId) {} }
      `,
    ),
    sourceFile(
      "apps/server/src/layout-presets/layout-preset-service.ts",
      `
        function preview({ suggestedSchema }) { return previewStore.create(); }
        function apply({previewId,idempotencyKey,layoutRevision,projectRevision}) {
          checkIdempotency(idempotencyKey); const snapshot = previewStore.consume(previewId);
          if (snapshot.mode === "REPLACE" && snapshot.locked) throw new Error("locked");
          if (snapshot.mode === "ADD") translateRelativeCollision();
          return transaction(() => record("PRESET_APPLY", snapshot.coordinateChecksum));
        }
      `,
    ),
    sourceFile(
      "apps/server/src/layout-presets/layout-preset-repository.ts",
      `
        const statements = ["layout_preset_instances", "layout_preset_instance_elements", "element_binding_placeholders"];
        function save({coordinateChecksum,templateId,elementId}) { return transaction(() => statements); }
        function definitionState() { return {presetInstances, presetInstanceElements, bindingPlaceholders}; }
      `,
    ),
    sourceFile(
      "apps/server/src/projects/project-service.ts",
      `
        function exportProject() {
          const layoutPresetInstances = elementRepository.listExportableLayoutPresetInstances(projectId);
          return { layoutPresetInstances: layoutPresetInstances.map(({presetSnapshot}) => ({presetSnapshot})) };
        }
        function importProject({layoutPresetInstances}) {
          const pageIdMap = new Map(); const elementIdMap = new Map();
          elementRepository.insertLayoutPresetInstance({origin:"IMPORT"});
          elementRepository.insertLayoutPresetMembership();
          elementRepository.attachImportedLayoutPresetPlaceholder();
        }
        function clone() { return importProject(exportProject()); }
        function purge() { return elementRepository.definitionState(); }
      `,
    ),
  ];
}

function completeFrontendFiles() {
  return [
    sourceFile(
      "apps/web/src/services/layout-presets-api.ts",
      `export function listLayoutPresets(){} export function getLayoutPreset(){} export function previewLayoutPreset(){} export function applyLayoutPreset(){} export function listLayoutPresetInstances(){}`,
    ),
    sourceFile(
      "apps/web/src/features/presets/LayoutPresetBrowser.tsx",
      `
        import { LAYOUT_PRESET_PREVIEW_DATA } from "../elements/statistical-rendering";
        function Browser({definitions}) { listLayoutPresets(); definitions.map((definition) => definition.elements.map(({templateId,layout}) =>
          <div data-template={templateId} data-x={layout.x} data-y={layout.y} data-w={layout.w} data-h={layout.h}>UNCONNECTED <Badge /></div>));
          const mode = "ADD"; const other = "REPLACE"; const preview = previewLayoutPreset();
          const {previewId, impact} = preview; confirm(impact); applyLayoutPreset(previewId, LAYOUT_PRESET_PREVIEW_DATA); }
      `,
    ),
    sourceFile(
      "apps/web/src/features/elements/ElementRenderer.tsx",
      `${REQUIRED_STATISTICAL_ELEMENT_TYPES.join(" ")} StatisticalVisualization compact UNCONNECTED Badge`,
    ),
    sourceFile(
      "apps/web/src/features/runtime/RuntimeElementRenderer.tsx",
      `${REQUIRED_STATISTICAL_ELEMENT_TYPES.join(" ")} StatisticalVisualization compact UNCONNECTED Badge`,
    ),
    sourceFile(
      "apps/web/src/features/elements/statistical-rendering.tsx",
      `
        export const LAYOUT_PRESET_PREVIEW_DATA = {};
        const config = {color:"var(--chart-1)"};
        function histogramBins(data, binCount) { return buildBins(data, binCount); }
        function BoxPlot({showOutliers, outliers}) { return showOutliers && <Scatter data={outliers} />; }
        function StatisticalVisualization({state,compact}) { return <figure aria-label="chart"><figcaption>Chart</figcaption><LineChart accessibilityLayer isAnimationActive={false}>{state === "EMPTY" || state === "LOADING" || state === "ERROR" || state === "DATA"}</LineChart></figure>; }
      `,
    ),
    sourceFile(
      "apps/web/src/styles.css",
      `
        :root { --control-height: 40px; }
        .layout-preset-modes { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); }
        .layout-preset-modes [data-slot="toggle-group-item"] { width:100%; height:var(--control-height); }
        .layout-preset-actions, .layout-preset-replace-actions { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); }
        .layout-preset-actions [data-slot="button"], .layout-preset-replace-actions [data-slot="button"] { width:100%; height:var(--control-height); }
        @media (max-width: 720px) { .layout-preset-dialog {} .layout-preset-browser { overflow-y:auto; } }
      `,
    ),
  ];
}

function completeBehavioralFiles() {
  const titles = [
    "all statistical six registry palette inspector runtime projections",
    "statistical chart properties ports required left input",
    "statistical persisted defaults contain no demo dataset",
    "statistical Editor Runtime semantic theme accessibility",
    "statistical states EMPTY LOADING ERROR DATA",
    "statistical reduced motion animation and lightweight resize preview",
    "histogram binCount changes rendered bin marks",
    "box plot showOutliers changes rendered outlier marks",
    "all 22 preset registry checksum exact order",
    "preset real template element count coordinate bounds no overlap",
    "preset placeholder required left input port UNCONNECTED",
    "preset live structured preview uses no screenshot image",
    "preset preview no-write and apply exact coordinate snapshot",
    "preset coordinateChecksum exact templateId order tamper rejection",
    "preset ADD relative translation collision existing page",
    "preset REPLACE impact requires confirmation",
    "preset REPLACE locked rejects 409",
    "preset preview expiry stale reuse cross-page cross-preset scope",
    "preset apply idempotency replay",
    "preset apply transaction failure rollback",
    "PRESET_APPLY undo redo discarded branch",
    "preset instance reload and server restart",
    "preset Draft immutable Published Runtime republish",
    "preset clone export import remap ownership",
    "preset trash restore purge ownership no orphan",
    "statistical preset sqlite v6 migration forward preserves v5",
    "suggestedSchema runtime DB schema file checksum unchanged no-write",
    "preset ADD REPLACE controls equal geometry same size",
    "preset browser 419 responsive reachable no overflow",
  ];
  return [
    sourceFile(
      "apps/server/test/integration/statistical-elements-layout-presets.test.ts",
      titles
        .map((title) => {
          if (
            /histogram binCount/iu.test(title) ||
            /box plot showOutliers/iu.test(title)
          ) {
            return `it("${title}", () => { const {rerender, container} = render(); assert(container.querySelectorAll("[data-mark]").length === 2); rerender(); assert(container.querySelectorAll("[data-mark]").length === 4); });`;
          }
          return `it("${title}", () => { assert(true); });`;
        })
        .join("\n"),
    ),
  ];
}

function rect(x) {
  return { x, y: 10, width: 100, height: 40 };
}

function coordinates() {
  return [
    {
      templateId: "a",
      elementId: "element-a",
      type: "line-chart",
      x: 0,
      y: 0,
      w: 8,
      h: 8,
    },
    {
      templateId: "b",
      elementId: "element-b",
      type: "data-table",
      x: 8,
      y: 0,
      w: 8,
      h: 8,
    },
  ];
}

function completeBrowserEvidence() {
  const checksum = createHash("sha256")
    .update(stablePresetRegistryJson(coordinates()))
    .digest("hex");
  return {
    schemaVersion: 1,
    generatedAt: "2026-08-16T00:00:00.000Z",
    result: "PASS",
    target: "isolated local browser session",
    url: "http://127.0.0.1:45177/",
    viewport: { width: 1280, height: 720 },
    presetInventory: {
      expectedCount: 22,
      visibleCount: 22,
      ids: [...REQUIRED_LAYOUT_PRESET_IDS],
    },
    presetBrowser: {
      modeControlRects: [rect(0), rect(100)],
      actionControlRects: [rect(0), rect(100)],
      impactActionRects: [rect(0), rect(100)],
      structuredPreview: {
        presetId: "analysis-dashboard",
        usesImage: false,
        expectedElementCount: 2,
        renderedElementCount: 2,
        coordinates: coordinates(),
      },
    },
    addApply: {
      previewElementCount: 2,
      appliedElementCount: 2,
      previewCoordinates: coordinates(),
      appliedCoordinates: [...coordinates()].reverse(),
      previewCoordinateChecksum: checksum,
      appliedCoordinateChecksum: checksum,
      instanceCoordinateChecksum: checksum,
      exactCoordinates: true,
      durableInstanceAfterReload: true,
    },
    replaceApply: {
      existingCount: 2,
      impactRemovalCount: 2,
      confirmationRequired: true,
      appliedCount: 2,
      undoRestoredCount: 2,
    },
    statisticalRender: {
      types: [...REQUIRED_STATISTICAL_ELEMENT_TYPES],
      semanticChartVariables: ["--chart-1", "--chart-2"],
      accessibleTextCount: 6,
      reducedMotionAnimationCount: 0,
      resizePreviewDuringDrag: true,
      fullRenderAfterResize: true,
    },
    immutableRuntime: {
      publishedCountBeforeDraft: 2,
      publishedCountAfterDraft: 2,
      draftCountAfterApply: 4,
      publishedCountAfterRepublish: 4,
    },
    responsive419: {
      viewportWidth: 419,
      documentScrollWidth: 419,
      browserReachable: true,
      controlsReachable: true,
      siblingGeometryPreserved: true,
    },
    consoleErrorCount: 0,
    failedRequestCount: 0,
  };
}

describe("Phase 7 validation contract", () => {
  it("passes the current repository Phase 7 gate", async () => {
    const report = await validatePhase7();
    assert.equal(
      report.result,
      "PASS",
      JSON.stringify(report.failures, null, 2),
    );
    assert.ok(report.checks >= 100);
    assert.equal(report.details.presetInspection.exactCount, true);
    assert.equal(report.details.requiredEvidencePath, PHASE7_EVIDENCE_PATH);
    assert.equal(
      report.details.browserEvidencePath,
      PHASE7_BROWSER_EVIDENCE_PATH,
    );
  });

  it("pins the exact Phase 7 inventories and canonical corpus order", () => {
    assert.deepEqual(REQUIRED_PHASE6_ELEMENT_PREFIX, [
      "text",
      "button",
      "container",
      "kpi-card",
      "number-input",
      "data-table",
    ]);
    assert.deepEqual(REQUIRED_STATISTICAL_ELEMENT_TYPES, [
      "line-chart",
      "bar-chart",
      "histogram",
      "scatter-plot",
      "box-plot",
      "summary-statistics",
    ]);
    assert.equal(REQUIRED_PHASE7_ELEMENT_TYPES.length, 12);
    assert.equal(REQUIRED_LAYOUT_PRESET_IDS.length, 22);
    assert.deepEqual(REQUIRED_LAYOUT_PRESET_IDS.slice(0, 3), [
      "analysis-dashboard",
      "blank-grid",
      "board",
    ]);
    assert.equal(REQUIRED_LAYOUT_PRESET_IDS.at(-1), "trend-analysis");
  });

  it("canonicalizes Preset registries independently of object key insertion order", () => {
    const left = { z: 1, a: { y: 2, b: 3 }, list: [{ q: 4, c: 5 }] };
    const right = { list: [{ c: 5, q: 4 }], a: { b: 3, y: 2 }, z: 1 };
    assert.equal(
      stablePresetRegistryJson(left),
      stablePresetRegistryJson(right),
    );
  });

  it("rejects statistical Registry inventory, port, state, renderer, and demo-data mutations", () => {
    const baseline = completeElementRegistry();
    const inspected = inspectPhase7ElementRegistry(baseline);
    for (const property of [
      "registryChecksumExact",
      "exactTwelveTypeOrder",
      "exactStatisticalSix",
      "phase6ContractStillValid",
      "statisticalCategory",
      "executableProjectionKeys",
      "requiredLeftInputPorts",
      "allFourRenderStates",
      "defaultsDeclaredByProperties",
      "noPersistedDemoDataDefaults",
      "layoutRulesValid",
    ])
      assert.equal(inspected[property], true, property);

    const mutate = (index, change) => {
      const definitions = baseline.definitions.map((definition, position) =>
        position === index ? change(definition) : definition,
      );
      return {
        ...baseline,
        definitions,
        checksum: calculateRegistryChecksum({ ...baseline, definitions }),
      };
    };
    const statisticalIndex = REQUIRED_PHASE6_ELEMENT_PREFIX.length;
    const cases = [
      [
        "order",
        { ...baseline, definitions: [...baseline.definitions].reverse() },
        "exactTwelveTypeOrder",
      ],
      [
        "renderer",
        mutate(statisticalIndex, (definition) => ({
          ...definition,
          runtimeRendererKey: "text",
        })),
        "executableProjectionKeys",
      ],
      [
        "port",
        mutate(statisticalIndex, (definition) => ({
          ...definition,
          bindingPorts: definition.bindingPorts.map((port) => ({
            ...port,
            side: "right",
          })),
        })),
        "requiredLeftInputPorts",
      ],
      [
        "state",
        mutate(statisticalIndex, (definition) => ({
          ...definition,
          supportedRenderStates: ["EMPTY", "DATA"],
        })),
        "allFourRenderStates",
      ],
      [
        "demo data",
        mutate(statisticalIndex, (definition) => ({
          ...definition,
          defaultProps: { ...definition.defaultProps, series: [{ value: 1 }] },
        })),
        "noPersistedDemoDataDefaults",
      ],
    ];
    for (const [label, registry, property] of cases)
      assert.equal(
        inspectPhase7ElementRegistry(registry)[property],
        false,
        label,
      );
  });

  it("rejects Preset count, checksum, image, layout, placeholder, and schema mutations", () => {
    const elements = completeElementRegistry();
    const baseline = completePresetRegistry();
    const inspected = inspectLayoutPresetRegistry(baseline, elements);
    for (const property of [
      "schemaVersion",
      "checksumExact",
      "exactCanonicalOrder",
      "exactCount",
      "definitionShapeValid",
      "allTemplatesReal",
      "coordinatesBounded",
      "noTemplateOverlap",
      "requiredElementsExact",
      "placeholdersRequiredAndValid",
      "suggestedSchemaReadOnlyBoundary",
      "screenshotOnlyForbidden",
    ])
      assert.equal(inspected[property], true, property);

    const mutate = (change, recompute = true) => {
      const definitions = baseline.definitions.map((definition, index) =>
        index === 0 ? change(definition) : definition,
      );
      const registry = { ...baseline, definitions };
      return recompute ? withPresetChecksum(registry) : registry;
    };
    const cases = [
      [
        "checksum",
        mutate((definition) => ({ ...definition, name: "Changed" }), false),
        "checksumExact",
      ],
      [
        "order",
        withPresetChecksum({
          ...baseline,
          definitions: [...baseline.definitions].reverse(),
        }),
        "exactCanonicalOrder",
      ],
      [
        "count",
        withPresetChecksum({
          ...baseline,
          definitions: baseline.definitions.slice(1),
        }),
        "exactCount",
      ],
      [
        "empty",
        mutate((definition) => ({
          ...definition,
          elementCount: 0,
          elements: [],
        })),
        "allTemplatesReal",
      ],
      [
        "bounds",
        mutate((definition) => ({
          ...definition,
          elements: definition.elements.map((item) => ({
            ...item,
            layout: { ...item.layout, x: 23, w: 8 },
          })),
        })),
        "coordinatesBounded",
      ],
      [
        "placeholder",
        mutate((definition) => ({ ...definition, bindingPlaceholders: [] })),
        "placeholdersRequiredAndValid",
      ],
      [
        "image",
        mutate((definition) => ({ ...definition, thumbnail: "preview.png" })),
        "screenshotOnlyForbidden",
      ],
      [
        "schema SQL",
        mutate((definition) => ({
          ...definition,
          suggestedSchema: { sql: "DROP TABLE x" },
        })),
        "suggestedSchemaReadOnlyBoundary",
      ],
    ];
    for (const [label, registry, property] of cases)
      assert.equal(
        inspectLayoutPresetRegistry(registry, elements)[property],
        false,
        label,
      );
  });

  it("canonicalizes coordinate checksums and rejects order and tampering independently", () => {
    const proposals = proposedElements();
    const checksum = calculatePresetCoordinateChecksum(proposals);
    assert.match(checksum, /^[a-f0-9]{64}$/u);
    assert.equal(
      calculatePresetCoordinateChecksum([...proposals].reverse()),
      checksum,
    );
    assert.deepEqual(
      canonicalPresetCoordinates([...proposals].reverse()),
      canonicalPresetCoordinates(proposals),
    );
    const baseline = inspectPresetCoordinateSnapshot({
      proposedElements: proposals,
      coordinateChecksum: checksum,
    });
    assert.deepEqual(baseline, {
      proposedElementsComplete: true,
      canonicalOrder: true,
      checksumFormat: true,
      checksumExact: true,
    });
    assert.equal(
      inspectPresetCoordinateSnapshot({
        proposedElements: [...proposals].reverse(),
        coordinateChecksum: checksum,
      }).canonicalOrder,
      false,
    );
    const tampered = JSON.parse(JSON.stringify(proposals));
    tampered[0].entry.layout.x = 1;
    assert.equal(
      inspectPresetCoordinateSnapshot({
        proposedElements: tampered,
        coordinateChecksum: checksum,
      }).checksumExact,
      false,
    );
    assert.equal(
      inspectPresetCoordinateSnapshot({
        proposedElements: [{ entry: proposals[0].entry }],
        coordinateChecksum: checksum,
      }).proposedElementsComplete,
      false,
    );
  });

  it("rejects missing Phase 7 routes and unversioned aliases", () => {
    const complete = CANONICAL_PHASE7_ROUTES.map(
      ({ method, path }) =>
        `server.${method.toLowerCase()}("${path}", handler);`,
    ).join("\n");
    assert.equal(
      inspectPhase7RouteContract([sourceFile("routes.ts", complete)])
        .missingRoutes.length,
      0,
    );
    const missing = inspectPhase7RouteContract([
      sourceFile(
        "routes.ts",
        complete.replace(CANONICAL_PHASE7_ROUTES[0].path, "/removed"),
      ),
    ]);
    assert.equal(missing.missingRoutes.length, 1);
    const unversioned = inspectPhase7RouteContract([
      sourceFile(
        "routes.ts",
        `${complete}\nserver.get("/layout-presets", handler);`,
      ),
    ]);
    assert.equal(unversioned.unversionedRoutes.length, 1);
  });

  it("rejects migration, ownership, and PRESET_APPLY schema mutations", () => {
    const baseline = completeSchemaSource();
    const inspected = inspectPhase7Schema(baseline);
    for (const [property, value] of Object.entries(inspected))
      assert.equal(value, true, property);
    for (const [label, pattern, replacement, property] of [
      [
        "version",
        /LATEST_METADATA_SCHEMA_VERSION = 6/g,
        "LATEST_METADATA_SCHEMA_VERSION = 5",
        "latestVersionAtLeastSix",
      ],
      [
        "migration",
        /statistical-elements-layout-presets/g,
        "removed",
        "namedVersionSixMigration",
      ],
      ["instance", /layout_preset_instances/g, "removed", "instanceTable"],
      [
        "membership",
        /layout_preset_instance_elements/g,
        "removed",
        "membershipTable",
      ],
      [
        "placeholder",
        /element_binding_placeholders/g,
        "removed",
        "placeholderTable",
      ],
      ["command", /PRESET_APPLY/g, "removed", "presetCommandConstrained"],
    ]) {
      assert.equal(
        inspectPhase7Schema(baseline.replace(pattern, replacement))[property],
        false,
        label,
      );
    }
  });

  it("rejects backend preview scope, cache, checksum, history, and persistence mutations", () => {
    const files = completeBackendFiles();
    const baseline = inspectPhase7Backend(files);
    for (const [property, value] of Object.entries(baseline))
      assert.equal(value, true, property);
    for (const [label, pattern, replacement, property] of [
      ["capacity", /256/g, "255", "previewCapacityAndTtl"],
      ["scope", /registryChecksum/g, "removed", "previewScopeBound"],
      ["snapshot", /previewId/g, "removed", "applySnapshotOnly"],
      [
        "coordinate checksum",
        /coordinateChecksum/g,
        "removed",
        "coordinateChecksumBoundary",
      ],
      ["replace lock", /locked/g, "removed", "lockedReplaceRefusal"],
      ["history", /PRESET_APPLY/g, "removed", "atomicPresetHistory"],
      [
        "instances",
        /layout_preset_instances/g,
        "removed",
        "durableInstanceReads",
      ],
      [
        "lifecycle export",
        /listExportableLayoutPresetInstances/g,
        "removed",
        "lifecycleSnapshotExport",
      ],
      [
        "lifecycle import",
        /attachImportedLayoutPresetPlaceholder/g,
        "removed",
        "lifecycleSnapshotImportRemap",
      ],
    ]) {
      const mutated = files.map((file) => ({
        ...file,
        source: file.source.replace(pattern, replacement),
      }));
      assert.equal(inspectPhase7Backend(mutated)[property], false, label);
    }
  });

  it("rejects frontend screenshot, preview bypass, raw color, fake Runtime data, and geometry mutations", () => {
    const files = completeFrontendFiles();
    const baseline = inspectPhase7Frontend(files);
    for (const [property, value] of Object.entries(baseline))
      assert.equal(value, true, property);
    const mutations = [
      ["registry", /definitions\.map/g, "removed", "browserProjectsRegistry"],
      [
        "screenshot",
        /function Browser/g,
        "const image = <img src='preview.png'/>; function Browser",
        "liveStructuredPreview",
      ],
      ["preview", /previewLayoutPreset/g, "removed", "previewBeforeApply"],
      ["replace", /confirm/g, "removed", "replaceImpactConfirmation"],
      ["renderer", /line-chart/g, "removed", "allStatisticalRendererKeys"],
      ["color", /var\(--chart-1\)/g, "#ff0000", "semanticChartTokens"],
      ["a11y", /accessibilityLayer/g, "removed", "accessibleCharts"],
      [
        "histogram bins",
        /histogramBins|buildBins/g,
        "removed",
        "histogramBinCountMaterialized",
      ],
      [
        "box outliers",
        /showOutliers\s*&&/g,
        "removed &&",
        "boxOutlierMarksMaterialized",
      ],
      [
        "fake runtime",
        /StatisticalVisualization compact UNCONNECTED Badge/g,
        "StatisticalVisualization compact UNCONNECTED Badge LAYOUT_PRESET_PREVIEW_DATA",
        "previewFixtureScoped",
      ],
      [
        "geometry",
        /repeat\(2,minmax\(0,1fr\)\)/g,
        "1fr auto",
        "equalSiblingGeometry",
      ],
    ];
    for (const [label, pattern, replacement, property] of mutations) {
      const mutated = files.map((file) => ({
        ...file,
        source: file.source.replace(pattern, replacement),
      }));
      assert.equal(inspectPhase7Frontend(mutated)[property], false, label);
    }
  });

  it("requires assertion-backed behavioral coverage and rejects skipped tests", () => {
    const files = completeBehavioralFiles();
    const baseline = inspectPhase7TestInventory(files);
    assert.equal(baseline.skippedTests.length, 0);
    for (const capability of REQUIRED_PHASE7_TEST_CAPABILITIES)
      assert.equal(baseline.capabilities[capability], true, capability);
    const keywordOnly = files.map((file) => ({
      ...file,
      source: file.source.replace(/assert\([^;]+\);/gu, "true;"),
    }));
    assert.equal(
      Object.values(inspectPhase7TestInventory(keywordOnly).capabilities).some(
        Boolean,
      ),
      false,
    );
    const skipped = inspectPhase7TestInventory([
      ...files,
      sourceFile("skip.test.ts", `it.skip("disabled", () => {});`),
    ]);
    assert.equal(skipped.skippedTests.length, 1);
  });

  it("rejects browser inventory, geometry, coordinate checksum, Runtime, mobile, and console mutations", () => {
    const evidence = completeBrowserEvidence();
    const baseline = inspectPhase7BrowserEvidence(evidence);
    for (const [property, value] of Object.entries(baseline))
      assert.equal(value, true, property);
    const mutations = [
      [
        "inventory",
        {
          ...evidence,
          presetInventory: { ...evidence.presetInventory, visibleCount: 21 },
        },
        "exactPresetInventory",
      ],
      [
        "mode geometry",
        {
          ...evidence,
          presetBrowser: {
            ...evidence.presetBrowser,
            modeControlRects: [rect(0), { ...rect(100), width: 99 }],
          },
        },
        "equalModeControls",
      ],
      [
        "screenshot",
        {
          ...evidence,
          presetBrowser: {
            ...evidence.presetBrowser,
            structuredPreview: {
              ...evidence.presetBrowser.structuredPreview,
              usesImage: true,
            },
          },
        },
        "structuredLivePreview",
      ],
      [
        "coordinates",
        {
          ...evidence,
          addApply: {
            ...evidence.addApply,
            appliedCoordinates: [
              { ...coordinates()[0], x: 1 },
              coordinates()[1],
            ],
          },
        },
        "previewApplyCoordinatesExact",
      ],
      [
        "coordinate checksum",
        {
          ...evidence,
          addApply: {
            ...evidence.addApply,
            appliedCoordinateChecksum: "b".repeat(64),
          },
        },
        "previewApplyCoordinateChecksum",
      ],
      [
        "durable instance checksum",
        {
          ...evidence,
          addApply: {
            ...evidence.addApply,
            instanceCoordinateChecksum: "b".repeat(64),
          },
        },
        "previewApplyCoordinateChecksum",
      ],
      [
        "checksum coordinate tamper",
        {
          ...evidence,
          addApply: {
            ...evidence.addApply,
            previewCoordinates: coordinates().map((coordinate, index) =>
              index === 0 ? { ...coordinate, x: 1 } : coordinate,
            ),
            appliedCoordinates: coordinates().map((coordinate, index) =>
              index === 0 ? { ...coordinate, x: 1 } : coordinate,
            ),
          },
        },
        "previewApplyCoordinateChecksum",
      ],
      [
        "motion",
        {
          ...evidence,
          statisticalRender: {
            ...evidence.statisticalRender,
            reducedMotionAnimationCount: 1,
          },
        },
        "statisticalAccessibilityAndMotion",
      ],
      [
        "runtime",
        {
          ...evidence,
          immutableRuntime: {
            ...evidence.immutableRuntime,
            publishedCountAfterDraft: 4,
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
        inspectPhase7BrowserEvidence(mutation)[property],
        false,
        label,
      );
  });
});
