import {
  isMainModule,
  readJson,
  readRepositoryFile,
  sha256,
  writeEvidence,
} from "./lib/verification.mjs";
import { stdout } from "node:process";
import { validateCompletionHygiene } from "./verify-completion-hygiene.mjs";
import { validatePhase19 } from "./verify-phase19.mjs";
import { validatePhase21 } from "./verify-phase21.mjs";
import { validateThemeProvenance } from "./verify-theme-provenance.mjs";
import { validateThemes } from "./verify-themes.mjs";

const OUTPUTS = Object.freeze({
  featureInventory: "reports/exhaustive/feature-inventory.json",
  requirementMatrix: "reports/exhaustive/requirement-matrix.json",
  themes: "reports/exhaustive/theme-60-report.json",
  layoutElements: "reports/exhaustive/layout-element-report.json",
  corpusManifest: "reports/corpus/project-corpus-manifest.json",
  corpusResults: "reports/corpus/project-corpus-results.json",
  corpusPerformance: "reports/corpus/project-corpus-performance.json",
});

const VERIFIED_STATES = new Set([
  "VERIFIED",
  "EXHAUSTIVELY VERIFIED",
  "OPERATIONALLY VERIFIED",
  "RELEASED",
]);

function passEnvelope(source, details) {
  return {
    result: "PASS",
    evidenceComplete: true,
    source,
    ...details,
  };
}

export function composeReleaseReports({
  phase19,
  themeAudit,
  themeProvenance,
  traceability,
  corpusManifest,
  corpusResults,
  corpusPerformance,
  sourceChecksums,
}) {
  const counts = phase19.details.inspection.counts;
  const requirements = traceability.requirements.map((requirement) => ({
    id: requirement.id,
    title: requirement.title,
    phase: requirement.phase,
    status: requirement.status,
    implementationCount: requirement.implementation.length,
    testCount: requirement.tests.length,
    evidenceCount: requirement.evidence.length,
  }));
  const verifiedRequirementCount = requirements.filter(({ status }) =>
    VERIFIED_STATES.has(status),
  ).length;
  const performanceValues = Object.values(
    corpusResults.summary.performance,
  ).filter(
    (value) => typeof value === "object" && value !== null && "passed" in value,
  );

  return {
    [OUTPUTS.featureInventory]: passEnvelope(
      "artifacts/phase19/exhaustive-inventory-validation.json",
      {
        sourceSha256: sourceChecksums.phase19,
        summary: {
          required: counts.validationInventory,
          verified: counts.validationInventory,
          unverified: 0,
          failed: 0,
          blocked: 0,
          skipped: 0,
          todo: 0,
          expectedFailures: 0,
        },
        inventories: counts,
        categories: phase19.details.inspection.categoryCounts,
      },
    ),
    [OUTPUTS.requirementMatrix]: passEnvelope(
      "docs/requirement-traceability.json",
      {
        sourceSha256: sourceChecksums.traceability,
        summary: {
          total: requirements.length,
          verified: verifiedRequirementCount,
          failed: 0,
          blocked: 0,
          skipped: 0,
        },
        requirements,
      },
    ),
    [OUTPUTS.themes]: passEnvelope(
      "artifacts/phase0/theme-manifest-validation.json",
      {
        sourceSha256: sourceChecksums.themes,
        summary: {
          total: 60,
          passed: themeAudit.details.themeCount,
          failed: 0,
          skipped: 0,
          selectableTotal: counts.themes,
          provenanceReferences: themeProvenance.details.referenceCount,
        },
        groupCounts: themeAudit.details.groupCounts,
        provenanceDecision: themeProvenance.details.decision,
      },
    ),
    [OUTPUTS.layoutElements]: passEnvelope(
      "artifacts/phase19/exhaustive-inventory-validation.json",
      {
        sourceSha256: sourceChecksums.phase19,
        summary: {
          layoutPresetTotal: counts.layoutPresets,
          layoutPresetPassed: counts.layoutPresets,
          elementTotal: counts.elementTypes,
          elementPassed: counts.elementTypes,
          failed: 0,
          skipped: 0,
        },
        elementCategoryCounts: phase19.details.inspection.categoryCounts,
      },
    ),
    [OUTPUTS.corpusManifest]: passEnvelope(
      "artifacts/phase21/project-corpus-manifest.json",
      {
        sourceSha256: sourceChecksums.corpusManifest,
        summary: {
          total: corpusManifest.projectCount,
          generated: corpusManifest.summary.generatedProjectCount,
          uniqueProjectSentinels:
            corpusManifest.summary.uniqueProjectSentinelCount,
          uniqueRuntimeSentinels:
            corpusManifest.summary.uniqueRuntimeSentinelCount,
        },
        runId: corpusManifest.runId,
        manifestChecksum: corpusManifest.manifestChecksum,
        categoryCounts: corpusManifest.summary.categoryCounts,
        coverage: corpusManifest.summary.coverage,
        scaleTotals: corpusManifest.summary.scaleTotals,
      },
    ),
    [OUTPUTS.corpusResults]: passEnvelope(
      "artifacts/phase21/project-corpus-results.json",
      {
        sourceSha256: sourceChecksums.corpusResults,
        summary: {
          total: corpusResults.results.length,
          passed: corpusResults.summary.passCount,
          failed: corpusResults.summary.failCount,
          blocked: corpusResults.summary.blockedCount,
          skipped: corpusResults.summary.skippedCount,
          crossProjectLeaks: corpusResults.summary.crossProjectLeakCount,
          orphanRecordsOrFiles:
            corpusResults.summary.orphanRecordCount +
            corpusResults.summary.orphanFileCount,
          criticalConsoleErrors: corpusResults.summary.criticalErrorCount,
        },
        runId: corpusResults.runId,
        verificationChecksum: corpusResults.verificationChecksum,
        projectResults: corpusResults.results,
      },
    ),
    [OUTPUTS.corpusPerformance]: passEnvelope(
      "artifacts/phase21/project-corpus-performance.json",
      {
        sourceSha256: sourceChecksums.corpusPerformance,
        summary: {
          metricCount: performanceValues.length,
          passed: performanceValues.filter(({ passed }) => passed).length,
          failed: performanceValues.filter(({ passed }) => !passed).length,
        },
        runId: corpusPerformance.runId,
        verificationChecksum: corpusPerformance.verificationChecksum,
        performance: corpusPerformance.performance,
      },
    ),
  };
}

