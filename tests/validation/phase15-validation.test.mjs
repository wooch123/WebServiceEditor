import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it } from "node:test";

import {
  inspectPhase15BrowserEvidence,
  inspectPhase15Contract,
  validatePhase15,
} from "../../scripts/verify-phase15.mjs";

const root = resolve(import.meta.dirname, "../..");

describe("Phase 15 validation contract", () => {
  it("passes the repository contract without pending browser/governance gates", async () => {
    const report = await validatePhase15({
      repositoryRoot: root,
      includeBrowserEvidence: false,
      includePhase14Regression: false,
      includeGovernance: false,
    });
    assert.equal(report.result, "PASS", JSON.stringify(report.failures));
  });

  it("rejects a browser artifact without a monotonic runtime activation", () => {
    const result = inspectPhase15BrowserEvidence({
      schemaVersion: 1,
      result: "PASS",
      target: "isolated local browser session",
      url: "http://127.0.0.1:45175/",
      viewport: { width: 1280, height: 720 },
      editorRevision: {
        draftStatus: "DRAFT",
        validatedStatus: "INVALID",
        runtimeApplied: false,
        runtimeVersionBefore: 1,
        runtimeVersionAfter: 1,
      },
    });
    assert.equal(result.editorRevision, false);
  });

  it("rejects SQL in the browser and missing rollback ownership", () => {
    const keys = [
      "adr",
      "themeDomain",
      "themeCore",
      "metadata",
      "service",
      "routes",
      "appServer",
      "editor",
      "picker",
      "runtime",
      "preference",
      "webApi",
      "backendTest",
      "frontendTest",
      "traceability",
      "status",
    ];
    const source = Object.fromEntries(keys.map((key) => [key, ""]));
    const inspection = inspectPhase15Contract({
      ...source,
      runtime: "const query = 'SELECT * FROM theme_revisions'",
    });
    assert.equal(inspection.safeActivation, false);
    assert.equal(inspection.noClientTokensFromNetworkCode, false);
  });

  it("keeps the Phase 15 verifier referenced by the workspace command", async () => {
    const packageJson = JSON.parse(
      await readFile(resolve(root, "package.json"), "utf8"),
    );
    assert.equal(
      packageJson.scripts["verify:phase15"],
      "pnpm test && node scripts/verify-phase15.mjs",
    );
  });
});
