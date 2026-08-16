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
import {
  NON_WINDOWS_FINAL_AUDIT_REPORT,
  NON_WINDOWS_SOURCE_REPORTS,
  WINDOWS_OPERATIONAL_EVIDENCE,
} from "./build-non-windows-final-audit.mjs";
import { validatePhase22 } from "./verify-phase22.mjs";
import { validateRelease } from "./verify-release.mjs";

export const PHASE23_EVIDENCE_PATH =
  "artifacts/phase23/final-release-validation.json";

const FILES = Object.freeze({
  release: "scripts/verify-release.mjs",
  builder: "scripts/build-final-release-report.mjs",
  localBuilder: "scripts/build-non-windows-final-audit.mjs",
  localVerifier: "scripts/verify-phase23-local.mjs",
  hygiene: "scripts/verify-completion-hygiene.mjs",
  reports: "scripts/build-release-reports.mjs",
  package: "package.json",
  status: "docs/implementation-status.md",
});

async function source(path) {
  return (await readRepositoryFile(path)).toString("utf8");
}

export function inspectNonWindowsFinalAuditBoundary(input) {
  return {
    explicitScope:
      /NON_WINDOWS_FINAL_AUDIT/u.test(input.localBuilder) &&
      /NOT_RUN_BY_USER_DIRECTION/u.test(input.localBuilder),
    nonReleaseDecision:
      /releaseRecommendation: "HOLD"/u.test(input.localBuilder) &&
      /releaseAllowed: false/u.test(input.localBuilder) &&
      /treatedAsPassing: false/u.test(input.localBuilder),
    exactMissingEvidence:
      /windows-https-report\.json/u.test(input.localBuilder) &&
      /backup-restore-report\.json/u.test(input.localBuilder) &&
      /rollback-report\.json/u.test(input.localBuilder) &&
      /final-verification-report\.json/u.test(input.localBuilder),
    sourceBinding:
      /NON_WINDOWS_SOURCE_REPORTS/u.test(input.localBuilder) &&
      /sha256\(await readRepositoryFile/u.test(input.localBuilder),
    failClosed:
      /Non-Windows final audit formula is not fully satisfied/u.test(
        input.localBuilder,
      ) && /must pass before the audit is built/u.test(input.localBuilder),
    dedicatedVerifier:
      /validatePhase23Local/u.test(input.localVerifier) &&
      /non-windows-final-audit-validation\.json/u.test(input.localVerifier),
  };
}

export function inspectNonWindowsCompletionStatus(status) {
  const phaseSection =
    status.match(
      /### PHASE 23 — Final Non-Windows Audit[\s\S]*?(?=\n### |\n## Phase ledger)/u,
    )?.[0] ?? "";
  return {
    overallState:
      /Overall state: `EXHAUSTIVELY VERIFIED`/u.test(status) &&
      /Completion scope: non-Windows implementation and verification/u.test(
        status,
      ),
    phaseState: /State: `EXHAUSTIVELY VERIFIED`/u.test(phaseSection),
    declaredScopeComplete:
      /declared non-Windows scope is complete and exhaustively verified/iu.test(
        phaseSection,
      ),
    releaseBoundary:
      /canonical release gate intentionally remains red/iu.test(phaseSection) &&
      /not marked `RELEASED`/u.test(phaseSection),
    ledger:
      /\| 23\s+\| EXHAUSTIVELY VERIFIED\s+\| Non-Windows audit complete; canonical release remains HOLD\s+\|/u.test(
        status,
      ),
  };
}

export function inspectFinalReleaseBoundary(input) {
  return {
    exhaustiveEvidence:
      /feature-inventory\.json/u.test(input.release) &&
      /requirement-matrix\.json/u.test(input.release) &&
      /theme-60-report\.json/u.test(input.release) &&
      /layout-element-report\.json/u.test(input.release),
    corpusEvidence:
      /project-corpus-manifest\.json/u.test(input.release) &&
      /project-corpus-results\.json/u.test(input.release) &&
      /project-corpus-performance\.json/u.test(input.release),
    operationsEvidence:
      /windows-https-report\.json/u.test(input.release) &&
      /backup-restore-report\.json/u.test(input.release) &&
      /rollback-report\.json/u.test(input.release) &&
      /final-verification-report\.json/u.test(input.release),
    releaseFormula:
      /verifiedRequirementCount/u.test(input.release) &&
      /criticalDefects/u.test(input.release) &&
      /highDefects/u.test(input.release) &&
      /releaseReadyFormula/u.test(input.release) &&
      /releaseRecommendation/u.test(input.release),
    checksumBinding:
      /sourceReports/u.test(input.release) &&
      /sha256\(await readRepositoryFile/u.test(input.release) &&
      /sourceReports/u.test(input.builder) &&
      /sha256\(await readRepositoryFile/u.test(input.builder),
    finalReportFailClosed:
      /validateRelease\(\{ includeFinalReport: false \}\)/u.test(
        input.builder,
      ) &&
      /preflight\.result !== "PASS"/u.test(input.builder) &&
      /ReleaseReady formula is not fully satisfied/u.test(input.builder) &&
      /finalGate\.result !== "PASS"/u.test(input.builder),
    hygiene:
      /TODO|FIXME|HACK/u.test(input.hygiene) &&
      /skipped|todo|failing/iu.test(input.hygiene),
    generatedReports:
      /validatePhase19/u.test(input.reports) &&
      /validatePhase21/u.test(input.reports) &&
      /validateThemeProvenance/u.test(input.reports),
  };
}

export async function validatePhase23({ includeReleaseEvidence = true } = {}) {
  const validation = new Validation("Phase 23 Final Release Gate");
  const input = Object.fromEntries(
    await Promise.all(
      Object.entries(FILES).map(async ([key, path]) => [
        key,
        await source(path),
      ]),
    ),
  );
  const inspection = inspectFinalReleaseBoundary(input);
  for (const [name, passed] of Object.entries(inspection)) {
    validation.equal(passed, true, `Final release contract: ${name}`);
  }
  const packageJson = JSON.parse(input.package);
  validation.equal(
    packageJson.scripts?.["verify:phase23"],
    "pnpm test && node scripts/verify-phase23.mjs",
    "root exposes the Phase 23 verification gate",
  );
  validation.equal(
    packageJson.scripts?.["build:final-release-report"],
    "node scripts/build-final-release-report.mjs",
    "root exposes the fail-closed final report builder",
  );

  const phase22 = await validatePhase22({
    includeOperationalEvidence: includeReleaseEvidence,
    includePhase21Regression: true,
  });
  validation.equal(
    phase22.result,
    "PASS",
    includeReleaseEvidence
      ? "Phase 22 operational deployment is complete"
      : "Phase 22 implementation preflight is complete",
  );

  let release = null;
  if (includeReleaseEvidence) {
    release = await validateRelease();
    validation.equal(release.result, "PASS", "Final release gate passes");
    validation.check(
      /\| 23\s+\| OPERATIONALLY VERIFIED\s+\|/u.test(input.status),
      "Phase ledger records Phase 23 as OPERATIONALLY VERIFIED",
    );
    validation.check(
      /Overall state: `OPERATIONALLY VERIFIED`/u.test(input.status),
      "Overall implementation state is OPERATIONALLY VERIFIED",
    );
  }

  return validation.result({
    inspection,
    phase22Result: phase22.result,
    releaseResult: release?.result ?? "NOT_RUN",
    releaseAllowed: release?.details?.releaseAllowed ?? false,
  });
}

export async function validatePhase23Local() {
  const validation = new Validation("Phase 23 Non-Windows Final Audit");
  const input = Object.fromEntries(
    await Promise.all(
      Object.entries(FILES).map(async ([key, path]) => [
        key,
        await source(path),
      ]),
    ),
  );
  const boundary = inspectNonWindowsFinalAuditBoundary(input);
  for (const [name, passed] of Object.entries(boundary)) {
    validation.equal(passed, true, `Non-Windows audit contract: ${name}`);
  }
  const completionStatus = inspectNonWindowsCompletionStatus(input.status);
  for (const [name, passed] of Object.entries(completionStatus)) {
    validation.equal(passed, true, `Non-Windows completion status: ${name}`);
  }

  const packageJson = JSON.parse(input.package);
  validation.equal(
    packageJson.scripts?.["build:non-windows-final-audit"],
    "node scripts/build-non-windows-final-audit.mjs",
    "root exposes the non-Windows final audit builder",
  );
  validation.equal(
    packageJson.scripts?.["verify:phase23:local"],
    "node scripts/verify-phase23-local.mjs",
    "root exposes the scoped Phase 23 verifier",
  );

  const preflight = await validatePhase23({ includeReleaseEvidence: false });
  validation.equal(
    preflight.result,
    "PASS",
    "Phase 23 source and Phase 22 implementation preflight pass",
  );

  const reportExists = await pathExists(NON_WINDOWS_FINAL_AUDIT_REPORT);
  validation.equal(reportExists, true, "Non-Windows final audit report exists");
  let report = null;
  if (reportExists) {
    report = await readJson(NON_WINDOWS_FINAL_AUDIT_REPORT);
    validation.equal(report.result, "PASS", "Non-Windows audit passes");
    validation.equal(
      report.evidenceComplete,
      true,
      "Non-Windows audit evidence is complete for its declared scope",
    );
    validation.equal(
      report.scope,
      "NON_WINDOWS_FINAL_AUDIT",
      "Audit scope is explicit",
    );
    validation.equal(
      report.overallState,
      "EXHAUSTIVELY VERIFIED",
      "Non-Windows scope reaches exhaustive verification",
    );
    validation.equal(
      report.releaseRecommendation,
      "HOLD",
      "Audit holds the release without Windows evidence",
    );
    validation.equal(
      report.releaseAllowed,
      false,
      "Audit does not authorize a release",
    );
    validation.equal(
      report.windowsDeployment?.status,
      "NOT_RUN_BY_USER_DIRECTION",
      "Windows deployment is recorded as not run",
    );
    validation.equal(
      report.windowsDeployment?.requiredForRelease,
      true,
      "Windows evidence remains required for release",
    );
    validation.equal(
      report.windowsDeployment?.treatedAsPassing,
      false,
      "Skipped Windows work is not treated as passing",
    );
    validation.equal(
      JSON.stringify(report.missingOperationalEvidence),
      JSON.stringify(WINDOWS_OPERATIONAL_EVIDENCE),
      "Missing operational evidence inventory is exact",
    );
    validation.equal(
      report.criticalDefects,
      0,
      "Tested scope has zero critical defects",
    );
    validation.equal(
      report.highDefects,
      0,
      "Tested scope has zero high defects",
    );
    validation.check(
      Object.values(report.nonWindowsAuditFormula ?? {}).every(Boolean),
      "Every non-Windows audit formula term passes",
    );
    for (const path of NON_WINDOWS_SOURCE_REPORTS) {
      validation.equal(
        report.sourceReports?.[path]?.sha256,
        sha256(await readRepositoryFile(path)),
        `Non-Windows audit checksum matches ${path}`,
      );
    }
  }

  validation.check(
    /Phase 22 retained implementation baseline/u.test(input.status) &&
      /State: `IMPLEMENTED`/u.test(input.status),
    "Phase 22 is implementation-complete without an operational claim",
  );

  return validation.result({
    boundary,
    completionStatus,
    report: report
      ? {
          scope: report.scope,
          releaseRecommendation: report.releaseRecommendation,
          releaseAllowed: report.releaseAllowed,
          windowsStatus: report.windowsDeployment?.status,
        }
      : null,
  });
}

async function main() {
  try {
    await finishVerification(PHASE23_EVIDENCE_PATH, await validatePhase23());
  } catch (error) {
    await finishVerification(
      PHASE23_EVIDENCE_PATH,
      unexpectedFailure("Phase 23 Final Release Gate", error),
    );
  }
}

if (isMainModule(import.meta.url)) await main();
