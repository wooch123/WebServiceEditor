import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  REPOSITORY_ROOT,
  Validation,
  finishVerification,
  isMainModule,
  unexpectedFailure,
} from "./lib/verification.mjs";
import { validatePhase8 } from "./verify-phase8.mjs";

export const PHASE9_EVIDENCE_PATH =
  "artifacts/phase9/data-relationship-canvas-validation.json";
export const PHASE9_BROWSER_EVIDENCE_PATH =
  "artifacts/phase9/browser-data-relationship-validation.json";

export const REQUIRED_RELATIONSHIP_NODE_TYPES = Object.freeze([
  "page",
  "element",
  "table",
]);
export const REQUIRED_RELATIONSHIP_BINDING_TYPES = Object.freeze([
  "CONTAINS",
  "READ",
  "CREATE",
  "UPDATE",
  "DELETE",
  "FILTER",
  "NAVIGATE",
  "RELATION",
]);
export const CANONICAL_PHASE9_ROUTES = Object.freeze([
  ["GET", "/api/v1/projects/:projectId/relationship-graph"],
  ["GET", "/api/v1/projects/:projectId/bindings"],
  ["POST", "/api/v1/projects/:projectId/connections/preview"],
  ["POST", "/api/v1/projects/:projectId/bindings"],
  ["PATCH", "/api/v1/bindings/:bindingId"],
  ["DELETE", "/api/v1/bindings/:bindingId"],
  ["GET", "/api/v1/projects/:projectId/binding-history"],
  ["POST", "/api/v1/projects/:projectId/binding-history/undo"],
  ["POST", "/api/v1/projects/:projectId/binding-history/redo"],
]);

const FILES = Object.freeze({
  domain: "packages/domain/src/data-relationship.ts",
  domainTest: "packages/domain/test/data-relationship-contract.test.ts",
  migration: "apps/server/src/metadata/database.ts",
  routes: "apps/server/src/routes/data-relationship.ts",
  repository: "apps/server/src/data-relationship/relationship-repository.ts",
  service: "apps/server/src/data-relationship/relationship-service.ts",
  projectService: "apps/server/src/projects/project-service.ts",
  backendTest: "apps/server/test/integration/data-relationship-canvas.test.ts",
  metadataTest: "apps/server/test/unit/metadata-database.test.ts",
  frontend: "apps/web/src/features/data-relationship/RelationshipCanvas.tsx",
  frontendApi: "apps/web/src/services/data-relationship-api.ts",
  frontendTest:
    "apps/web/src/features/data-relationship/RelationshipCanvas.test.tsx",
  app: "apps/web/src/App.tsx",
  styles: "apps/web/src/styles.css",
  adr: "docs/adr/0010-data-relationship-canvas.md",
  traceability: "docs/requirement-traceability.json",
});

function quotedArray(source, name) {
  const match = source.match(
    new RegExp(
      `export\\s+const\\s+${name}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*as\\s+const`,
      "u",
    ),
  );
  return match
    ? [...match[1].matchAll(/["']([^"']+)["']/gu)].map((item) => item[1])
    : [];
}

function exactArray(left, right) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
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

function routePresent(source, method, path) {
  if (path.endsWith("/undo") || path.endsWith("/redo")) {
    const operation = path.endsWith("/undo") ? "undo" : "redo";
    return (
      source.includes('["undo", "redo"] as const') &&
      source.includes("binding-history/${operation}") &&
      source.includes(operation)
    );
  }
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(
    `server\\.${method.toLowerCase()}(?:<[^>]+>)?\\(\\s*["']${escaped}["']`,
    "u",
  ).test(source);
}

