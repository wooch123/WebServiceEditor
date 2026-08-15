import {
  Validation,
  finishVerification,
  isMainModule,
  pathExists,
  readJson,
  unexpectedFailure,
} from "./lib/verification.mjs";
import { validateCorpus } from "./verify-corpus.mjs";
import { validatePhase0 } from "./verify-phase0.mjs";
import { validateThemes } from "./verify-themes.mjs";

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

export async function validateRelease() {
  const validation = new Validation("Final release gate");
  const baselineReports = await Promise.all([
    validatePhase0(),
    validateThemes(),
    validateCorpus(),
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
  for (const path of REQUIRED_LATER_EVIDENCE) {
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
  }

  return validation.result({
    releaseAllowed: validation.failures.length === 0,
    baseline: Object.fromEntries(
      baselineReports.map((report) => [report.subject, report.result]),
    ),
    requiredLaterEvidence: REQUIRED_LATER_EVIDENCE,
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
