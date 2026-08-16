import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { composeFinalReleaseReport } from "../../scripts/build-final-release-report.mjs";

function fixture() {
  const reports = {
    "reports/exhaustive/feature-inventory.json": {
      summary: {
        required: 418,
        verified: 418,
        failed: 0,
        blocked: 0,
        skipped: 0,
      },
    },
    "reports/exhaustive/requirement-matrix.json": {
      summary: { total: 37, verified: 37, failed: 0, skipped: 0 },
    },
    "reports/exhaustive/theme-60-report.json": {
      summary: { total: 60, passed: 60, failed: 0 },
    },
    "reports/exhaustive/layout-element-report.json": { result: "PASS" },
    "reports/corpus/project-corpus-manifest.json": { result: "PASS" },
    "reports/corpus/project-corpus-results.json": {
      summary: {
        total: 100,
        passed: 100,
        failed: 0,
        skipped: 0,
        crossProjectLeaks: 0,
        orphanRecordsOrFiles: 0,
        criticalConsoleErrors: 0,
      },
    },
    "reports/corpus/project-corpus-performance.json": {
      summary: { failed: 0 },
    },
    "reports/deployment/windows-https-report.json": {
      result: "PASS",
      evidenceComplete: true,
      host: "WINDOWS",
      publicOrigin: "https://webeditor.dove9999.com",
      rebootVerified: true,
      origin: { loopbackOnly: true, ready: "ready" },
      https: { hostname: "webeditor.dove9999.com" },
    },
    "reports/recovery/backup-restore-report.json": {
      result: "PASS",
      evidenceComplete: true,
      backup: { result: "PASS" },
      restoreDrill: { result: "PASS" },
    },
    "reports/release/rollback-report.json": {
      result: "PASS",
      evidenceComplete: true,
      rollbackVerified: true,
      fromReleaseId: "a".repeat(64),
      toReleaseId: "b".repeat(64),
      preRollbackBackup: { verified: true, backupId: "backup" },
      services: {
        originReady: true,
        tunnelRunning: true,
        publicHttpsHealth: "ok",
      },
      liveDataReplaced: false,
    },
  };
  return {
    reports,
    checksums: Object.fromEntries(
      Object.keys(reports).map((path) => [path, "c".repeat(64)]),
    ),
  };
}

describe("Final release report builder", () => {
  it("composes a release recommendation only from complete operational evidence", () => {
    const report = composeFinalReleaseReport(fixture());
    assert.equal(report.releaseRecommendation, "RELEASE");
    assert.equal(report.overallState, "OPERATIONALLY VERIFIED");
    assert.ok(Object.values(report.releaseReadyFormula).every(Boolean));
  });

  it("rejects Windows evidence without a real post-install reboot", () => {
    const input = fixture();
    input.reports[
      "reports/deployment/windows-https-report.json"
    ].rebootVerified = false;
    assert.throws(
      () => composeFinalReleaseReport(input),
      /ReleaseReady formula/u,
    );
  });

  it("rejects a rollback that replaced live data", () => {
    const input = fixture();
    input.reports["reports/release/rollback-report.json"].liveDataReplaced =
      true;
    assert.throws(
      () => composeFinalReleaseReport(input),
      /ReleaseReady formula/u,
    );
  });
});
