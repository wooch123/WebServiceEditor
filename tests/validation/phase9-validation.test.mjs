import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it } from "node:test";

import {
  CANONICAL_PHASE9_ROUTES,
  REQUIRED_RELATIONSHIP_BINDING_TYPES,
  REQUIRED_RELATIONSHIP_NODE_TYPES,
  inspectPhase9BrowserEvidence,
  inspectPhase9Contract,
  validatePhase9,
} from "../../scripts/verify-phase9.mjs";

const root = resolve(import.meta.dirname, "../..");
const files = {
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

describe("Phase 9 validation", () => {
  it("accepts the authoritative repository before browser and governance finalization", async () => {
    const report = await validatePhase9({
      includeBrowserEvidence: false,
      includeGovernance: false,
      includePhase8Regression: false,
    });
    assert.equal(report.result, "PASS", JSON.stringify(report.failures));
  });

  it("keeps the canonical node, Binding, and route inventories exact", () => {
    assert.deepEqual(REQUIRED_RELATIONSHIP_NODE_TYPES, [
      "page",
      "element",
      "table",
    ]);
    assert.equal(REQUIRED_RELATIONSHIP_BINDING_TYPES.length, 8);
    assert.equal(CANONICAL_PHASE9_ROUTES.length, 9);
  });

  it("rejects removal of server preview and SQLite direction boundaries", async () => {
    const current = await sources();
    assert.equal(inspectPhase9Contract(current).serverOwnedPreview, true);
    assert.equal(inspectPhase9Contract(current).sqlitePortDirection, true);
    assert.equal(
      inspectPhase9Contract({
        ...current,
        service: current.service.replaceAll("15_000", "unbounded"),
      }).serverOwnedPreview,
      false,
    );
    assert.equal(
      inspectPhase9Contract({
        ...current,
        migration: current.migration.replace(
          "source_side = 'right'",
          "source_side IN ('left', 'right')",
        ),
      }).sqlitePortDirection,
      false,
    );
  });

  it("rejects a visual Edge without one Binding ID and unequal sibling geometry", () => {
    const evidence = browserFixture();
    assert.equal(
      inspectPhase9BrowserEvidence(evidence).previewCommitExact,
      true,
    );
    assert.equal(inspectPhase9BrowserEvidence(evidence).equalToolbar, true);
    assert.equal(
      inspectPhase9BrowserEvidence({
        ...evidence,
        connection: {
          ...evidence.connection,
          visualEdgeBindingId: "different",
        },
      }).previewCommitExact,
      false,
    );
    assert.equal(
      inspectPhase9BrowserEvidence({
        ...evidence,
        geometry: {
          ...evidence.geometry,
          toolbarActionRects: [
            evidence.geometry.toolbarActionRects[0],
            { x: 0, y: 0, width: 91, height: 40 },
          ],
        },
      }).equalToolbar,
      false,
    );
  });
});

function browserFixture() {
  const rect = { x: 1, y: 1, width: 90, height: 40 };
  return {
    result: "PASS",
    target: "isolated local browser session",
    viewport: { width: 1280, height: 720 },
    graph: {
      nodeTypes: ["page", "element", "table"],
      nodeCount: 3,
      inputPortCount: 3,
      outputPortCount: 3,
      allInputsLeft: true,
      allOutputsRight: true,
    },
    connection: {
      compatible: true,
      bindingCountBefore: 0,
      bindingCountAfter: 1,
      visualEdgeCount: 1,
      visualEdgeBindingId: "binding-1",
      bindingId: "binding-1",
      arrowVisible: true,
      labelVisible: true,
      forbiddenCompatible: false,
      bindingCountAfterForbidden: 1,
    },
    history: {
      afterDelete: 0,
      afterUndo: 1,
      afterRedo: 0,
      stableBindingId: true,
    },
    geometry: {
      toolbarActionRects: [rect, rect, rect, rect],
      dialogActionRects: [rect, rect],
      modeControlRects: [rect, rect],
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
