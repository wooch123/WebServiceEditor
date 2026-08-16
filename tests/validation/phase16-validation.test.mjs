import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it } from "node:test";

import {
  inspectPhase16BrowserEvidence,
  inspectPhase16Contract,
  validatePhase16,
} from "../../scripts/verify-phase16.mjs";

const root = resolve(import.meta.dirname, "../..");

describe("Phase 16 validation contract", () => {
  it("passes production, behavior, and Phase 15 regression contracts", async () => {
    const report = await validatePhase16({
      repositoryRoot: root,
      includeBrowserEvidence: false,
      includeGovernance: false,
    });
    assert.equal(report.result, "PASS", JSON.stringify(report.failures));
  });

  it("keeps all 37 requirements represented by the source manifest", async () => {
    const traceability = JSON.parse(
      await readFile(
        resolve(root, "docs/requirement-traceability.json"),
        "utf8",
      ),
    );
    assert.deepEqual(
      traceability.requirements.map(({ id }) => id),
      Array.from(
        { length: 37 },
        (_, index) => `REQ-${String(index + 1).padStart(3, "0")}`,
      ),
    );
  });

  it("rejects missing detection and unequal action geometry evidence", () => {
    const inspection = inspectPhase16BrowserEvidence({
      schemaVersion: 1,
      result: "PASS",
      target: "isolated local browser session",
      url: "http://127.0.0.1:45176/",
      viewport: { width: 1280, height: 720 },
      detection: { ruleIds: ["PAGE_ROUTE_INVALID"] },
      geometry: {
        actionRects: [
          { width: 96, height: 40 },
          { width: 80, height: 40 },
        ],
      },
    });
    assert.equal(inspection.detection, false);
    assert.equal(inspection.geometry, false);
  });

  it("rejects a client-side SQL validator and missing rule registry", () => {
    const empty = Object.fromEntries(
      [
        "adr",
        "domain",
        "metadata",
        "inventory",
        "service",
        "routes",
        "serverApp",
        "serverTest",
        "webApi",
        "report",
        "app",
        "webTest",
        "traceability",
        "status",
      ].map((key) => [key, ""]),
    );
    const inspection = inspectPhase16Contract({
      ...empty,
      webApi: "SELECT * FROM validation_runs",
    });
    assert.equal(inspection.ruleRegistry, false);
    assert.equal(inspection.noClientSql, false);
  });
});
