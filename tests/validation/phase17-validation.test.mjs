import assert from "node:assert/strict";
import { resolve } from "node:path";
import { describe, it } from "node:test";

import {
  inspectPhase17BrowserEvidence,
  inspectPhase17Contract,
  validatePhase17,
} from "../../scripts/verify-phase17.mjs";

const root = resolve(import.meta.dirname, "../..");

describe("Phase 17 validation contract", () => {
  it("passes production, behavior, and Phase 16 regression contracts", async () => {
    const report = await validatePhase17({
      repositoryRoot: root,
      includeBrowserEvidence: false,
      includeGovernance: false,
    });
    assert.equal(report.result, "PASS", JSON.stringify(report.failures));
  });

  it("rejects mutable restore and directory-only backup evidence", () => {
    const empty = Object.fromEntries(
      [
        "adr",
        "domain",
        "metadata",
        "storage",
        "service",
        "projectRepository",
        "projectService",
        "routes",
        "system",
        "serverTest",
        "webApi",
        "manager",
        "projectHome",
        "styles",
        "webTest",
        "traceability",
        "status",
      ].map((key) => [key, ""]),
    );
    const inspection = inspectPhase17Contract({
      ...empty,
      adr: "restore overwrites the source Project",
      projectService: "hasBackup(directory)",
    });
    assert.equal(inspection.architecture, false);
    assert.equal(inspection.verifiedPurgeEvidence, false);
  });

  it("rejects mismatched controls and incomplete recovery evidence", () => {
    const inspection = inspectPhase17BrowserEvidence({
      schemaVersion: 1,
      result: "PASS",
      target: "isolated local browser session",
      url: "http://127.0.0.1:45177/",
      viewport: { width: 1280, height: 720 },
      recovery: { backupStatus: "VERIFIED", drillStatus: "FAIL" },
      geometry: {
        rowActionRects: [
          { width: 96, height: 40 },
          { width: 80, height: 40 },
        ],
      },
    });
    assert.equal(inspection.flow, false);
    assert.equal(inspection.geometry, false);
  });
});
