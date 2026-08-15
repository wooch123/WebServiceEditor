import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  REPOSITORY_ROOT,
  Validation,
  finishVerification,
  isMainModule,
  unexpectedFailure,
} from "./lib/verification.mjs";
import { validatePhase9 } from "./verify-phase9.mjs";

export const PHASE10_EVIDENCE_PATH =
  "artifacts/phase10/orthogonal-auto-layout-validation.json";
export const PHASE10_BROWSER_EVIDENCE_PATH =
  "artifacts/phase10/browser-orthogonal-auto-layout-validation.json";

export const CANONICAL_PHASE10_ROUTES = Object.freeze([
  ["PATCH", "/api/v1/projects/:projectId/relationship-nodes/:nodeId"],
  ["PATCH", "/api/v1/projects/:projectId/relationship-viewport"],
  ["POST", "/api/v1/projects/:projectId/edges/route-preview"],
  ["POST", "/api/v1/projects/:projectId/auto-layout"],
  ["GET", "/api/v1/projects/:projectId/relationship-layout-history"],
  ["POST", "/api/v1/projects/:projectId/relationship-layout-history/undo"],
  ["POST", "/api/v1/projects/:projectId/relationship-layout-history/redo"],
]);

const FILES = Object.freeze({
  domain: "packages/domain/src/data-relationship.ts",
  migration: "apps/server/src/metadata/database.ts",
  routes: "apps/server/src/routes/data-relationship.ts",
  repository:
    "apps/server/src/data-relationship/relationship-layout-repository.ts",
  relationshipRepository:
    "apps/server/src/data-relationship/relationship-repository.ts",
  service: "apps/server/src/data-relationship/relationship-service.ts",
  router: "apps/server/src/data-relationship/relationship-router.ts",
  autoLayout: "apps/server/src/data-relationship/relationship-auto-layout.ts",
  serverPackage: "apps/server/package.json",
  backendTest: "apps/server/test/integration/data-relationship-canvas.test.ts",
  routerTest: "apps/server/test/unit/relationship-router.test.ts",
  frontend: "apps/web/src/features/data-relationship/RelationshipCanvas.tsx",
  frontendApi: "apps/web/src/services/data-relationship-api.ts",
  frontendTest:
    "apps/web/src/features/data-relationship/RelationshipCanvas.test.tsx",
  styles: "apps/web/src/styles.css",
  webPackage: "apps/web/package.json",
  adr: "docs/adr/0011-orthogonal-routing-and-auto-layout.md",
  traceability: "docs/requirement-traceability.json",
});

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
      source.includes("relationship-layout-history/${operation}") &&
      source.includes(operation)
    );
  }
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(
    `server\\.${method.toLowerCase()}(?:<[^>]+>)?\\(\\s*["']${escaped}["']`,
    "u",
  ).test(source);
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

