import {
  Validation,
  finishVerification,
  isMainModule,
  pathExists,
  readJson,
  readRepositoryFile,
  sha256,
  unexpectedFailure,
} from "./lib/verification.mjs";
import { validateCorpus } from "./verify-corpus.mjs";
import { validateCompletionHygiene } from "./verify-completion-hygiene.mjs";
import { validatePhase0 } from "./verify-phase0.mjs";
import { validatePhase19 } from "./verify-phase19.mjs";
import { validatePhase21 } from "./verify-phase21.mjs";
import { validatePhase22 } from "./verify-phase22.mjs";
import { validateThemes } from "./verify-themes.mjs";
import { validateThemeProvenance } from "./verify-theme-provenance.mjs";

const REQUIRED_LATER_EVIDENCE = Object.freeze([
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
  "reports/release/final-verification-report.json",
]);

const VERIFIED_STATES = new Set([
  "VERIFIED",
  "EXHAUSTIVELY VERIFIED",
  "OPERATIONALLY VERIFIED",
  "RELEASED",
]);

function validateEvidenceEnvelope(validation, path, evidence) {
  validation.equal(evidence?.result, "PASS", `${path} result is PASS`);
  validation.equal(
    evidence?.evidenceComplete,
    true,
    `${path} evidence is complete`,
  );
  validation.check(
    typeof evidence?.schemaVersion === "number" ||
      typeof evidence?.schemaVersion === "string",
    `${path} declares a schema version`,
  );
}

