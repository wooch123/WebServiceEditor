import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  inspectFinalReleaseBoundary,
  inspectNonWindowsCompletionStatus,
  inspectNonWindowsFinalAuditBoundary,
  validatePhase23,
  validatePhase23Local,
} from "../../scripts/verify-phase23.mjs";
import {
  composeNonWindowsFinalAudit,
  NON_WINDOWS_SOURCE_REPORTS,
  WINDOWS_OPERATIONAL_EVIDENCE,
} from "../../scripts/build-non-windows-final-audit.mjs";

function validInput() {
  return {
    release:
      "feature-inventory.json requirement-matrix.json theme-60-report.json layout-element-report.json project-corpus-manifest.json project-corpus-results.json project-corpus-performance.json windows-https-report.json backup-restore-report.json rollback-report.json final-verification-report.json verifiedRequirementCount criticalDefects highDefects releaseReadyFormula releaseRecommendation sourceReports sha256(await readRepositoryFile",
    builder:
      'sourceReports sha256(await readRepositoryFile validateRelease({ includeFinalReport: false }) preflight.result !== "PASS" ReleaseReady formula is not fully satisfied finalGate.result !== "PASS"',
    hygiene: "TODO FIXME HACK skipped todo failing",
    reports: "validatePhase19 validatePhase21 validateThemeProvenance",
  };
}

function validNonWindowsInput() {
  return {
    localBuilder:
      'NON_WINDOWS_FINAL_AUDIT NOT_RUN_BY_USER_DIRECTION releaseRecommendation: "HOLD" releaseAllowed: false treatedAsPassing: false windows-https-report.json backup-restore-report.json rollback-report.json final-verification-report.json NON_WINDOWS_SOURCE_REPORTS sha256(await readRepositoryFile Non-Windows final audit formula is not fully satisfied must pass before the audit is built',
    localVerifier:
      "validatePhase23Local non-windows-final-audit-validation.json",
  };
}

function validNonWindowsReports() {
  const reports = Object.fromEntries(
    NON_WINDOWS_SOURCE_REPORTS.map((path) => [
      path,
      { result: "PASS", evidenceComplete: true },
    ]),
  );
  reports[NON_WINDOWS_SOURCE_REPORTS[0]].summary = {
    required: 418,
    verified: 418,
    failed: 0,
    blocked: 0,
    skipped: 0,
  };
  reports[NON_WINDOWS_SOURCE_REPORTS[1]].summary = {
    total: 37,
    verified: 37,
    failed: 0,
    skipped: 0,
  };
  reports[NON_WINDOWS_SOURCE_REPORTS[2]].summary = {
    total: 60,
    passed: 60,
    failed: 0,
    selectableTotal: 120,
  };
  reports[NON_WINDOWS_SOURCE_REPORTS[3]].summary = {
    layoutPresetTotal: 22,
    layoutPresetPassed: 22,
    elementTotal: 55,
    elementPassed: 55,
    failed: 0,
  };
  reports[NON_WINDOWS_SOURCE_REPORTS[5]].summary = {
    total: 100,
    passed: 100,
    failed: 0,
    blocked: 0,
    skipped: 0,
    crossProjectLeaks: 0,
    orphanRecordsOrFiles: 0,
    criticalConsoleErrors: 0,
  };
  reports[NON_WINDOWS_SOURCE_REPORTS[6]].summary = {
    metricCount: 8,
    passed: 8,
    failed: 0,
  };
  return reports;
}

describe("Phase 23 validation contract", () => {
  it("accepts a complete fail-closed final release boundary", () => {
    assert.ok(
      Object.values(inspectFinalReleaseBoundary(validInput())).every(Boolean),
    );
  });

  it("rejects a final report that is not checksum-bound", () => {
    const input = validInput();
    input.builder = input.builder.replace(
      "sha256(await readRepositoryFile",
      "trustReportPath",
    );
    assert.equal(inspectFinalReleaseBoundary(input).checksumBinding, false);
  });

  it("accepts an explicit non-Windows HOLD boundary", () => {
    assert.ok(
      Object.values(
        inspectNonWindowsFinalAuditBoundary(validNonWindowsInput()),
      ).every(Boolean),
    );
  });

  it("accepts exhaustive non-Windows completion without claiming release", () => {
    const status = `
Overall state: \`EXHAUSTIVELY VERIFIED\`
Completion scope: non-Windows implementation and verification.
### PHASE 23 — Final Non-Windows Audit
State: \`EXHAUSTIVELY VERIFIED\`
The declared non-Windows scope is complete and exhaustively verified.
The canonical release gate intentionally remains red. This repository is not marked \`RELEASED\`.
## Phase ledger
| 23 | EXHAUSTIVELY VERIFIED | Non-Windows audit complete; canonical release remains HOLD |
`;
    assert.ok(
      Object.values(inspectNonWindowsCompletionStatus(status)).every(Boolean),
    );
  });

  it("rejects a non-Windows completion record that claims release", () => {
    const status = `
Overall state: \`RELEASED\`
### PHASE 23 — Final Non-Windows Audit
State: \`RELEASED\`
The declared non-Windows scope is complete.
## Phase ledger
| 23 | RELEASED | Release |
`;
    assert.equal(
      Object.values(inspectNonWindowsCompletionStatus(status)).every(Boolean),
      false,
    );
  });

  it("never turns skipped Windows evidence into release approval", () => {
    const reports = validNonWindowsReports();
    const checksums = Object.fromEntries(
      NON_WINDOWS_SOURCE_REPORTS.map((path) => [path, "a".repeat(64)]),
    );
    const report = composeNonWindowsFinalAudit({ reports, checksums });
    assert.equal(report.result, "PASS");
    assert.equal(report.releaseRecommendation, "HOLD");
    assert.equal(report.releaseAllowed, false);
    assert.equal(report.windowsDeployment.treatedAsPassing, false);
    assert.deepEqual(
      report.missingOperationalEvidence,
      WINDOWS_OPERATIONAL_EVIDENCE,
    );
  });

  it("rejects a non-Windows audit with an incomplete corpus", () => {
    const reports = validNonWindowsReports();
    reports[NON_WINDOWS_SOURCE_REPORTS[5]].summary.passed = 99;
    const checksums = Object.fromEntries(
      NON_WINDOWS_SOURCE_REPORTS.map((path) => [path, "b".repeat(64)]),
    );
    assert.throws(
      () => composeNonWindowsFinalAudit({ reports, checksums }),
      /formula is not fully satisfied/u,
    );
  });

  it("passes the repository preflight without manufacturing release evidence", async () => {
    const report = await validatePhase23({ includeReleaseEvidence: false });
    assert.equal(report.result, "PASS", JSON.stringify(report.failures));
    assert.equal(report.details.releaseResult, "NOT_RUN");
    assert.equal(report.details.releaseAllowed, false);
  });

  it("passes the scoped repository audit while the release stays on HOLD", async () => {
    const report = await validatePhase23Local();
    assert.equal(report.result, "PASS", JSON.stringify(report.failures));
    assert.equal(report.details.report.releaseRecommendation, "HOLD");
    assert.equal(report.details.report.releaseAllowed, false);
  });
});