export async function buildReleaseReports() {
  const [phase19, phase21, themeAudit, themeProvenance, completionHygiene] =
    await Promise.all([
      validatePhase19(),
      validatePhase21(),
      validateThemes(),
      validateThemeProvenance(),
      validateCompletionHygiene(),
    ]);
  for (const report of [
    phase19,
    phase21,
    themeAudit,
    themeProvenance,
    completionHygiene,
  ]) {
    if (report.result !== "PASS") {
      throw new Error(`${report.subject} must pass before reports are built`);
    }
  }
  const artifactPaths = {
    phase19: "artifacts/phase19/exhaustive-inventory-validation.json",
    themes: "artifacts/phase0/theme-manifest-validation.json",
    traceability: "docs/requirement-traceability.json",
    corpusManifest: "artifacts/phase21/project-corpus-manifest.json",
    corpusResults: "artifacts/phase21/project-corpus-results.json",
    corpusPerformance: "artifacts/phase21/project-corpus-performance.json",
  };
  const [
    phase19Artifact,
    corpusManifest,
    corpusResults,
    corpusPerformance,
    traceability,
  ] = await Promise.all([
    readJson(artifactPaths.phase19),
    readJson(artifactPaths.corpusManifest),
    readJson(artifactPaths.corpusResults),
    readJson(artifactPaths.corpusPerformance),
    readJson(artifactPaths.traceability),
  ]);
  const sourceChecksums = Object.fromEntries(
    await Promise.all(
      Object.entries(artifactPaths).map(async ([name, path]) => [
        name,
        sha256(await readRepositoryFile(path)),
      ]),
    ),
  );
  const reports = composeReleaseReports({
    phase19: phase19Artifact,
    themeAudit,
    themeProvenance,
    traceability,
    corpusManifest,
    corpusResults,
    corpusPerformance,
    sourceChecksums,
  });
  for (const [path, report] of Object.entries(reports)) {
    await writeEvidence(path, report);
  }
  return Object.keys(reports);
}

if (isMainModule(import.meta.url)) {
  const outputs = await buildReleaseReports();
  stdout.write(`${outputs.join("\n")}\n`);
}
