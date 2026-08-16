import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";

import {
  REPOSITORY_ROOT,
  Validation,
  finishVerification,
  isMainModule,
  unexpectedFailure,
  validateExactSet,
} from "./lib/verification.mjs";
import { validatePhase18 } from "./verify-phase18.mjs";

export const PHASE19_EVIDENCE_PATH =
  "artifacts/phase19/exhaustive-inventory-validation.json";
export const PHASE19_BROWSER_EVIDENCE_PATH =
  "artifacts/phase19/browser-exhaustive-inventory-validation.json";

export const EXPECTED_ACTIONS = Object.freeze([
  "ADD",
  "MOVE",
  "RESIZE",
  "LOCK",
  "BATCH_LAYOUT",
  "DELETE",
  "PROPERTIES",
  "PRESET_APPLY",
]);

export const EXPECTED_LIFECYCLES = Object.freeze([
  "ACTIVE",
  "TRASHING",
  "TRASHED",
  "RESTORING",
  "PURGING",
  "PURGE_FAILED",
  "PURGED",
]);

export const EXPECTED_ELEMENT_CATEGORY_COUNTS = Object.freeze({
  basic: 12,
  input: 12,
  data: 7,
  statistics: 13,
  collaboration: 6,
  navigation: 5,
});

export const EXPECTED_NEW_ELEMENT_TYPES = Object.freeze([
  "board",
  "comment",
  "chat",
  "file-list",
  "notification",
  "log-viewer",
  "menu",
  "breadcrumb",
  "page-link",
  "button-navigation",
  "tabs-navigation",
]);

const FILES = {
  corpus: "webeditor_project_corpus_v3.json",
  traceability: "docs/requirement-traceability.json",
  status: "docs/implementation-status.md",
  domainContract: "packages/domain/test/element-contract.test.ts",
  serverRegistryTest: "apps/server/test/unit/element-registry.test.ts",
  serverLayoutTest: "apps/server/test/integration/element-layout.test.ts",
  serverInventoryTest: "apps/server/test/integration/validation-report.test.ts",
  webRendererTest: "apps/web/src/features/elements/ElementRenderers.test.tsx",
  webGeometryTest: "apps/web/src/features/elements/element-geometry.test.ts",
  webThemeTest: "apps/web/src/theme.runtime.test.tsx",
};

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function exactSet(actual, expected) {
  return (
    actual.length === expected.length &&
    sorted(actual).every((value, index) => value === sorted(expected)[index])
  );
}

function categoryItems(inventory, category) {
  return inventory
    .filter((item) => item.category === category)
    .map((item) => item.itemId);
}

async function readSources(repositoryRoot) {
  return Object.fromEntries(
    await Promise.all(
      Object.entries(FILES).map(async ([key, path]) => [
        key,
        await readFile(resolve(repositoryRoot, path), "utf8"),
      ]),
    ),
  );
}

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (["dist", "node_modules", ".vite"].includes(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(path)));
    else if (/\.(?:[cm]?[jt]sx?)$/u.test(entry.name)) files.push(path);
  }
  return files;
}

