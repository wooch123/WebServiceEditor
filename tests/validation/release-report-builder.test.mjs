import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { composeReleaseReports } from "../../scripts/build-release-reports.mjs";

function fixture() {
  return {
    phase19: {
      details: {
        inspection: {
          counts: {
            pageTypes: 12,
            elementTypes: 55,
            layoutPresets: 22,
            bindingTypes: 11,
            themes: 120,
            actions: 8,
            lifecycles: 7,
            requirements: 37,
            apiRoutes: 118,
            validationInventory: 418,
          },
          categoryCounts: { basic: 12 },
        },
      },
    },
    themeAudit: { details: { themeCount: 60, groupCounts: { dark: 20 } } },
    themeProvenance: {
      details: { referenceCount: 17, decision: "APPROVED" },
    },
    traceability: {
      requirements: Array.from({ length: 37 }, (_, index) => ({
        id: `REQ-${String(index + 1).padStart(3, "0")}`,
        title: "Requirement",
        phase: 1,
        status: "VERIFIED",
        implementation: ["implementation"],
        tests: ["test"],
        evidence: ["evidence"],
      })),
    },
    corpusManifest: {
      projectCount: 100,
      runId: "run",
      manifestChecksum: "checksum",
      summary: {
        generatedProjectCount: 100,
        uniqueProjectSentinelCount: 100,
        uniqueRuntimeSentinelCount: 100,
        categoryCounts: {},
        coverage: {},
        scaleTotals: {},
      },
    },
    corpusResults: {
      runId: "run",
      verificationChecksum: "checksum",
      results: Array.from({ length: 100 }, () => ({ status: "PASS" })),
      summary: {
        passCount: 100,
        failCount: 0,
        blockedCount: 0,
        skippedCount: 0,
        crossProjectLeakCount: 0,
        orphanRecordCount: 0,
        orphanFileCount: 0,
        criticalErrorCount: 0,
        performance: { open: { passed: true } },
      },
    },
    corpusPerformance: {
      runId: "run",
      verificationChecksum: "checksum",
      performance: {},
    },
    sourceChecksums: {
      phase19: "a",
      themes: "b",
      traceability: "c",
      corpusManifest: "d",
      corpusResults: "e",
      corpusPerformance: "f",
    },
  };
}

describe("Release report builder", () => {
  it("composes seven complete reports from verified evidence", () => {
    const reports = composeReleaseReports(fixture());
    assert.equal(Object.keys(reports).length, 7);
    assert.ok(
      Object.values(reports).every(
        (report) => report.result === "PASS" && report.evidenceComplete,
      ),
    );
    assert.equal(
      reports["reports/exhaustive/feature-inventory.json"].summary.verified,
      418,
    );
    assert.equal(
      reports["reports/exhaustive/requirement-matrix.json"].summary.verified,
      37,
    );
    assert.equal(
      reports["reports/corpus/project-corpus-results.json"].summary.passed,
      100,
    );
  });

  it("does not convert a non-verified requirement into verified coverage", () => {
    const input = fixture();
    input.traceability.requirements[0].status = "IN PROGRESS";
    const reports = composeReleaseReports(input);
    assert.equal(
      reports["reports/exhaustive/requirement-matrix.json"].summary.verified,
      36,
    );
  });
});
