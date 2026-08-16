import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it } from "node:test";

import {
  CANONICAL_PHASE11_ROUTES,
  inspectPhase11BrowserEvidence,
  inspectPhase11Contract,
  validatePhase11,
} from "../../scripts/verify-phase11.mjs";

const root = resolve(import.meta.dirname, "../..");
const files = {
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
  const rect = { x: 1, y: 1, width: 120, height: 40 };
  return {
    result: "PASS",
    target: "isolated local browser session",
    url: "http://127.0.0.1:45181/",
    viewport: { width: 1280, height: 720 },
    geometry: {
      queryActionRects: [rect, rect],
      dialogActionRects: [rect, rect],
    },
    readFlow: {
      sampleRowCount: 24,
      previewRowCount: 10,
      planChecksum: "a".repeat(64),
      bindingId: "binding-1",
      edgeBindingId: "binding-1",
      tableRenderedRows: 10,
      histogramRenderedMarks: 8,
      frontendFixtureDataUsed: false,
      requestContainedSql: false,
      productionChecksumBefore: "b".repeat(64),
      productionChecksumAfter: "b".repeat(64),
    },
    responsive419: {
      viewportWidth: 419,
      documentScrollWidth: 419,
      wizardReachable: true,
      siblingGeometryPreserved: true,
    },
    consoleErrorCount: 0,
    failedRequestCount: 0,
  };
}

describe("Phase 11 validation", () => {
  it("accepts the repository before browser and governance finalization", async () => {
    const report = await validatePhase11({
      includeBrowserEvidence: false,
      includeGovernance: false,
      includePhase10Regression: false,
    });
    assert.equal(report.result, "PASS", JSON.stringify(report.failures));
  });

  it("keeps the five Safe READ routes", () => {
    assert.equal(CANONICAL_PHASE11_ROUTES.length, 5);
  });

  it("rejects raw identifier, read-only, and Test-only boundary removal", async () => {
    const current = await sources();
    assert.equal(
      inspectPhase11Contract(current).physicalIdentifierBoundary,
      true,
    );
    assert.equal(
      inspectPhase11Contract(current).readOnlyBoundedExecution,
      true,
    );
    assert.equal(inspectPhase11Contract(current).crashSafeSampleCommands, true);
    assert.equal(
      inspectPhase11Contract({
        ...current,
        compiler: current.compiler.replace(
          "query_only = ON",
          "query_only = OFF",
        ),
      }).readOnlyBoundedExecution,
      false,
    );
    assert.equal(
      inspectPhase11Contract({
        ...current,
        compiler: current.compiler.replace(
          "PHYSICAL_TABLE_PATTERN = /^t_[0-9a-f]{32}$/",
          "PHYSICAL_TABLE_PATTERN = /.*/",
        ),
      }).physicalIdentifierBoundary,
      false,
    );
    assert.equal(
      inspectPhase11Contract({
        ...current,
        sampleService: current.sampleService.replace(
          "SAMPLE_DATA_RECOVERY_REQUIRED",
          "SAMPLE_DATA_RECOVERY_OMITTED",
        ),
      }).crashSafeSampleCommands,
      false,
    );
  });

  it("rejects browser evidence with frontend fixtures, SQL, Production mutation, or unequal controls", () => {
    const fixture = browserFixture();
    assert.equal(inspectPhase11BrowserEvidence(fixture).renderedResults, true);
    assert.equal(inspectPhase11BrowserEvidence(fixture).safety, true);
    assert.equal(
      inspectPhase11BrowserEvidence({
        ...fixture,
        readFlow: {
          ...fixture.readFlow,
          frontendFixtureDataUsed: true,
          requestContainedSql: true,
          productionChecksumAfter: "c".repeat(64),
        },
      }).safety,
      false,
    );
    assert.equal(
      inspectPhase11BrowserEvidence({
        ...fixture,
        geometry: {
          ...fixture.geometry,
          queryActionRects: [
            fixture.geometry.queryActionRects[0],
            { ...fixture.geometry.queryActionRects[1], width: 140 },
          ],
        },
      }).equalQueryActions,
      false,
    );
  });
});
