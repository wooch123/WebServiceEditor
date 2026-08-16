import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it } from "node:test";

import {
  inspectPhase14BrowserEvidence,
  inspectPhase14Contract,
  validatePhase14,
} from "../../scripts/verify-phase14.mjs";

const root = resolve(import.meta.dirname, "../..");

describe("Phase 14 validation contract", () => {
  it("passes the repository production and behavior contract", async () => {
    const report = await validatePhase14({
      repositoryRoot: root,
      includeBrowserEvidence: false,
      includePhase13Regression: false,
      includeGovernance: false,
    });
    assert.equal(report.result, "PASS", JSON.stringify(report.failures));
  });

  it("rejects a browser artifact without exact history and filtered data", () => {
    const inspection = inspectPhase14BrowserEvidence({
      schemaVersion: 1,
      result: "PASS",
      target: "isolated local browser session",
      url: "http://127.0.0.1:5174/",
      viewport: { width: 1280, height: 720 },
      actionChain: {
        sourceRowValue: 2,
        targetRoute: "/analysis",
        queryKey: "v.selected_value",
        filteredRowCount: 2,
        rawFieldIdUsed: true,
      },
      history: {
        backRoute: "/lots",
        forwardRoute: "/analysis",
        deepLinkRoute: "/analysis",
        deepLinkFilteredRowCount: 2,
      },
    });
    assert.equal(inspection.actionChain, false);
    assert.equal(inspection.history, false);
  });

  it("rejects browser SQL and a missing server dependency compiler", () => {
    const blank = Object.fromEntries(
      [
        "adr",
        "domain",
        "runtimeDomain",
        "elementDomain",
        "metadata",
        "variableService",
        "variableRoutes",
        "dependencyCompiler",
        "relationshipService",
        "runtimeService",
        "queryCompiler",
        "relationshipCanvas",
        "runtime",
        "runtimeRenderer",
        "backendTest",
        "relationshipTest",
        "runtimeTest",
        "traceability",
        "status",
      ].map((key) => [key, ""]),
    );
    const inspection = inspectPhase14Contract({
      ...blank,
      runtime: "const rawSql = 'SELECT * FROM secret'",
    });
    assert.equal(inspection.dependencyCompilation, false);
    assert.equal(inspection.noBrowserSql, false);
  });

  it("keeps the Phase 14 verifier referenced by the workspace command", async () => {
    const packageJson = JSON.parse(
      await readFile(resolve(root, "package.json"), "utf8"),
    );
    assert.equal(
      packageJson.scripts["verify:phase14"],
      "pnpm test && node scripts/verify-phase14.mjs",
    );
  });
});
