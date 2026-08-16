import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  REPOSITORY_ROOT,
  Validation,
  finishVerification,
  isMainModule,
  unexpectedFailure,
} from "./lib/verification.mjs";
import { validatePhase10 } from "./verify-phase10.mjs";

export const PHASE11_EVIDENCE_PATH =
  "artifacts/phase11/safe-read-binding-engine-validation.json";
export const PHASE11_BROWSER_EVIDENCE_PATH =
  "artifacts/phase11/browser-safe-read-binding-validation.json";

export const CANONICAL_PHASE11_ROUTES = Object.freeze([
  ["POST", "/api/v1/projects/:projectId/binding-query-previews"],
  ["POST", "/api/v1/bindings/:bindingId/preview"],
  ["POST", "/api/v1/runtime/:projectId/query/:bindingId"],
  ["POST", "/api/v1/projects/:projectId/sample-data/generate"],
  ["POST", "/api/v1/projects/:projectId/sample-data/reset"],
]);

const FILES = Object.freeze({
  domain: "packages/domain/src/binding-query.ts",
  relationshipDomain: "packages/domain/src/data-relationship.ts",
  migration: "apps/server/src/metadata/database.ts",
  app: "apps/server/src/app.ts",
  webApp: "apps/web/src/App.tsx",
  routes: "apps/server/src/routes/data-relationship.ts",
  sampleRoutes: "apps/server/src/routes/sample-data.ts",
  compiler: "apps/server/src/data-relationship/binding-query-compiler.ts",
  service: "apps/server/src/data-relationship/relationship-service.ts",
  sampleService: "apps/server/src/data-relationship/sample-data-service.ts",
  backendTest: "apps/server/test/integration/safe-read-binding-engine.test.ts",
  frontend: "apps/web/src/features/data-relationship/RelationshipCanvas.tsx",
  frontendApi: "apps/web/src/services/data-relationship-api.ts",
  dataApi: "apps/web/src/services/data-schema-api.ts",
  workspace: "apps/web/src/features/elements/ElementWorkspace.tsx",
  canvas: "apps/web/src/features/elements/ElementCanvas.tsx",
  renderer: "apps/web/src/features/elements/ElementRenderer.tsx",
  frontendTest:
    "apps/web/src/features/data-relationship/RelationshipCanvas.test.tsx",
  canvasTest: "apps/web/src/features/elements/ElementCanvas.test.tsx",
  styles: "apps/web/src/styles.css",
  adr: "docs/adr/0012-safe-read-binding-engine.md",
  traceability: "docs/requirement-traceability.json",
});

