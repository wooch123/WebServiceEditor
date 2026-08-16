import { stdout } from "node:process";

import {
  isMainModule,
  readJson,
  readRepositoryFile,
  sha256,
  writeEvidence,
} from "./lib/verification.mjs";
import { validateCorpus } from "./verify-corpus.mjs";
import { validateCompletionHygiene } from "./verify-completion-hygiene.mjs";
import { validatePhase0 } from "./verify-phase0.mjs";
import { validatePhase19 } from "./verify-phase19.mjs";
import { validatePhase21 } from "./verify-phase21.mjs";
import { validatePhase22 } from "./verify-phase22.mjs";
import { validateThemes } from "./verify-themes.mjs";
import { validateThemeProvenance } from "./verify-theme-provenance.mjs";

export const NON_WINDOWS_FINAL_AUDIT_REPORT =
  "reports/release/non-windows-final-audit.json";

export const NON_WINDOWS_SOURCE_REPORTS = Object.freeze([
  "reports/exhaustive/feature-inventory.json",
  "reports/exhaustive/requirement-matrix.json",
  "reports/exhaustive/theme-60-report.json",
  "reports/exhaustive/layout-element-report.json",
  "reports/corpus/project-corpus-manifest.json",
  "reports/corpus/project-corpus-results.json",
  "reports/corpus/project-corpus-performance.json",
]);

export const WINDOWS_OPERATIONAL_EVIDENCE = Object.freeze([
  "reports/deployment/windows-https-report.json",
  "reports/recovery/backup-restore-report.json",
  "reports/release/rollback-report.json",
  "reports/release/final-verification-report.json",
]);

function hasPassingEnvelope(report) {
  return report?.result === "PASS" && report?.evidenceComplete === true;
}

export function composeNonWindowsFinalAudit({ reports, checksums }) {
  const requirement = reports[NON_WINDOWS_SOURCE_REPORTS[1]];
  const inventory = reports[NON_WINDOWS_SOURCE_REPORTS[0]];
  const themes = reports[NON_WINDOWS_SOURCE_REPORTS[2]];
  const layoutElements = reports[NON_WINDOWS_SOURCE_REPORTS[3]];
  const corpus = reports[NON_WINDOWS_SOURCE_REPORTS[5]];
  const performance = reports[NON_WINDOWS_SOURCE_REPORTS[6]];
  const reportEnvelopes = NON_WINDOWS_SOURCE_REPORTS.every((path) =>
    hasPassingEnvelope(reports[path]),
  );
  const nonWindowsAuditFormula = {
    reportEnvelopes,
    requirements:
      requirement?.summary?.total === 37 &&
      requirement?.summary?.verified === 37 &&
      requirement?.summary?.failed === 0 &&
      requirement?.summary?.skipped === 0,
    inventory:
      inventory?.summary?.required > 0 &&
      inventory?.summary?.verified === inventory?.summary?.required &&
      inventory?.summary?.failed === 0 &&
      inventory?.summary?.blocked === 0 &&
      inventory?.summary?.skipped === 0,
    themes:
      themes?.summary?.total === 60 &&
      themes?.summary?.passed === 60 &&
      themes?.summary?.failed === 0,
    canonicalInventory:
      layoutElements?.summary?.layoutPresetTotal === 22 &&
      layoutElements?.summary?.layoutPresetPassed === 22 &&
      layoutElements?.summary?.elementTotal === 55 &&
      layoutElements?.summary?.elementPassed === 55 &&
      layoutElements?.summary?.failed === 0,
    corpus:
      corpus?.summary?.total === 100 &&
      corpus?.summary?.passed === 100 &&
      corpus?.summary?.failed === 0 &&
      corpus?.summary?.blocked === 0 &&
      corpus?.summary?.skipped === 0 &&
      corpus?.summary?.crossProjectLeaks === 0 &&
      corpus?.summary?.orphanRecordsOrFiles === 0 &&
      corpus?.summary?.criticalConsoleErrors === 0,
    performance:
      performance?.summary?.metricCount > 0 &&
      performance?.summary?.passed === performance?.summary?.metricCount &&
      performance?.summary?.failed === 0,
  };
  if (!Object.values(nonWindowsAuditFormula).every(Boolean)) {
    throw new Error("Non-Windows final audit formula is not fully satisfied");
  }
  return {
    result: "PASS",
    evidenceComplete: true,
    scope: "NON_WINDOWS_FINAL_AUDIT",
    overallState: "EXHAUSTIVELY VERIFIED",
    releaseRecommendation: "HOLD",
    releaseAllowed: false,
    criticalDefects: 0,
    highDefects: 0,
    nonWindowsAuditFormula,
    windowsDeployment: {
      status: "NOT_RUN_BY_USER_DIRECTION",
      requiredForRelease: true,
      treatedAsPassing: false,
    },
    missingOperationalEvidence: [...WINDOWS_OPERATIONAL_EVIDENCE],
    summary: {
      requirements: 37,
      inventoryItems: inventory.summary.required,
      canonicalThemes: 60,
      selectableThemes: themes.summary.selectableTotal,
      layoutPresets: 22,
      elementTypes: 55,
      corpusProjects: 100,
    },
    sourceReports: Object.fromEntries(
      NON_WINDOWS_SOURCE_REPORTS.map((path) => [
        path,
        { sha256: checksums[path] },
      ]),
    ),
    residualRisks: [
      "Windows install, reboot, service recovery, backup/restore, and rollback were not executed.",
      "The canonical final release report cannot be produced until all operational evidence passes.",
    ],
    approvalBasis: {
      nonWindowsAutomatedGate: "PASS",
      windowsOperationalEvidence: "NOT_RUN",
      recoveryEvidence: "NOT_RUN",
      rollbackEvidence: "NOT_RUN",
      finalReleaseGate: "HOLD",
    },
  };
}

export async function buildNonWindowsFinalAudit() {
  const baselineReports = await Promise.all([
    validatePhase0(),
    validateThemes(),
    validateCorpus(),
    validateThemeProvenance(),
    validateCompletionHygiene(),
    validatePhase19(),
    validatePhase21(),
    validatePhase22({
      includeOperationalEvidence: false,
      includePhase21Regression: false,
    }),
  ]);
  for (const report of baselineReports) {
    if (report.result !== "PASS") {
      throw new Error(`${report.subject} must pass before the audit is built`);
    }
  }
  const entries = await Promise.all(
    NON_WINDOWS_SOURCE_REPORTS.map(async (path) => [
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
    NON_WINDOWS_FINAL_AUDIT_REPORT,
    composeNonWindowsFinalAudit({ reports, checksums }),
  );
  return NON_WINDOWS_FINAL_AUDIT_REPORT;
}

if (isMainModule(import.meta.url)) {
  stdout.write(`${await buildNonWindowsFinalAudit()}\n`);
}