export function inspectPhase10Contract(sources) {
  const migration = sources.migration.slice(
    sources.migration.indexOf("const relationshipLayoutRoutingSchemaSql"),
  );
  return {
    schemaVersionNine:
      /LATEST_METADATA_SCHEMA_VERSION\s*=\s*(?:9|[1-9]\d+)/u.test(
        sources.migration,
      ) &&
      /name:\s*["']relationship-layout-routing["'][\s\S]{0,180}version:\s*9/u.test(
        sources.migration,
      ),
    durableLayoutTables:
      /CREATE TABLE relationship_node_positions/u.test(migration) &&
      /CREATE TABLE project_relationship_viewports/u.test(migration) &&
      /CREATE TABLE relationship_layout_commands/u.test(migration) &&
      /CREATE TABLE relationship_layout_history_operations/u.test(migration) &&
      /UNIQUE\(project_id, idempotency_key\)/u.test(migration),
    canonicalRoutes: CANONICAL_PHASE10_ROUTES.every(([method, path]) =>
      routePresent(sources.routes, method, path),
    ),
    pinnedDependencies:
      /"@xyflow\/react":\s*"12\.11\.3"/u.test(sources.webPackage) &&
      /"elkjs":\s*"0\.12\.0"/u.test(sources.serverPackage),
    serverOwnedOrthogonalRouter:
      /const CLEARANCE = 12/u.test(sources.router) &&
      /const SOURCE_STUB = 16/u.test(sources.router) &&
      /const TARGET_STUB = 16/u.test(sources.router) &&
      /routeGrid/u.test(sources.router) &&
      /routeCrossesNode/u.test(sources.router) &&
      /Orthogonal route crosses a Node/u.test(sources.router),
    serverOwnedRoutePreview:
      /routePreview\(/u.test(sources.service) &&
      /routeRelationshipEdges/u.test(sources.service) &&
      /expectedGraphRevision/u.test(sources.service) &&
      /expectedProjectRevision/u.test(sources.service),
    elkLayeredContract:
      /"elk\.algorithm": "layered"/u.test(sources.autoLayout) &&
      /"elk\.direction": "RIGHT"/u.test(sources.autoLayout) &&
      /"elk\.edgeRouting": "ORTHOGONAL"/u.test(sources.autoLayout) &&
      /"elk\.portConstraints": "FIXED_ORDER"/u.test(sources.autoLayout) &&
      /"WEST" : "EAST"/u.test(sources.autoLayout),
    noOverlapAndPinned:
      /relationshipNodeOverlapCount/u.test(sources.autoLayout) &&
      /node\.pinned\s*\?\s*node/u.test(sources.autoLayout) &&
      /Pinned Nodes overlap after Auto Layout/u.test(sources.autoLayout),
    serverOwnedPreviewApply:
      /#autoLayoutPreviews = new Map/u.test(sources.service) &&
      /15_000/u.test(sources.service) &&
      /while \(this\.#autoLayoutPreviews\.size > 128\)/u.test(
        sources.service,
      ) &&
      /#consumeAutoLayoutPreview/u.test(sources.service) &&
      /AUTO_LAYOUT_PREVIEW_STALE/u.test(sources.service),
    atomicHistory:
      /"MOVE_NODE" \| "AUTO_LAYOUT"/u.test(sources.repository) &&
      /discardRedo/u.test(sources.repository) &&
      /relationship-layout-history/u.test(sources.routes) &&
      /applyPositionSnapshot/u.test(sources.repository),
    lifecycleOwnership:
      /layoutRepository\.definitionState/u.test(
        sources.relationshipRepository,
      ) &&
      /insertImportedPosition/u.test(sources.relationshipRepository) &&
      /insertImportedViewport/u.test(sources.relationshipRepository) &&
      /layoutRepository\.deleteOwnedDefinitions/u.test(
        sources.relationshipRepository,
      ),
    reactFlowProjection:
      /<ReactFlow/u.test(sources.frontend) &&
      /<Handle/u.test(sources.frontend) &&
      /ConnectionLineType\.Straight/u.test(sources.frontend) &&
      /edgeTypes=\{edgeTypes\}/u.test(sources.frontend),
    roundedWithoutBezier:
      /roundedOrthogonalPath/u.test(sources.frontend) &&
      /radius = 8/u.test(sources.frontend) &&
      / Q \$\{corner\.x\}/u.test(sources.frontend) &&
      !/getBezierPath|BezierEdge/u.test(sources.frontend),
    rerouteAndPersistence:
      /requestAnimationFrame/u.test(sources.frontend) &&
      /routeSequenceRef/u.test(sources.frontend) &&
      /dataRelationshipApi\s*\.\s*routePreview/u.test(sources.frontend) &&
      /dataRelationshipApi\.moveNode/u.test(sources.frontend) &&
      /dataRelationshipApi\.updateViewport/u.test(sources.frontend),
    autoLayoutUi:
      /자동 배치/u.test(sources.frontend) &&
      /AutoLayoutPreview/u.test(sources.frontend) &&
      /dataRelationshipApi\.previewAutoLayout/u.test(sources.frontend) &&
      /dataRelationshipApi\.applyAutoLayout/u.test(sources.frontend) &&
      /fitView/u.test(sources.frontend),
    equalSiblingGeometry:
      /relationship-layout-actions/u.test(sources.styles) &&
      /grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/u.test(
        sources.styles,
      ) &&
      /relationship-dialog-actions/u.test(sources.styles),
    reducedMotion:
      /prefers-reduced-motion:\s*reduce/u.test(sources.styles) &&
      /relationship-edge-line/u.test(sources.styles),
    backendBehavior:
      /persists free Node movement and viewport, previews orthogonal routes/u.test(
        sources.backendTest,
      ) &&
      /applies one undoable ELK layout/u.test(sources.backendTest) &&
      /restart/u.test(sources.backendTest) &&
      /relationship-layout-history\/undo/u.test(sources.backendTest),
    routerBehavior:
      /horizontal and vertical routes/u.test(sources.routerTest) &&
      /Node interiors/u.test(sources.routerTest) &&
      /16-pixel endpoint stubs/u.test(sources.routerTest),
    frontendBehavior:
      /orthogonal points with rounded corners/u.test(sources.frontendTest) &&
      /previews and applies one server-owned Auto Layout snapshot/u.test(
        sources.frontendTest,
      ) &&
      /persists pin state/u.test(sources.frontendTest),
    adrBoundary:
      /12px(?: Node)? clearance/u.test(sources.adr) &&
      /16px/u.test(sources.adr) &&
      /8px/u.test(sources.adr) &&
      /EPL-2\.0 OR GPL-3\.0-or-later/u.test(sources.adr) &&
      /MIT/u.test(sources.adr),
  };
}

export function inspectPhase10BrowserEvidence(evidence) {
  const routes = evidence?.routing?.routes;
  const nodeMove = evidence?.nodeMove;
  const auto = evidence?.autoLayout;
  return {
    result: evidence?.result === "PASS",
    isolated:
      evidence?.target === "isolated local browser session" &&
      /^http:\/\/127\.0\.0\.1:\d+\/$/u.test(evidence?.url ?? ""),
    viewport:
      evidence?.viewport?.width === 1280 && evidence?.viewport?.height === 720,
    moveReloadExact:
      Number.isFinite(nodeMove?.before?.x) &&
      Number.isFinite(nodeMove?.after?.x) &&
      (nodeMove.before.x !== nodeMove.after.x ||
        nodeMove.before.y !== nodeMove.after.y) &&
      nodeMove?.reload?.x === nodeMove.after.x &&
      nodeMove?.reload?.y === nodeMove.after.y,
    pinExact:
      nodeMove?.pinnedBefore === true &&
      nodeMove?.pinnedAfterAutoLayout?.x === nodeMove?.after?.x &&
      nodeMove?.pinnedAfterAutoLayout?.y === nodeMove?.after?.y,
    routeCount:
      Array.isArray(routes) &&
      routes.length > 0 &&
      routes.length === evidence?.routing?.bindingCount,
    orthogonalRoutes:
      routes?.every(
        (route) =>
          route.horizontalVerticalOnly === true &&
          route.crossesNode === false &&
          route.sourceStub >= 16 &&
          route.targetStub >= 16 &&
          route.cornerRadius === 8 &&
          route.bezierSegments === 0,
      ) === true,
    autoLayoutExact:
      auto?.previewCount > 0 &&
      auto?.previewCount === auto?.appliedCount &&
      auto?.overlapCount === 0 &&
      auto?.crossingCountAfter <= auto?.crossingCountBefore &&
      auto?.durableAfterReload === true,
    autoLayoutUndo: auto?.singleCommand === true && auto?.undoRestored === true,
    equalLayoutControls: equalRects(evidence?.geometry?.layoutActionRects),
    equalDialogActions: equalRects(evidence?.geometry?.dialogActionRects),
    responsive:
      evidence?.responsive419?.viewportWidth === 419 &&
      evidence?.responsive419?.documentScrollWidth === 419 &&
      evidence?.responsive419?.graphReachable === true &&
      evidence?.responsive419?.controlsReachable === true &&
      evidence?.responsive419?.siblingGeometryPreserved === true,
    cleanRuntime:
      evidence?.consoleErrorCount === 0 && evidence?.failedRequestCount === 0,
  };
}

async function readBrowserEvidence(repositoryRoot) {
  try {
    return JSON.parse(
      await readFile(
        resolve(repositoryRoot, PHASE10_BROWSER_EVIDENCE_PATH),
        "utf8",
      ),
    );
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

export async function validatePhase10({
  repositoryRoot = REPOSITORY_ROOT,
  includeBrowserEvidence = true,
  includeGovernance = true,
  includePhase9Regression = true,
} = {}) {
  const validation = new Validation(
    "Phase 10 Orthogonal Routing and Auto Layout",
  );
  const sources = await readSources(repositoryRoot);
  const inspection = inspectPhase10Contract(sources);
  for (const [name, value] of Object.entries(inspection)) {
    validation.check(value === true, `Phase 10 contract failed: ${name}`, {
      value,
    });
  }

  let browserInspection = { result: "NOT_RUN" };
  if (includeBrowserEvidence) {
    browserInspection = inspectPhase10BrowserEvidence(
      await readBrowserEvidence(repositoryRoot),
    );
    for (const [name, value] of Object.entries(browserInspection)) {
      validation.check(
        value === true,
        `Phase 10 browser evidence failed: ${name}`,
        { value },
      );
    }
  }

  let governance = { result: "NOT_RUN" };
  if (includeGovernance) {
    const traceability = JSON.parse(sources.traceability);
    const requirements = new Map(
      traceability.requirements?.map((requirement) => [
        requirement.id,
        requirement,
      ]),
    );
    governance = Object.fromEntries(
      ["REQ-017", "REQ-025"].flatMap((id) => {
        const requirement = requirements.get(id);
        return [
          [`${id}.status`, requirement?.status === "VERIFIED"],
          [
            `${id}.implementation`,
            requirement?.implementation?.includes(FILES.adr) &&
              requirement?.implementation?.includes(FILES.frontend),
          ],
          [
            `${id}.tests`,
            requirement?.tests?.includes(FILES.backendTest) &&
              requirement?.tests?.includes("scripts/verify-phase10.mjs"),
          ],
          [
            `${id}.evidence`,
            requirement?.evidence?.includes(PHASE10_EVIDENCE_PATH) &&
              requirement?.evidence?.includes(PHASE10_BROWSER_EVIDENCE_PATH),
          ],
        ];
      }),
    );
    for (const [name, value] of Object.entries(governance)) {
      validation.check(value === true, `Phase 10 governance failed: ${name}`, {
        value,
      });
    }
  }

  let phase9Regression = { result: "NOT_RUN", failures: [] };
  if (includePhase9Regression) {
    phase9Regression = await validatePhase9({ repositoryRoot });
    validation.check(
      phase9Regression.result === "PASS",
      "Phase 0–9 regression must remain green",
      { failures: phase9Regression.failures },
    );
  }

  return validation.result({
    inspection,
    browserInspection,
    governance,
    phase9Regression: phase9Regression.result,
    browserEvidencePath: PHASE10_BROWSER_EVIDENCE_PATH,
  });
}

if (isMainModule(import.meta.url)) {
  try {
    await finishVerification(PHASE10_EVIDENCE_PATH, await validatePhase10());
  } catch (error) {
    await finishVerification(
      PHASE10_EVIDENCE_PATH,
      unexpectedFailure("Phase 10 Orthogonal Routing and Auto Layout", error),
    );
  }
}