export function inspectPhase9Contract(sources) {
  const migration = sources.migration.slice(
    sources.migration.indexOf("const dataRelationshipCanvasSchemaSql"),
  );
  const createRouteStart = sources.routes.indexOf(
    '"/api/v1/projects/:projectId/bindings"',
    sources.routes.indexOf('"/api/v1/projects/:projectId/connections/preview"'),
  );
  const createRoute = sources.routes.slice(
    createRouteStart,
    sources.routes.indexOf('"/api/v1/bindings/:bindingId"'),
  );
  return {
    nodeTypesExact: exactArray(
      quotedArray(sources.domain, "RELATIONSHIP_NODE_TYPES"),
      REQUIRED_RELATIONSHIP_NODE_TYPES,
    ),
    bindingTypesExact: exactArray(
      quotedArray(sources.domain, "RELATIONSHIP_BINDING_TYPES"),
      REQUIRED_RELATIONSHIP_BINDING_TYPES,
    ),
    bindingStatusExact: exactArray(
      quotedArray(sources.domain, "RELATIONSHIP_BINDING_STATUSES"),
      ["READY", "DISABLED"],
    ),
    visualEdgeIsBinding:
      /Visual edges are the canonical Binding records/u.test(sources.domain) &&
      /(?:const\s+edges\s*=|edges:)\s*renderableBindings\.map\(\(binding\)\s*=>[\s\S]{0,160}this\.repository\.toDto\(binding\)/u.test(
        sources.service,
      ),
    routesExact: CANONICAL_PHASE9_ROUTES.every(([method, path]) =>
      routePresent(sources.routes, method, path),
    ),
    exactCreateAllowlist:
      /"previewId"[\s\S]*"bindingType"[\s\S]*\.\.\.graphRevisions[\s\S]*"idempotencyKey"/u.test(
        createRoute,
      ) && !/sourcePortId|targetPortId|query|mapping/u.test(createRoute),
    schemaVersionEight:
      /LATEST_METADATA_SCHEMA_VERSION\s*=\s*(?:[89]|[1-9]\d+)/u.test(
        sources.migration,
      ) &&
      /name:\s*["']data-relationship-canvas["'][\s\S]{0,160}version:\s*8/u.test(
        sources.migration,
      ),
    schemaTables:
      /CREATE TABLE project_binding_states/u.test(migration) &&
      /CREATE TABLE bindings/u.test(migration) &&
      /CREATE TABLE binding_commands/u.test(migration) &&
      /CREATE TABLE binding_history_operations/u.test(migration),
    sqlitePortDirection:
      /source_side = 'right'/u.test(migration) &&
      /source_direction = 'output'/u.test(migration) &&
      /target_side = 'left'/u.test(migration) &&
      /target_direction = 'input'/u.test(migration),
    sqliteOwnershipAndUniqueness:
      /REFERENCES projects\(id\) ON DELETE CASCADE/u.test(migration) &&
      /bindings_active_endpoints_idx/u.test(migration) &&
      /source_port_id, target_port_id/u.test(migration) &&
      /UNIQUE\(project_id, idempotency_key\)/u.test(migration),
    serverOwnedPreview:
      /#previews = new Map/u.test(sources.service) &&
      /15_000/u.test(sources.service) &&
      /while \(this\.#previews\.size > 512\)/u.test(sources.service) &&
      /#consumePreview/u.test(sources.service) &&
      /CONNECTION_PREVIEW_STALE/u.test(sources.service),
    compatibilityRules:
      /function bindingRulesAllow/u.test(sources.service) &&
      /SOURCE_MUST_BE_RIGHT_OUTPUT/u.test(sources.service) &&
      /TARGET_MUST_BE_LEFT_INPUT/u.test(sources.service) &&
      /SCHEMA_RELATION_REQUIRED/u.test(sources.service),
    noExecutableConfiguration:
      /sql|rawsql|javascript|script|code/u.test(sources.service) &&
      /INVALID_BINDING_CONFIGURATION/u.test(sources.service),
    softDeleteAndOrphanBoundary:
      /endpointObjectState/u.test(sources.repository) &&
      /sourceState !== "inactive"/u.test(sources.service) &&
      /BINDING_TOPOLOGY_INVALID/u.test(sources.service),
    lifecycleRemap:
      /relationshipRepository\.exportDefinition/u.test(
        sources.projectService,
      ) &&
      /relationshipRepository\.insertImportedDefinition/u.test(
        sources.projectService,
      ) &&
      /relationshipRepository\.deleteOwnedDefinitions/u.test(
        sources.projectService,
      ) &&
      /remapConfiguration/u.test(sources.repository) &&
      /field-\$\{objectId\}/u.test(sources.repository),
    frontendSeparateView:
      /value="schema"/u.test(sources.app) &&
      /value="relationship"/u.test(sources.app) &&
      /<RelationshipCanvas/u.test(sources.app),
    frontendGraphProjection:
      /graph\.nodes\.map/u.test(sources.frontend) &&
      /graph\.edges\.(?:map|flatMap)/u.test(sources.frontend) &&
      /markerEnd(?::|=)[\s\S]{0,100}(?:ArrowClosed|relationship-arrow)/u.test(
        sources.frontend,
      ) &&
      /binding\.bindingType/u.test(sources.frontend),
    frontendPortInteraction:
      /onPointerDown/u.test(sources.frontend) &&
      /onPointerUp/u.test(sources.frontend) &&
      /dataRelationshipApi\.preview/u.test(sources.frontend) &&
      /dataRelationshipApi\.create/u.test(sources.frontend) &&
      /preview\([\s\S]*connections\/preview/u.test(sources.frontendApi),
    frontendHistory:
      /dataRelationshipApi\.delete/u.test(sources.frontend) &&
      /dataRelationshipApi\.historyMutation/u.test(sources.frontend) &&
      /(?:실행|연결) 취소/u.test(sources.frontend) &&
      /(?:다시 실행|연결 다시)/u.test(sources.frontend),
    siblingGeometry:
      /relationship-toolbar-actions/u.test(sources.frontend) &&
      /relationship-dialog-actions/u.test(sources.frontend) &&
      /grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/u.test(
        sources.styles,
      ),
    domainBehavior:
      /Phase 9 node, Binding, status, and history inventories exact/u.test(
        sources.domainTest,
      ),
    sqliteBehavior:
      /rejects reversed or duplicate active Binding endpoints/u.test(
        sources.metadataTest,
      ),
    backendBehavior:
      /strict left-input\/right-output ports/u.test(sources.backendTest) &&
      /one READ Binding\/visual Edge/u.test(sources.backendTest) &&
      /deletes, undoes, redoes/u.test(sources.backendTest) &&
      /soft-deleted[\s\S]*orphaned port/u.test(sources.backendTest) &&
      /remaps Binding ownership/u.test(sources.backendTest),
    frontendBehavior:
      /strict side\/direction ports/u.test(sources.frontendTest) &&
      /visual Edge only from the exact server preview/u.test(
        sources.frontendTest,
      ) &&
      /deletes the selected Edge[\s\S]*durable history boundary/u.test(
        sources.frontendTest,
      ),
    adrBoundary:
      /visual connection must be exactly one durable Binding record/u.test(
        sources.adr,
      ) &&
      /Phase 10/u.test(sources.adr) &&
      /Phase 11/u.test(sources.adr),
  };
}

export function inspectPhase9BrowserEvidence(evidence) {
  const graph = evidence?.graph;
  const connection = evidence?.connection;
  const history = evidence?.history;
  const responsive = evidence?.responsive419;
  return {
    result: evidence?.result === "PASS",
    target: evidence?.target === "isolated local browser session",
    viewport:
      evidence?.viewport?.width === 1280 && evidence?.viewport?.height === 720,
    nodeInventory:
      exactArray(graph?.nodeTypes ?? [], REQUIRED_RELATIONSHIP_NODE_TYPES) &&
      graph?.nodeCount >= 3,
    portSides:
      graph?.inputPortCount > 0 &&
      graph?.outputPortCount > 0 &&
      graph?.allInputsLeft === true &&
      graph?.allOutputsRight === true,
    previewCommitExact:
      connection?.compatible === true &&
      connection?.bindingCountBefore === 0 &&
      connection?.bindingCountAfter === 1 &&
      connection?.visualEdgeCount === 1 &&
      connection?.visualEdgeBindingId === connection?.bindingId &&
      connection?.arrowVisible === true &&
      connection?.labelVisible === true,
    forbiddenNoWrite:
      connection?.forbiddenCompatible === false &&
      connection?.bindingCountAfterForbidden === connection?.bindingCountAfter,
    history:
      history?.afterDelete === 0 &&
      history?.afterUndo === 1 &&
      history?.afterRedo === 0 &&
      history?.stableBindingId === true,
    equalToolbar: equalRects(evidence?.geometry?.toolbarActionRects),
    equalDialog: equalRects(evidence?.geometry?.dialogActionRects),
    equalMode: equalRects(evidence?.geometry?.modeControlRects),
    responsive:
      responsive?.viewportWidth === 419 &&
      responsive?.documentScrollWidth === 419 &&
      responsive?.graphReachable === true &&
      responsive?.controlsReachable === true &&
      responsive?.siblingGeometryPreserved === true,
    cleanRuntime:
      evidence?.consoleErrorCount === 0 && evidence?.failedRequestCount === 0,
  };
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

async function readBrowserEvidence(repositoryRoot) {
  try {
    return JSON.parse(
      await readFile(
        resolve(repositoryRoot, PHASE9_BROWSER_EVIDENCE_PATH),
        "utf8",
      ),
    );
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

export async function validatePhase9({
  repositoryRoot = REPOSITORY_ROOT,
  includeBrowserEvidence = true,
  includeGovernance = true,
  includePhase8Regression = true,
} = {}) {
  const validation = new Validation("Phase 9 Data Relationship Canvas");
  const sources = await readSources(repositoryRoot);
  const inspection = inspectPhase9Contract(sources);
  for (const [name, value] of Object.entries(inspection)) {
    validation.check(value === true, `Phase 9 contract failed: ${name}`, {
      value,
    });
  }

  let browserInspection = { result: "NOT_RUN" };
  if (includeBrowserEvidence) {
    browserInspection = inspectPhase9BrowserEvidence(
      await readBrowserEvidence(repositoryRoot),
    );
    for (const [name, value] of Object.entries(browserInspection)) {
      validation.check(
        value === true,
        `Phase 9 browser evidence failed: ${name}`,
        { value },
      );
    }
  }

  let governance = { result: "NOT_RUN" };
  if (includeGovernance) {
    const traceability = JSON.parse(sources.traceability);
    const requirement = traceability.requirements?.find(
      ({ id }) => id === "REQ-016",
    );
    governance = {
      status: requirement?.status === "VERIFIED",
      implementation:
        requirement?.implementation?.includes(FILES.adr) &&
        requirement?.implementation?.includes(FILES.frontend),
      tests:
        requirement?.tests?.includes(
          "apps/server/test/integration/data-relationship-canvas.test.ts",
        ) && requirement?.tests?.includes("scripts/verify-phase9.mjs"),
      evidence:
        requirement?.evidence?.includes(PHASE9_EVIDENCE_PATH) &&
        requirement?.evidence?.includes(PHASE9_BROWSER_EVIDENCE_PATH),
    };
    for (const [name, value] of Object.entries(governance)) {
      validation.check(value === true, `Phase 9 governance failed: ${name}`, {
        value,
      });
    }
  }

  let phase8Regression = { result: "NOT_RUN", failures: [] };
  if (includePhase8Regression) {
    phase8Regression = await validatePhase8({ repositoryRoot });
    validation.check(
      phase8Regression.result === "PASS",
      "Phase 0–8 regression must remain green",
      { failures: phase8Regression.failures },
    );
  }

  return validation.result({
    inspection,
    browserInspection,
    governance,
    phase8Regression: phase8Regression.result,
    browserEvidencePath: PHASE9_BROWSER_EVIDENCE_PATH,
  });
}

if (isMainModule(import.meta.url)) {
  try {
    await finishVerification(PHASE9_EVIDENCE_PATH, await validatePhase9());
  } catch (error) {
    await finishVerification(
      PHASE9_EVIDENCE_PATH,
      unexpectedFailure("Phase 9 Data Relationship Canvas", error),
    );
  }
}
