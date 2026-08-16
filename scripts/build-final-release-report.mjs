import {
  isMainModule,
  readJson,
  readRepositoryFile,
  sha256,
  writeEvidence,
} from "./lib/verification.mjs";
import { stdout } from "node:process";
import { validateRelease } from "./verify-release.mjs";

export const FINAL_RELEASE_REPORT =
  "reports/release/final-verification-report.json";

const INPUT_REPORTS = Object.freeze([
  "reports/exhaustive/feature-inventory.json",
  "reports/exhaustive/requirement-matrix.json",
  "reports/exhaustive/theme-60-report.json",
  "reports/exhaustive/layout-element-report.json",
  "reports/corpus/project-corpus-manifest.json",
  "reports/corpus/project-corpus-results.json",
  "reports/corpus/project-corpus-performance.json",
  "reports/deployment/windows-https-report.json",
  "reports/recovery/backup-restore-report.json",
  "reports/release/rollback-report.json",
]);

export function composeFinalReleaseReport({ reports, checksums }) {
  const requirement = reports["reports/exhaustive/requirement-matrix.json"];
  const inventory = reports["reports/exhaustive/feature-inventory.json"];
  const themes = reports["reports/exhaustive/theme-60-report.json"];
  const corpus = reports["reports/corpus/project-corpus-results.json"];
  const performance = reports["reports/corpus/project-corpus-performance.json"];
  const deployment = reports["reports/deployment/windows-https-report.json"];
  const recovery = reports["reports/recovery/backup-restore-report.json"];
  const rollback = reports["reports/release/rollback-report.json"];
  const releaseReadyFormula = {
    requirements:
      requirement.summary.total === 37 &&
      requirement.summary.verified === 37 &&
      requirement.summary.failed === 0 &&
      requirement.summary.skipped === 0,
    inventory:
      inventory.summary.required > 0 &&
      inventory.summary.verified === inventory.summary.required &&
      inventory.summary.failed === 0 &&
      inventory.summary.blocked === 0 &&
      inventory.summary.skipped === 0,
    themes:
      themes.summary.total === 60 &&
      themes.summary.passed === 60 &&
      themes.summary.failed === 0,
    corpus:
      corpus.summary.total === 100 &&
      corpus.summary.passed === 100 &&
      corpus.summary.failed === 0 &&
      corpus.summary.skipped === 0 &&
      corpus.summary.crossProjectLeaks === 0 &&
      corpus.summary.orphanRecordsOrFiles === 0 &&
      corpus.summary.criticalConsoleErrors === 0,
    performance: performance.summary.failed === 0,
    windows:
      deployment.result === "PASS" &&
      deployment.evidenceComplete === true &&
      deployment.rebootVerified === true &&
      deployment.origin?.loopbackOnly === true &&
      deployment.origin?.ready === "ready" &&
      deployment.https?.hostname === "webeditor.dove9999.com",
    recovery:
      recovery.result === "PASS" &&
      recovery.evidenceComplete === true &&
      recovery.backup?.result === "PASS" &&
      recovery.restoreDrill?.result === "PASS",
    rollback:
      rollback.result === "PASS" &&
      rollback.evidenceComplete === true &&
      rollback.rollbackVerified === true &&
      rollback.preRollbackBackup?.verified === true &&
      rollback.services?.originReady === true &&
      rollback.services?.tunnelRunning === true &&
      rollback.services?.publicHttpsHealth === "ok" &&
      rollback.liveDataReplaced === false,
  };
  if (!Object.values(releaseReadyFormula).every(Boolean)) {
    throw new Error("ReleaseReady formula is not fully satisfied");
  }
  return {
    result: "PASS",
    evidenceComplete: true,
    overallState: "OPERATIONALLY VERIFIED",
    releaseRecommendation: "RELEASE",
    criticalDefects: 0,
    highDefects: 0,
    releaseReadyFormula,
    summary: {
      requirements: 37,
      inventoryItems: inventory.summary.required,
      canonicalThemes: 60,
      corpusProjects: 100,
      windowsRebootVerified: true,
      backupRestoreVerified: true,
      rollbackVerified: true,
    },
    deployment: {
      host: deployment.host,
      publicOrigin: deployment.publicOrigin,
      rebootVerified: deployment.rebootVerified,
    },
    rollback: {
      fromReleaseId: rollback.fromReleaseId,
      toReleaseId: rollback.toReleaseId,
      backupId: rollback.preRollbackBackup.backupId,
    },
    sourceReports: Object.fromEntries(
      INPUT_REPORTS.map((path) => [path, { sha256: checksums[path] }]),
    ),
    residualRisks: [],
    approvalBasis: {
      automatedGate: "PASS",
      windowsOperationalEvidence: "PASS",
      recoveryEvidence: "PASS",
      rollbackEvidence: "PASS",
    },
  };
}

export async function buildFinalReleaseReport() {
  const preflight = await validateRelease({ includeFinalReport: false });
  if (preflight.result !== "PASS") {
    throw new Error(
      `Final release preflight failed with ${String(preflight.failureCount)} failure(s)`,
    );
  }
  const entries = await Promise.all(
    INPUT_REPORTS.map(async (path) => [
      path,
      await readJson(path),
      sha256(await readRepositoryFile(path)),
    ]),
  );
  const reports = Object.fromEntries(
    entries.map(([path, report]) => [path, report]),
  );
  const checksums = Object.fromEntries(
    entries.map(([path, , checksum]) => [path, checksum]),
  );
  await writeEvidence(
    FINAL_RELEASE_REPORT,
    composeFinalReleaseReport({ reports, checksums }),
  );
  const finalGate = await validateRelease();
  if (finalGate.result !== "PASS") {
    throw new Error(
      "Final release report did not pass the complete release gate",
    );
  }
  return FINAL_RELEASE_REPORT;
}

if (isMainModule(import.meta.url)) {
  stdout.write(`${await buildFinalReleaseReport()}\n`);
}