export async function validateRelease({ includeFinalReport = true } = {}) {
  const validation = new Validation("Final release gate");
  const baselineReports = await Promise.all([
    validatePhase0(),
    validateThemes(),
    validateCorpus(),
    validateThemeProvenance(),
    validateCompletionHygiene(),
    validatePhase19(),
    validatePhase21(),
    validatePhase22(),
  ]);
  for (const report of baselineReports) {
    validation.equal(
      report.result,
      "PASS",
      `${report.subject} is currently valid`,
    );
  }

  const traceability = await readJson("docs/requirement-traceability.json");
  const requirements = Array.isArray(traceability.requirements)
    ? traceability.requirements
    : [];
  validation.equal(
    requirements.length,
    37,
    "Release traceability has exactly 37 requirements",
  );
  for (const requirement of requirements) {
    validation.check(
      VERIFIED_STATES.has(requirement.status),
      `${requirement.id} reached at least VERIFIED`,
      { status: requirement.status },
    );
    for (const field of ["implementation", "tests", "evidence"]) {
      validation.check(
        Array.isArray(requirement[field]) && requirement[field].length > 0,
        `${requirement.id}.${field} contains release evidence`,
      );
    }
  }

  const evidenceReports = {};
  const requiredEvidence = REQUIRED_LATER_EVIDENCE.filter(
    (path) =>
      includeFinalReport ||
      path !== "reports/release/final-verification-report.json",
  );
  for (const path of requiredEvidence) {
    const exists = await pathExists(path);
    validation.check(exists, `${path} exists`);
    if (exists) {
      try {
        const evidence = await readJson(path);
        evidenceReports[path] = evidence;
        validateEvidenceEnvelope(validation, path, evidence);
      } catch (error) {
        validation.check(false, `${path} is readable JSON`, {
          error: error.message,
        });
      }
    }
  }

  const requirementReport =
    evidenceReports["reports/exhaustive/requirement-matrix.json"];
  if (requirementReport) {
    validation.equal(
      requirementReport.summary?.total,
      37,
      "Requirement report covers 37 requirements",
    );
    validation.equal(
      requirementReport.summary?.verified,
      37,
      "Requirement report verifies all 37 requirements",
    );
    validation.equal(
      requirementReport.summary?.failed,
      0,
      "Requirement report has zero failures",
    );
    validation.equal(
      requirementReport.summary?.skipped,
      0,
      "Requirement report has zero skips",
    );
  }

  const inventoryReport =
    evidenceReports["reports/exhaustive/feature-inventory.json"];
  if (inventoryReport) {
    validation.check(
      Number.isInteger(inventoryReport.summary?.required) &&
        inventoryReport.summary.required > 0,
      "Feature inventory declares a non-zero required inventory",
    );
    validation.equal(
      inventoryReport.summary?.verified,
      inventoryReport.summary?.required,
      "Every required inventory item is verified",
    );
    for (const field of [
      "unverified",
      "failed",
      "blocked",
      "skipped",
      "todo",
      "expectedFailures",
    ]) {
      validation.equal(
        inventoryReport.summary?.[field],
        0,
        `Feature inventory ${field} is zero`,
      );
    }
  }

  const themeReport =
    evidenceReports["reports/exhaustive/theme-60-report.json"];
  if (themeReport) {
    validation.equal(
      themeReport.summary?.total,
      60,
      "Theme report contains 60 themes",
    );
    validation.equal(
      themeReport.summary?.passed,
      60,
      "Theme report passes 60 themes",
    );
    validation.equal(
      themeReport.summary?.failed,
      0,
      "Theme report has zero failures",
    );
    validation.equal(
      themeReport.summary?.skipped,
      0,
      "Theme report has zero skips",
    );
  }

  const corpusReport =
    evidenceReports["reports/corpus/project-corpus-results.json"];
  if (corpusReport) {
    validation.equal(
      corpusReport.summary?.total,
      100,
      "Corpus report contains 100 projects",
    );
    validation.equal(
      corpusReport.summary?.passed,
      100,
      "Corpus report passes 100 projects",
    );
    for (const field of [
      "failed",
      "skipped",
      "crossProjectLeaks",
      "orphanRecordsOrFiles",
      "criticalConsoleErrors",
    ]) {
      validation.equal(
        corpusReport.summary?.[field],
        0,
        `Corpus report ${field} is zero`,
      );
    }
  }

  const layoutReport =
    evidenceReports["reports/exhaustive/layout-element-report.json"];
  if (layoutReport) {
    validation.equal(
      layoutReport.summary?.layoutPresetTotal,
      22,
      "Layout report contains 22 presets",
    );
    validation.equal(
      layoutReport.summary?.layoutPresetPassed,
      22,
      "Layout report passes all 22 presets",
    );
    validation.equal(
      layoutReport.summary?.elementTotal,
      55,
      "Element report contains 55 elements",
    );
    validation.equal(
      layoutReport.summary?.elementPassed,
      55,
      "Element report passes all 55 elements",
    );
    validation.equal(
      layoutReport.summary?.failed,
      0,
      "Layout report has zero failures",
    );
    validation.equal(
      layoutReport.summary?.skipped,
      0,
      "Layout report has zero skips",
    );
  }

  const performanceReport =
    evidenceReports["reports/corpus/project-corpus-performance.json"];
  if (performanceReport) {
    validation.check(
      Number.isInteger(performanceReport.summary?.metricCount) &&
        performanceReport.summary.metricCount > 0,
      "Corpus performance report contains measured metrics",
    );
    validation.equal(
      performanceReport.summary?.passed,
      performanceReport.summary?.metricCount,
      "Every corpus performance metric passes",
    );
    validation.equal(
      performanceReport.summary?.failed,
      0,
      "Corpus performance report has zero failures",
    );
  }

  const rollbackReport =
    evidenceReports["reports/release/rollback-report.json"];
  if (rollbackReport) {
    validation.equal(
      rollbackReport.rollbackVerified,
      true,
      "Rollback report proves the release swap",
    );
    validation.check(
      /^[a-f0-9]{64}$/u.test(rollbackReport.fromReleaseId) &&
        /^[a-f0-9]{64}$/u.test(rollbackReport.toReleaseId) &&
        rollbackReport.fromReleaseId !== rollbackReport.toReleaseId,
      "Rollback report identifies two distinct releases",
    );
    validation.equal(
      rollbackReport.metadata?.applicationIdValid,
      true,
      "Rollback metadata application ID is valid",
    );
    validation.equal(
      rollbackReport.metadata?.quickCheck,
      "ok",
      "Rollback metadata quick_check passes",
    );
    validation.check(
      Number.isInteger(rollbackReport.metadata?.userVersion) &&
        rollbackReport.metadata.userVersion <=
          rollbackReport.metadata?.supportedSchemaVersion,
      "Rollback release supports the live metadata schema",
    );
    validation.equal(
      rollbackReport.preRollbackBackup?.verified,
      true,
      "Rollback report proves its pre-swap backup",
    );
    validation.equal(
      rollbackReport.services?.originReady,
      true,
      "Rollback origin reached Ready",
    );
    validation.equal(
      rollbackReport.services?.tunnelRunning,
      true,
      "Rollback Tunnel restarted",
    );
    validation.equal(
      rollbackReport.services?.publicHttpsHealth,
      "ok",
      "Rollback public HTTPS health passes",
    );
    validation.equal(
      rollbackReport.previousInstallPreserved,
      true,
      "Rollback preserved the replaced release",
    );
    validation.equal(
      rollbackReport.liveDataReplaced,
      false,
      "Rollback did not replace live data",
    );
  }

  const finalReport =
    evidenceReports["reports/release/final-verification-report.json"];
  if (finalReport) {
    validation.check(
      ["OPERATIONALLY VERIFIED", "RELEASED"].includes(finalReport.overallState),
      "Final report reached OPERATIONALLY VERIFIED or RELEASED",
      { overallState: finalReport.overallState },
    );
    validation.equal(
      finalReport.releaseRecommendation,
      "RELEASE",
      "Final report recommends release",
    );
    validation.equal(
      finalReport.criticalDefects,
      0,
      "Final report has zero critical defects",
    );
    validation.equal(
      finalReport.highDefects,
      0,
      "Final report has zero high defects",
    );
    validation.check(
      finalReport.releaseReadyFormula !== null &&
        typeof finalReport.releaseReadyFormula === "object" &&
        Object.values(finalReport.releaseReadyFormula).length > 0 &&
        Object.values(finalReport.releaseReadyFormula).every(Boolean),
      "Final ReleaseReady formula is fully satisfied",
    );
    const sourceEntries = Object.entries(finalReport.sourceReports ?? {});
    validation.equal(
      sourceEntries.length,
      REQUIRED_LATER_EVIDENCE.length - 1,
      "Final report binds every prerequisite report",
    );
    for (const path of REQUIRED_LATER_EVIDENCE.filter(
      (candidate) =>
        candidate !== "reports/release/final-verification-report.json",
    )) {
      validation.check(
        Object.hasOwn(finalReport.sourceReports ?? {}, path),
        `Final report includes prerequisite checksum: ${path}`,
      );
    }
    for (const [path, binding] of sourceEntries) {
      const exists = await pathExists(path);
      validation.check(exists, `Final report source exists: ${path}`);
      if (exists) {
        validation.equal(
          binding?.sha256,
          sha256(await readRepositoryFile(path)),
          `Final report source checksum matches: ${path}`,
        );
      }
    }
  }

  return validation.result({
    releaseAllowed: validation.failures.length === 0,
    baseline: Object.fromEntries(
      baselineReports.map((report) => [report.subject, report.result]),
    ),
    requiredLaterEvidence: requiredEvidence,
    presentLaterEvidence: Object.keys(evidenceReports),
    verifiedRequirementCount: requirements.filter((requirement) =>
      VERIFIED_STATES.has(requirement.status),
    ).length,
  });
}

async function main() {
  try {
    await finishVerification(
      "artifacts/release/release-gate.json",
      await validateRelease(),
    );
  } catch (error) {
    await finishVerification(
      "artifacts/release/release-gate.json",
      unexpectedFailure("Final release gate", error),
    );
  }
}

if (isMainModule(import.meta.url)) {
  await main();
}
