import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it } from "node:test";

import {
  CANONICAL_PHASE10_ROUTES,
  inspectPhase10BrowserEvidence,
  inspectPhase10Contract,
  validatePhase10,
} from "../../scripts/verify-phase10.mjs";

const root = resolve(import.meta.dirname, "../..");
const files = {
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
};

async function sources() {
  return Object.fromEntries(
    await Promise.all(
      Object.entries(files).map(async ([key, path]) => [
        key,
        await readFile(resolve(root, path), "utf8"),
      ]),
    ),
  );
}

function browserFixture() {
  const rect = { x: 1, y: 1, width: 96, height: 40 };
  return {
    result: "PASS",
    target: "isolated local browser session",
    url: "http://127.0.0.1:45180/",
    viewport: { width: 1280, height: 720 },
    nodeMove: {
      before: { x: 40, y: 40 },
      after: { x: 120, y: 80 },
      reload: { x: 120, y: 80 },
      pinnedBefore: true,
      pinnedAfterAutoLayout: { x: 120, y: 80 },
    },
    routing: {
      bindingCount: 1,
      routes: [
        {
          horizontalVerticalOnly: true,
          crossesNode: false,
          sourceStub: 16,
          targetStub: 16,
          cornerRadius: 8,
          bezierSegments: 0,
        },
      ],
    },
    autoLayout: {
      previewCount: 3,
      appliedCount: 3,
      overlapCount: 0,
      crossingCountBefore: 1,
      crossingCountAfter: 0,
      durableAfterReload: true,
      singleCommand: true,
      undoRestored: true,
    },
    geometry: {
      layoutActionRects: [rect, rect, rect, rect],
      dialogActionRects: [rect, rect],
    },
    responsive419: {
      viewportWidth: 419,
      documentScrollWidth: 419,
      graphReachable: true,
      controlsReachable: true,
      siblingGeometryPreserved: true,
    },
    consoleErrorCount: 0,
    failedRequestCount: 0,
  };
}

describe("Phase 10 validation", () => {
  it("accepts the repository before browser and governance finalization", async () => {
    const report = await validatePhase10({
      includeBrowserEvidence: false,
      includeGovernance: false,
      includePhase9Regression: false,
    });
    assert.equal(report.result, "PASS", JSON.stringify(report.failures));
  });

  it("keeps all seven Phase 10 routes", () => {
    assert.equal(CANONICAL_PHASE10_ROUTES.length, 7);
  });

  it("rejects routing without clearance, fixed horizontal layout, or rounded corners", async () => {
    const current = await sources();
    assert.equal(
      inspectPhase10Contract(current).serverOwnedOrthogonalRouter,
      true,
    );
    assert.equal(inspectPhase10Contract(current).elkLayeredContract, true);
    assert.equal(inspectPhase10Contract(current).roundedWithoutBezier, true);
    assert.equal(
      inspectPhase10Contract({
        ...current,
        router: current.router.replace(
          "const CLEARANCE = 12",
          "const CLEARANCE = 0",
        ),
      }).serverOwnedOrthogonalRouter,
      false,
    );
    assert.equal(
      inspectPhase10Contract({
        ...current,
        autoLayout: current.autoLayout.replace(
          '"elk.direction": "RIGHT"',
          '"elk.direction": "DOWN"',
        ),
      }).elkLayeredContract,
      false,
    );
    assert.equal(
      inspectPhase10Contract({
        ...current,
        frontend: current.frontend.replace(" Q ${corner.x}", " C ${corner.x}"),
      }).roundedWithoutBezier,
      false,
    );
  });

  it("rejects browser evidence with a Bezier, Node crossing, overlap, or lost reload", () => {
    const fixture = browserFixture();
    assert.equal(inspectPhase10BrowserEvidence(fixture).orthogonalRoutes, true);
    assert.equal(inspectPhase10BrowserEvidence(fixture).autoLayoutExact, true);
    assert.equal(inspectPhase10BrowserEvidence(fixture).moveReloadExact, true);
    assert.equal(
      inspectPhase10BrowserEvidence({
        ...fixture,
        routing: {
          ...fixture.routing,
          routes: [
            {
              ...fixture.routing.routes[0],
              bezierSegments: 1,
              crossesNode: true,
            },
          ],
        },
      }).orthogonalRoutes,
      false,
    );
    assert.equal(
      inspectPhase10BrowserEvidence({
        ...fixture,
        autoLayout: { ...fixture.autoLayout, overlapCount: 1 },
      }).autoLayoutExact,
      false,
    );
    assert.equal(
      inspectPhase10BrowserEvidence({
        ...fixture,
        nodeMove: { ...fixture.nodeMove, reload: { x: 40, y: 40 } },
      }).moveReloadExact,
      false,
    );
  });
});
