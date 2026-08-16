import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it } from "node:test";

import {
  inspectPhase13BrowserEvidence,
  inspectPhase13Contract,
  validatePhase13,
} from "../../scripts/verify-phase13.mjs";

const root = resolve(import.meta.dirname, "../..");

describe("Phase 13 validation contract", () => {
  it("passes the repository production and behavior contract", async () => {
    const report = await validatePhase13({
      repositoryRoot: root,
      includeBrowserEvidence: false,
      includePhase12Regression: false,
      includeGovernance: false,
    });
    assert.equal(report.result, "PASS", JSON.stringify(report.failures));
  });

  it("rejects browser evidence with a changed Production database", () => {
    const result = inspectPhase13BrowserEvidence({
      schemaVersion: 1,
      result: "PASS",
      target: "isolated local browser session",
      url: "http://127.0.0.1:5174/",
      viewport: { width: 1280, height: 720 },
      draftCrud: {
        rowCounts: [0, 1, 1, 0],
        createAffectedRows: 1,
        updateAffectedRows: 1,
        deleteAffectedRows: 1,
        validationMappedToField: true,
        conflictRolledBack: true,
        idempotentReplayExact: true,
        productionChecksumBefore: "a".repeat(64),
        productionChecksumAfter: "b".repeat(64),
        testChecksumBefore: "c".repeat(64),
        testChecksumAfter: "d".repeat(64),
        dataTableRefreshCount: 3,
        pendingActionsDisabled: true,
      },
    });
    assert.equal(result.fullCrud, true);
    assert.equal(result.environmentIsolation, false);
  });

  it("requires every write route and rejects browser SQL", () => {
    const blank = Object.fromEntries(
      [
        "adr",
        "domain",
        "relationshipDomain",
        "compiler",
        "relationshipService",
        "runtimeService",
        "routes",
        "backendTest",
        "relationshipCanvas",
        "relationshipTest",
        "runtime",
        "runtimeRenderer",
        "runtimeApi",
        "runtimeTest",
        "traceability",
        "status",
      ].map((key) => [key, ""]),
    );
    const result = inspectPhase13Contract({
      ...blank,
      runtime: "const rawSql = 'DELETE FROM records'",
    });
    assert.equal(result.routes, false);
    assert.equal(result.noBrowserSql, false);
  });

  it("keeps the Phase 13 verifier referenced by the workspace command", async () => {
    const packageJson = JSON.parse(
      await readFile(resolve(root, "package.json"), "utf8"),
    );
    assert.equal(
      packageJson.scripts["verify:phase13"],
      "pnpm test && node scripts/verify-phase13.mjs",
    );
  });
});
