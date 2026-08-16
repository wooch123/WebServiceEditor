import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  inspectWorkingShowcase,
  validatePhase24,
} from "../../scripts/verify-phase24.mjs";

function validInput() {
  return {
    pages: "synchronizeProductionForPublish",
    schema:
      'SCHEMA_TEST_NOT_APPLIED PRODUCTION_SCHEMA_DEPLOYED production-schema:after-backup production-schema:after-runtime-swap .production-schema-deployment.json #recoverProductionDeployments "production" webeditor_runtime_mutation_commands rowCountBefore rowCountAfter',
    repository: 'endpointObjectState === "active"',
    corpus:
      "feature-showcase-v3- FEATURE_SHOWCASE_BINDING_REPAIR_FAILED test-reset-",
    showcaseTest: 'environment: "production" operation: "CREATE" 42.5 27.25',
    schemaTest: "interrupted swap production-schema:after-runtime-swap",
    relationship:
      'liveOrthogonalPoints sourceX targetX relationship-edge-flow relationship-page-scope relationshipScopeNodeIds relationship-node-inventory TabsTrigger value="actions" TabsTrigger value="database" relationship-toolbar-groups aria-label="위치 도구"',
    relationshipTest:
      "moving Node and shows source-to-target flow selected Page, its Elements, and directly used DB Nodes",
    pageTest: "editor-dangle",
    elementTest: "dangles only the visible Element contents",
    styles:
      ".relationship-edge-flow stroke-dasharray: 2 13 animation: editor-dangle react-draggable-dragging > .element-item-toolbar prefers-reduced-motion: reduce page-manager-heading min-height: max-content page-manager-list flex: 1 1 auto",
    adr: "# ADR 0023: Production schema publish\nStatus: accepted",
    status:
      "Overall state: `EXHAUSTIVELY VERIFIED` canonical release gate remains on `HOLD`\n### PHASE 24 — Working Published Showcase\nState: `OPERATIONALLY VERIFIED`\n| 24 | OPERATIONALLY VERIFIED |",
  };
}

describe("Phase 24 validation contract", () => {
  it("accepts the guarded Production publish and working-site boundary", () => {
    assert.ok(
      Object.values(inspectWorkingShowcase(validInput())).every(Boolean),
    );
  });

  it("rejects a publish path that skips Production synchronization", () => {
    const input = validInput();
    input.pages = "publish without schema deployment";
    assert.equal(inspectWorkingShowcase(input).publishDeploysProduction, false);
  });

  it("rejects relationship motion without live endpoints", () => {
    const input = validInput();
    input.relationship = input.relationship.replace("sourceX", "storedX");
    assert.equal(inspectWorkingShowcase(input).liveEdgeAttachment, false);
  });

  it("passes against the authoritative repository without browser evidence", async () => {
    const result = await validatePhase24({ includeBrowserEvidence: false });
    assert.equal(result.result, "PASS", JSON.stringify(result.failures));
  });
});