async function inspectCompletionMarkers(repositoryRoot) {
  const files = [
    ...(await sourceFiles(resolve(repositoryRoot, "apps"))),
    ...(await sourceFiles(resolve(repositoryRoot, "packages"))),
  ];
  const offenders = [];
  for (const path of files) {
    const source = await readFile(path, "utf8");
    if (
      /\b(?:it|test|describe)\.(?:skip|todo)\s*\(/iu.test(source) ||
      /\b(?:TODO|FIXME|HACK)\b/u.test(source) ||
      /expected\s+(?:fail|failure)/iu.test(source)
    ) {
      offenders.push(path.slice(repositoryRoot.length + 1));
    }
  }
  return offenders;
}

async function loadOperationalInventory(repositoryRoot) {
  const serverRoot = resolve(repositoryRoot, "apps/server");
  const program = [
    'import { mkdtempSync, rmSync } from "node:fs";',
    'import { tmpdir } from "node:os";',
    'import { join } from "node:path";',
    'const domain = await import("@webeditor/domain");',
    'const theme = await import("@webeditor/theme-core");',
    'const elements = await import("./src/elements/element-registry.ts");',
    'const presets = await import("./src/elements/layout-preset-registry.ts");',
    'const { buildServer } = await import("./src/app.ts");',
    'const root = mkdtempSync(join(tmpdir(), "webeditor-phase19-"));',
    'const app = buildServer({ metadataDatabasePath: join(root, "metadata.sqlite"), storageRoot: join(root, "storage"), staticRoot: false });',
    "try {",
    "  await app.ready();",
    '  const created = await app.inject({ method: "POST", url: "/api/v1/projects", payload: { name: "Phase 19", slug: "phase-19" } });',
    "  if (created.statusCode !== 201) throw new Error(`create ${created.statusCode}: ${created.body}`);",
    "  const project = created.json().project;",
    '  const validation = await app.inject({ method: "POST", url: `/api/v1/projects/${project.id}/validate`, payload: { expectedProjectRevision: project.revision, idempotencyKey: "phase19-inventory" } });',
    "  if (validation.statusCode !== 200) throw new Error(`validate ${validation.statusCode}: ${validation.body}`);",
    "  const registry = elements.elementRegistry();",
    "  process.stdout.write(JSON.stringify({",
    "    pageTypes: domain.PAGE_TYPES,",
    "    elementDefinitions: registry.definitions,",
    "    layoutPresets: presets.layoutPresetRegistry().definitions.map((item) => item.id),",
    "    bindingTypes: domain.BINDING_TYPES,",
    "    themes: theme.themes.map((item) => ({ id: item.id, group: item.group })),",
    "    actions: domain.ELEMENT_COMMAND_TYPES,",
    "    lifecycles: domain.PROJECT_LIFECYCLE_STATUSES,",
    "    requirements: domain.REQUIREMENT_IDS,",
    "    validationRun: validation.json(),",
    "  }));",
    "} finally {",
    "  await app.close();",
    "  rmSync(root, { recursive: true, force: true });",
    "}",
  ].join("\n");
  const result = spawnSync(
    process.execPath,
    [
      "--conditions=development",
      "--import",
      "tsx",
      "--input-type=module",
      "--eval",
      program,
    ],
    {
      cwd: serverRoot,
      encoding: "utf8",
      env: process.env,
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  if (result.status !== 0) {
    throw new Error(
      `Cannot load Phase 19 inventory: ${result.stderr || result.error?.message || `exit ${result.status}`}`,
    );
  }
  return JSON.parse(result.stdout);
}

export function inspectPhase19Inventory(snapshot, corpus) {
  const definitions = snapshot.elementDefinitions ?? [];
  const elementTypes = definitions.map((definition) => definition.type);
  const themeIds = snapshot.themes.map((theme) => theme.id);
  const inventory = snapshot.validationRun.inventory ?? [];
  const categoryCounts = Object.fromEntries(
    Object.keys(EXPECTED_ELEMENT_CATEGORY_COUNTS).map((category) => [
      category,
      definitions.filter((definition) => definition.category === category)
        .length,
    ]),
  );
  const themeGroupCounts = Object.fromEntries(
    ["dark", "gray", "light"].map((group) => [
      group,
      snapshot.themes.filter((theme) => theme.group === group).length,
    ]),
  );
  const inventoryComplete = inventory.every(
    (item) =>
      item.status === "VERIFIED" &&
      item.requiredStates.length > 0 &&
      item.requiredTests.length > 0 &&
      item.evidence.length > 0,
  );
  return {
    pageTypesExact: exactSet(snapshot.pageTypes, corpus.coverage.pageTypes),
    elementTypesExact: exactSet(elementTypes, corpus.coverage.elementTypes),
    layoutPresetsExact: exactSet(
      snapshot.layoutPresets,
      corpus.coverage.layoutPresets,
    ),
    bindingTypesExact: exactSet(
      snapshot.bindingTypes,
      corpus.coverage.bindingTypes,
    ),
    canonicalThemesPreserved: corpus.coverage.themes.every((theme) =>
      themeIds.includes(theme),
    ),
    themeInventoryExact:
      themeIds.length === 120 &&
      new Set(themeIds).size === 120 &&
      ["dark", "gray", "light"].every(
        (group) => themeGroupCounts[group] === 40,
      ),
    elementCategoriesExact: Object.entries(
      EXPECTED_ELEMENT_CATEGORY_COUNTS,
    ).every(([category, count]) => categoryCounts[category] === count),
    elementContractsComplete: definitions.every(
      (definition) =>
        definition.rendererKey === definition.type &&
        definition.editorRendererKey === definition.type &&
        definition.runtimeRendererKey === definition.type &&
        definition.validatorKey === definition.type &&
        definition.propertySchema.fields.length > 0 &&
        definition.supportedRenderStates.includes("DATA") &&
        definition.layout.minW <= definition.layout.defaultW &&
        definition.layout.defaultW <= definition.layout.maxW &&
        definition.layout.minH <= definition.layout.defaultH &&
        definition.layout.defaultH <= definition.layout.maxH,
    ),
    actionsExact: exactSet(snapshot.actions, EXPECTED_ACTIONS),
    lifecyclesExact: exactSet(snapshot.lifecycles, EXPECTED_LIFECYCLES),
    requirementsExact:
      snapshot.requirements.length === 37 &&
      new Set(snapshot.requirements).size === 37,
    validationRunPass:
      snapshot.validationRun.status === "PASS" &&
      snapshot.validationRun.inventoryRequired === inventory.length &&
      snapshot.validationRun.inventoryVerified === inventory.length &&
      snapshot.validationRun.inventoryVerified ===
        snapshot.validationRun.inventoryRequired,
    validationEvidenceComplete: inventoryComplete,
    validationInventoryExact:
      exactSet(categoryItems(inventory, "PAGE_TYPE"), snapshot.pageTypes) &&
      exactSet(categoryItems(inventory, "ELEMENT"), elementTypes) &&
      exactSet(
        categoryItems(inventory, "LAYOUT_PRESET"),
        snapshot.layoutPresets,
      ) &&
      exactSet(categoryItems(inventory, "BINDING"), snapshot.bindingTypes) &&
      exactSet(categoryItems(inventory, "THEME"), themeIds) &&
      exactSet(categoryItems(inventory, "ACTION"), snapshot.actions) &&
      exactSet(
        categoryItems(inventory, "PROJECT_LIFECYCLE"),
        snapshot.lifecycles,
      ) &&
      exactSet(categoryItems(inventory, "REQUIREMENT"), snapshot.requirements),
    apiRouteInventoryComplete:
      categoryItems(inventory, "API_ROUTE").length >= 80 &&
      categoryItems(inventory, "API_ROUTE").every((route) =>
        /^(?:DELETE|GET|PATCH|POST|PUT) \/api\/v1\//u.test(route),
      ),
    counts: {
      pageTypes: snapshot.pageTypes.length,
      elementTypes: elementTypes.length,
      layoutPresets: snapshot.layoutPresets.length,
      bindingTypes: snapshot.bindingTypes.length,
      themes: themeIds.length,
      actions: snapshot.actions.length,
      lifecycles: snapshot.lifecycles.length,
      requirements: snapshot.requirements.length,
      apiRoutes: categoryItems(inventory, "API_ROUTE").length,
      validationInventory: inventory.length,
    },
    categoryCounts,
    themeGroupCounts,
  };
}

export function inspectPhase19BrowserEvidence(evidence, expectedElements) {
  const palette = evidence?.palette ?? {};
  const manual = evidence?.manualUxReview ?? {};
  const responsive = evidence?.responsive419 ?? {};
  return {
    metadata:
      evidence?.schemaVersion === 1 &&
      evidence?.result === "PASS" &&
      evidence?.target === "actual HTTPS domain" &&
      evidence?.url === "https://webeditor.dove9999.com/" &&
      evidence?.viewport?.width === 1280 &&
      evidence?.viewport?.height === 720,
    inventory:
      evidence?.inventory?.pageTypeCount === 12 &&
      evidence?.inventory?.elementTypeCount === 55 &&
      evidence?.inventory?.layoutPresetCount === 22 &&
      evidence?.inventory?.bindingTypeCount === 11 &&
      evidence?.inventory?.themeCount === 120 &&
      evidence?.inventory?.lifecycleCount === 7,
    palette:
      palette.visibleElementCount === 55 &&
      exactSet(palette.visibleElementTypes ?? [], expectedElements) &&
      Object.entries(EXPECTED_ELEMENT_CATEGORY_COUNTS).every(
        ([category, count]) => palette.categoryCounts?.[category] === count,
      ) &&
      exactSet(palette.newElementTypes ?? [], EXPECTED_NEW_ELEMENT_TYPES) &&
      palette.sameLevelGeometryPreserved === true,
    responsive:
      responsive.viewportWidth === 419 &&
      responsive.documentScrollWidth === 419 &&
      responsive.paletteReachable === true &&
      responsive.inspectorReachable === true,
    manualUx:
      manual.noOccludingResizeSquares === true &&
      manual.elementBodyDragWorks === true &&
      manual.elementPointerStable === true &&
      manual.unboundedVerticalCanvas === true &&
      manual.relationshipEdgePanelConditional === true &&
      manual.relationshipCanvasMaximized === true &&
      manual.relationshipDropLatencyMs >= 0 &&
      manual.relationshipDropLatencyMs <= 100 &&
      manual.backupMenuLeftAligned === true,
    clean:
      evidence?.consoleErrorCount === 0 && evidence?.failedRequestCount === 0,
  };
}

export async function validatePhase19({
  repositoryRoot = REPOSITORY_ROOT,
  includeBrowserEvidence = true,
  includePhase18Regression = true,
  includeGovernance = true,
} = {}) {
  const validation = new Validation(
    "Phase 19 Exhaustive Feature, Element, and Layout Verification",
  );
  const source = await readSources(repositoryRoot);
  const corpus = JSON.parse(source.corpus);
  const snapshot = await loadOperationalInventory(repositoryRoot);
  const inspection = inspectPhase19Inventory(snapshot, corpus);
  for (const [name, value] of Object.entries(inspection)) {
    if (typeof value === "boolean") {
      validation.check(value, `Phase 19 inventory failed: ${name}`);
    }
  }

  validateExactSet(
    validation,
    snapshot.elementDefinitions.map((definition) => definition.type),
    corpus.coverage.elementTypes,
    "Phase 19 Element inventory",
  );
  validation.check(
    snapshot.elementDefinitions.every((definition) =>
      source.webGeometryTest.includes(
        `{ type: "${definition.type}", defaultSizeLabel:`,
      ),
    ),
    "Every Element has an exact geometry inventory assertion",
  );
  validation.check(
    /Object\.keys\(editorRendererByKey\)[\s\S]*ELEMENT_DEFINITIONS/u.test(
      source.webRendererTest,
    ) &&
      /Object\.keys\(runtimeRendererByKey\)[\s\S]*ELEMENT_DEFINITIONS/u.test(
        source.webRendererTest,
      ),
    "Editor and Runtime renderer maps are tested against the full Registry",
  );
  validation.check(
    /ELEMENT_DEFINITIONS\.map\(\(\{ type \}\) => type\)[\s\S]*ELEMENT_TYPES/u.test(
      source.domainContract,
    ),
    "Domain definitions are tested against the exact Element type inventory",
  );
  validation.check(
    /for \(const \[index, definition\] of ELEMENT_DEFINITIONS\.entries\(\)\)/u.test(
      source.serverLayoutTest,
    ),
    "Server layout behavior iterates every Element definition",
  );
  validation.check(
    /inventoryVerified\)\.toBe\(run\.inventoryRequired\)/u.test(
      source.serverInventoryTest,
    ) && /BINDING_TYPES/u.test(source.serverInventoryTest),
    "Validation behavior requires complete inventory and Binding coverage",
  );
  validation.check(
    /120/u.test(source.webThemeTest) &&
      /3_120|6240|6_240/u.test(source.webThemeTest),
    "Theme behavior covers the full 120-theme token projection",
  );

  const completionMarkerOffenders =
    await inspectCompletionMarkers(repositoryRoot);
  validation.check(
    completionMarkerOffenders.length === 0,
    "Production and executable tests contain no skip, TODO, expected-fail, or hack markers",
    { offenders: completionMarkerOffenders },
  );

  let browserInspection = {};
  if (includeBrowserEvidence) {
    try {
      const evidence = JSON.parse(
        await readFile(
          resolve(repositoryRoot, PHASE19_BROWSER_EVIDENCE_PATH),
          "utf8",
        ),
      );
      browserInspection = inspectPhase19BrowserEvidence(
        evidence,
        corpus.coverage.elementTypes,
      );
      for (const [name, value] of Object.entries(browserInspection)) {
        validation.check(value, `Phase 19 browser failed: ${name}`);
      }
    } catch (error) {
      validation.check(false, "Phase 19 browser evidence is missing", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (includeGovernance) {
    const traceability = JSON.parse(source.traceability);
    const requirement = traceability.requirements.find(
      ({ id }) => id === "REQ-031",
    );
    validation.check(
      requirement?.status === "EXHAUSTIVELY VERIFIED" &&
        requirement?.tests.includes("scripts/verify-phase19.mjs") &&
        requirement?.evidence.includes(PHASE19_EVIDENCE_PATH) &&
        requirement?.evidence.includes(PHASE19_BROWSER_EVIDENCE_PATH),
      "REQ-031 Phase 19 traceability is incomplete",
    );
    validation.check(
      /\|\s*19\s*\|\s*EXHAUSTIVELY VERIFIED\s*\|/u.test(source.status) &&
        /## Phase 19 evidence/u.test(source.status) &&
        source.status.includes(PHASE19_EVIDENCE_PATH) &&
        source.status.includes(PHASE19_BROWSER_EVIDENCE_PATH),
      "Phase 19 implementation status is incomplete",
    );
  }

  let phase18Regression = "NOT_RUN";
  if (includePhase18Regression) {
    const previous = await validatePhase18({
      repositoryRoot,
      includeBrowserEvidence: false,
      includePhase17Regression: false,
      includeGovernance: false,
    });
    phase18Regression = previous.result;
    validation.check(previous.result === "PASS", "Phase 18 regression failed", {
      failures: previous.failures,
    });
  }

  return validation.result({
    inspection,
    browserInspection,
    phase18Regression,
    evidencePath: PHASE19_EVIDENCE_PATH,
    browserEvidencePath: PHASE19_BROWSER_EVIDENCE_PATH,
  });
}

if (isMainModule(import.meta.url)) {
  try {
    await finishVerification(PHASE19_EVIDENCE_PATH, await validatePhase19());
  } catch (error) {
    await finishVerification(
      PHASE19_EVIDENCE_PATH,
      unexpectedFailure(
        "Phase 19 Exhaustive Feature, Element, and Layout Verification",
        error,
      ),
    );
  }
}
