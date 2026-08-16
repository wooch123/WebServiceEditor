import assert from "node:assert/strict";
import { resolve } from "node:path";
import { describe, it } from "node:test";

import {
  inspectPhase18BrowserEvidence,
  inspectPhase18Contract,
  validatePhase18,
} from "../../scripts/verify-phase18.mjs";

const root = resolve(import.meta.dirname, "../..");

describe("Phase 18 validation contract", () => {
  it("passes production, behavior, and Phase 17 regression contracts", async () => {
    const report = await validatePhase18({
      repositoryRoot: root,
      includeBrowserEvidence: false,
      includeGovernance: false,
    });
    assert.equal(report.result, "PASS", JSON.stringify(report.failures));
  });

  it("rejects weak authentication and unbounded sensitive instrumentation", () => {
    const empty = Object.fromEntries(
      Object.keys({
        adr: 0,
        domain: 0,
        metadata: 0,
        config: 0,
        app: 0,
        auth: 0,
        routes: 0,
        performance: 0,
        serverTest: 0,
        fetch: 0,
        boundary: 0,
        boundaryTest: 0,
        styles: 0,
        themeTest: 0,
        traceability: 0,
        status: 0,
      }).map((key) => [key, ""]),
    );
    const inspection = inspectPhase18Contract({
      ...empty,
      auth: "plaintext password localStorage",
      performance: "request.body request.cookies request.query",
    });
    assert.equal(inspection.passwordSecurity, false);
    assert.equal(inspection.boundedPerformance, false);
  });

  it("rejects localhost-only deployment and exceeded budgets", () => {
    const inspection = inspectPhase18BrowserEvidence({
      schemaVersion: 1,
      result: "PASS",
      target: "actual HTTPS domain",
      url: "http://127.0.0.1:5173/",
      viewport: { width: 1280, height: 720 },
      deployment: { httpStatus: 200, https: false },
      performance: {
        projectCount: 100,
        projectListMs: 2001,
        projectListBudgetMs: 2000,
        projectSearchMs: 301,
        projectSearchBudgetMs: 300,
      },
    });
    assert.equal(inspection.metadata, false);
    assert.equal(inspection.deployment, false);
    assert.equal(inspection.performance, false);
  });
});