function quotedArray(source, name) {
  const match = source.match(
    new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\] as const`, "u"),
  );
  return match
    ? [...match[1].matchAll(/["']([^"']+)["']/gu)].map((m) => m[1])
    : [];
}

function exactArray(actual, expected) {
  return (
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

function routePresent(source, method, path) {
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(
    `server\\.${method.toLowerCase()}(?:<[^>]+>)?\\(\\s*["']${escaped}["']`,
    "u",
  ).test(source);
}

function validRect(rect) {
  return (
    rect &&
    ["x", "y", "width", "height"].every((key) => Number.isFinite(rect[key])) &&
    rect.width > 0 &&
    rect.height > 0
  );
}

function equalRects(rects) {
  return (
    Array.isArray(rects) &&
    rects.length >= 2 &&
    rects.every(validRect) &&
    rects.every(
      (rect) =>
        Math.abs(rect.width - rects[0].width) <= 0.02 &&
        Math.abs(rect.height - rects[0].height) <= 0.02,
    )
  );
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

export function inspectPhase11Contract(sources) {
  const routeSources = `${sources.routes}\n${sources.sampleRoutes}`;
  const migration = sources.migration.slice(
    sources.migration.indexOf("const safeReadBindingEngineSchemaSql"),
  );
  return {
    queryModesExact: exactArray(
      quotedArray(sources.domain, "READ_QUERY_MODES"),
      ["LIST", "SINGLE", "AGGREGATE", "CHART_SERIES"],
    ),
    filterOperatorsExact: exactArray(
      quotedArray(sources.domain, "READ_FILTER_OPERATORS"),
      [
        "EQ",
        "NE",
        "GT",
        "GTE",
        "LT",
        "LTE",
        "CONTAINS",
        "STARTS_WITH",
        "IS_NULL",
        "IS_NOT_NULL",
      ],
    ),
    aggregateFunctionsExact: exactArray(
      quotedArray(sources.domain, "READ_AGGREGATE_FUNCTIONS"),
      ["COUNT", "SUM", "AVG", "MIN", "MAX", "MEDIAN", "STDDEV", "VARIANCE"],
    ),
    renderShapesExact: exactArray(
      quotedArray(sources.domain, "BINDING_RENDER_SHAPES"),
      ["ROWS", "SCALAR", "SERIES", "VALUES", "SCATTER", "BOXES", "SUMMARY"],
    ),
    schemaVersionTen:
      /LATEST_METADATA_SCHEMA_VERSION\s*=\s*(?:1\d|[2-9]\d|[1-9]\d{2,})/u.test(
        sources.migration,
      ) &&
      /name:\s*["']safe-read-binding-engine["'][\s\S]{0,180}version:\s*10/u.test(
        sources.migration,
      ),
    durableEvidenceTables:
      /CREATE TABLE binding_query_runs/u.test(migration) &&
      /CREATE TABLE sample_data_commands/u.test(migration) &&
      /UNIQUE\(project_id, idempotency_key\)/u.test(migration) &&
      /environment IN \('test', 'production'\)/u.test(migration),
    canonicalRoutes: CANONICAL_PHASE11_ROUTES.every(([method, path]) =>
      routePresent(routeSources, method, path),
    ),
    serverRegistered:
      /registerSampleDataRoutes/u.test(sources.app) &&
      /sampleDataService/u.test(sources.app),
    noClientSqlSurface:
      /exactObject/u.test(sources.compiler) &&
      /UNKNOWN_BINDING_QUERY_FIELD/u.test(sources.compiler) &&
      !/\b(?:rawSql|clientSql|sqlText)\b/u.test(sources.domain) &&
      /exactBody\(request\.body, \[[\s\S]*"connectionPreviewId"[\s\S]*"spec"[\s\S]*"mapping"/u.test(
        sources.routes,
      ),
    physicalIdentifierBoundary:
      /\^t_\[0-9a-f\]\{32\}\$/u.test(sources.compiler) &&
      /\^c_\[0-9a-f\]\{32\}\$/u.test(sources.compiler) &&
      /parameters/u.test(sources.compiler) &&
      /\.all\(\.\.\.compiled\.parameters\)/u.test(sources.compiler),
    readOnlyBoundedExecution:
      /query_only = ON/u.test(sources.compiler) &&
      /trusted_schema = OFF/u.test(sources.compiler) &&
      /Limit must be between 1 and 500/u.test(sources.compiler) &&
      /raw\.slice\(0, compiled\.query\.spec\.limit\)/u.test(sources.compiler),
    serverOwnedQueryPreview:
      /#queryPreviews = new Map/u.test(sources.service) &&
      /while \(this\.#queryPreviews\.size > 128\)/u.test(sources.service) &&
      /#consumeQueryPreview/u.test(sources.service) &&
      /15_000/u.test(sources.service) &&
      /queryPreviewId/u.test(sources.routes),
    endpointAndOwnershipBinding:
      /BINDING_QUERY_SOURCE_MISMATCH/u.test(sources.compiler) &&
      /BINDING_MAPPING_TARGET_MISMATCH/u.test(sources.compiler) &&
      /expectedProjectId === undefined \|\| row\.project_id === expectedProjectId/u.test(
        sources.service,
      ),
    testProductionIsolation:
      /environment: "test" \| "production"/u.test(sources.domain) &&
      /executeBindingPreview/u.test(sources.routes) &&
      /executeRuntimeBinding/u.test(sources.routes) &&
      /RUNTIME_SCHEMA_NOT_APPLIED/u.test(sources.compiler),
    crashSafeSampleCommands:
      /response_status = 202/u.test(sources.sampleService) &&
      /SAMPLE_DATA_COMMAND_PENDING/u.test(sources.sampleService) &&
      /SAMPLE_DATA_RECOVERY_REQUIRED/u.test(sources.sampleService) &&
      /recovering && matches\(current, pending\.expected\)/u.test(
        sources.sampleService,
      ) &&
      /response_status = 200/u.test(sources.sampleService) &&
      /sameCountRegeneration/u.test(sources.backendTest) &&
      /WHERE "\$\{valueField\?\.physicalName\}" = -999/u.test(
        sources.backendTest,
      ) &&
      /trusted_schema = OFF/u.test(sources.sampleService),
    wizardQueryPreview:
      /binding-query-mode/u.test(sources.frontend) &&
      /binding-query-limit/u.test(sources.frontend) &&
      /generateSampleData/u.test(sources.frontend) &&
      /previewQuery/u.test(sources.frontend) &&
      /queryPreviewId/u.test(sources.frontend) &&
      /data-plan-checksum/u.test(sources.frontend),
    equalSiblingActions:
      /binding-query-actions/u.test(sources.styles) &&
      /grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/u.test(
        sources.styles,
      ),
    realElementProjection:
      /bindingResults/u.test(sources.workspace) &&
      /executePreview/u.test(sources.workspace) &&
      /bindingExecutionActive,[\s\S]{0,120}entryIdentity,[\s\S]{0,120}pageId,[\s\S]{0,120}projectId,[\s\S]{0,120}projectRevision/u.test(
        sources.workspace,
      ) &&
      /bindingExecutionActive=\{step === "page"\}/u.test(sources.webApp) &&
      /bindingResult/u.test(sources.canvas) &&
      /renderData/u.test(sources.renderer) &&
      /renderState/u.test(sources.renderer),
    statisticalChartFillsElement:
      /\.element-render-surface\s*\{[\s\S]{0,160}display:\s*flex/u.test(
        sources.styles,
      ) &&
      /\.element-renderer\s*\{[\s\S]{0,180}width:\s*100%[\s\S]{0,80}height:\s*100%/u.test(
        sources.styles,
      ) &&
      /\.statistical-chart-container\s*\{[\s\S]{0,80}aspect-ratio:\s*auto/u.test(
        sources.styles,
      ),
    backendBehavior:
      /deterministic Test rows/u.test(sources.backendTest) &&
      /bound FILTER\/SORT\/LIST/u.test(sources.backendTest) &&
      /Histogram values/u.test(sources.backendTest) &&
      /rejects raw SQL/u.test(sources.backendTest) &&
      /expires the server-owned query candidate/u.test(sources.backendTest),
    frontendBehavior:
      /exact server preview/u.test(sources.frontendTest) &&
      /sample-data\/generate/u.test(sources.frontendTest) &&
      /not\.toHaveProperty\("sql"\)/u.test(sources.frontendTest) &&
      /Test DB READ results in Table and Histogram/u.test(sources.canvasTest) &&
      /refreshes READ results when returning to Canvas and after a Project revision change/u.test(
        sources.canvasTest,
      ),
    adrBoundary:
      /No permanent[\s\S]*Binding or Edge exists/u.test(sources.adr) &&
      /500-row hard ceiling/u.test(sources.adr) &&
      /Test-only/u.test(sources.adr) &&
      /never opens Production/u.test(sources.adr),
  };
}

export function inspectPhase11BrowserEvidence(evidence) {
  const flow = evidence?.readFlow;
  return {
    result: evidence?.result === "PASS",
    isolated:
      evidence?.target === "isolated local browser session" &&
      /^http:\/\/127\.0\.0\.1:\d+\/$/u.test(evidence?.url ?? ""),
    viewport:
      evidence?.viewport?.width === 1280 && evidence?.viewport?.height === 720,
    equalQueryActions: equalRects(evidence?.geometry?.queryActionRects),
    equalDialogActions: equalRects(evidence?.geometry?.dialogActionRects),
    realSamplePreview:
      flow?.sampleRowCount > 0 &&
      flow?.previewRowCount > 0 &&
      /^[0-9a-f]{64}$/u.test(flow?.planChecksum ?? ""),
    exactBinding:
      typeof flow?.bindingId === "string" &&
      flow.bindingId.length > 0 &&
      flow?.edgeBindingId === flow.bindingId,
    renderedResults:
      flow?.tableRenderedRows > 0 &&
      flow?.histogramRenderedMarks > 0 &&
      flow?.frontendFixtureDataUsed === false,
    safety:
      flow?.requestContainedSql === false &&
      flow?.productionChecksumBefore === flow?.productionChecksumAfter,
    responsive:
      evidence?.responsive419?.viewportWidth === 419 &&
      evidence?.responsive419?.documentScrollWidth === 419 &&
      evidence?.responsive419?.wizardReachable === true &&
      evidence?.responsive419?.siblingGeometryPreserved === true,
    cleanRuntime:
      evidence?.consoleErrorCount === 0 && evidence?.failedRequestCount === 0,
  };
}

async function readBrowserEvidence(repositoryRoot) {
  try {
    return JSON.parse(
      await readFile(
        resolve(repositoryRoot, PHASE11_BROWSER_EVIDENCE_PATH),
        "utf8",
      ),
    );
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

export async function validatePhase11({
  repositoryRoot = REPOSITORY_ROOT,
  includeBrowserEvidence = true,
  includeGovernance = true,
  includePhase10Regression = true,
} = {}) {
  const validation = new Validation("Phase 11 Safe READ Binding Engine");
  const sources = await readSources(repositoryRoot);
  const inspection = inspectPhase11Contract(sources);
  for (const [name, value] of Object.entries(inspection)) {
    validation.check(value === true, `Phase 11 contract failed: ${name}`, {
      value,
    });
  }

  let browserInspection = { result: "NOT_RUN" };
  if (includeBrowserEvidence) {
    browserInspection = inspectPhase11BrowserEvidence(
      await readBrowserEvidence(repositoryRoot),
    );
    for (const [name, value] of Object.entries(browserInspection)) {
      validation.check(
        value === true,
        `Phase 11 browser evidence failed: ${name}`,
        { value },
      );
    }
  }

  let governance = { result: "NOT_RUN" };
  if (includeGovernance) {
    const traceability = JSON.parse(sources.traceability);
    const requirement = traceability.requirements?.find(
      (entry) => entry.id === "REQ-018",
    );
    governance = {
      status: requirement?.status === "VERIFIED",
      implementation:
        requirement?.implementation?.includes(FILES.adr) &&
        requirement?.implementation?.includes(FILES.compiler) &&
        requirement?.implementation?.includes(FILES.frontend),
      tests:
        requirement?.tests?.includes(FILES.backendTest) &&
        requirement?.tests?.includes(FILES.canvasTest) &&
        requirement?.tests?.includes("scripts/verify-phase11.mjs"),
      evidence:
        requirement?.evidence?.includes(PHASE11_EVIDENCE_PATH) &&
        requirement?.evidence?.includes(PHASE11_BROWSER_EVIDENCE_PATH),
    };
    for (const [name, value] of Object.entries(governance)) {
      validation.check(value === true, `Phase 11 governance failed: ${name}`, {
        value,
      });
    }
  }

  let phase10Regression = { result: "NOT_RUN", failures: [] };
  if (includePhase10Regression) {
    phase10Regression = await validatePhase10({ repositoryRoot });
    validation.check(
      phase10Regression.result === "PASS",
      "Phase 0–10 regression must remain green",
      { failures: phase10Regression.failures },
    );
  }

  return validation.result({
    inspection,
    browserInspection,
    governance,
    phase10Regression: phase10Regression.result,
    browserEvidencePath: PHASE11_BROWSER_EVIDENCE_PATH,
  });
}

if (isMainModule(import.meta.url)) {
  try {
    await finishVerification(PHASE11_EVIDENCE_PATH, await validatePhase11());
  } catch (error) {
    await finishVerification(
      PHASE11_EVIDENCE_PATH,
      unexpectedFailure("Phase 11 Safe READ Binding Engine", error),
    );
  }
}
