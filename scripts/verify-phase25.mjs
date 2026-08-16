import {
  Validation,
  finishVerification,
  isMainModule,
  pathExists,
  readJson,
  readRepositoryFile,
  unexpectedFailure,
} from "./lib/verification.mjs";

export const PHASE25_EVIDENCE_PATH =
  "artifacts/phase25/reference-applications-validation.json";
export const PHASE25_BROWSER_EVIDENCE_PATH =
  "artifacts/phase25/browser-reference-applications-validation.json";

const FILES = Object.freeze({
  adr: "docs/adr/0024-reference-applications-and-real-data.md",
  domain: "packages/domain/src/project-corpus.ts",
  service: "apps/server/src/project-corpus/reference-applications-service.ts",
  routes: "apps/server/src/routes/project-corpus.ts",
  integration: "apps/server/test/integration/reference-applications.test.ts",
  home: "apps/web/src/features/projects/ProjectHome.tsx",
  homeTest: "apps/web/src/App.test.tsx",
  styles: "apps/web/src/styles.css",
  status: "docs/implementation-status.md",
  traceability: "docs/requirement-traceability.json",
});

const EXPECTED_SLUGS = Object.freeze([
  "sample-semiconductor-yield",
  "sample-commerce-operations",
  "sample-personal-blog",
  "sample-work-management",
]);

async function source(path) {
  return (await readRepositoryFile(path)).toString("utf8");
}

export function inspectReferenceApplications(input) {
  return {
    fourKinds:
      /SEMICONDUCTOR_YIELD/u.test(input.service) &&
      /COMMERCE_OPERATIONS/u.test(input.service) &&
      /PERSONAL_BLOG/u.test(input.service) &&
      /WORK_MANAGEMENT/u.test(input.service),
    exactSlugs: EXPECTED_SLUGS.every((slug) => input.service.includes(slug)),
    exactRowScale:
      /totalTestRowCount: 3_938/u.test(input.integration) &&
      /totalProductionRowCount: 3_938/u.test(input.integration) &&
      /600, 1_370, 1_012, 956/u.test(input.integration),
    isolatedRuntime:
      /#writeRows\(project\.id, "test"/u.test(input.service) &&
      /#writeRows\(project\.id, "production"/u.test(input.service) &&
      /`\$\{environment\}\.sqlite`/u.test(input.service),
    runtimeIntegrity:
      /foreign_keys = ON/u.test(input.service) &&
      /quick_check/u.test(input.service) &&
      /foreign_key_check/u.test(input.service) &&
      /\.immediate\(\)/u.test(input.service),
    executableBindings:
      /"ROWS"/u.test(input.service) &&
      /"SCALAR"/u.test(input.service) &&
      /"SERIES"/u.test(input.service) &&
      /"VALUES"/u.test(input.service) &&
      /"CREATE"/u.test(input.service) &&
      /"UPDATE"/u.test(input.service) &&
      /"DELETE"/u.test(input.service),
    publishedCrud:
      /executeRuntimeMutation/u.test(input.service) &&
      /production-create-check/u.test(input.service) &&
      /production-update-check/u.test(input.service) &&
      /production-delete-check/u.test(input.service),
    operationalInventory:
      /pages\.length === 4/u.test(input.service) &&
      /elements\.length >= 19/u.test(input.service) &&
      /graph\.edges\.length >= 13/u.test(input.service) &&
      /REFERENCE_APPLICATION_INCOMPLETE/u.test(input.service),
    backupVerified:
      /backupService\.create/u.test(input.service) &&
      /backupService\.verify/u.test(input.service) &&
      /drill\.status === "PASS"/u.test(input.service),
    endpoint:
      /sample-projects\/reference-applications/u.test(input.routes) &&
      /createSuite/u.test(input.routes),
    domainContract:
      /REFERENCE_APPLICATION_KINDS/u.test(input.domain) &&
      /ReferenceApplicationSuiteDto/u.test(input.domain),
    conciseHomeEntry:
      /예제 프로젝트/u.test(input.home) &&
      /4개 시스템 · 실제 데이터 3,938건/u.test(input.home) &&
      /reference-application-grid/u.test(input.home),
    equalHomeControls:
      /project-entry-button/u.test(input.home) &&
      /home-hero-actions \.project-entry-button/u.test(input.styles) &&
      /examplesButton, importButton, createButton/u.test(input.homeTest),
    visibleSampleIdentity:
      /referenceSample/u.test(input.home) &&
      /<Badge variant="outline">예제<\/Badge>/u.test(input.home),
    behavioralCoverage:
      /creates four published domain systems/u.test(input.integration) &&
      /creates the four real-data example projects/u.test(input.homeTest),
    acceptedDecision:
      /Status: accepted/u.test(input.adr) &&
      /3,938 rows per environment/u.test(input.adr),
    phaseStatus:
      /### PHASE 25 — Real-domain Reference Applications[\s\S]*State: `OPERATIONALLY VERIFIED`/u.test(
        input.status,
      ) && /\| 25\s+\| OPERATIONALLY VERIFIED\s+\|/u.test(input.status),
  };
}

export async function validatePhase25({ includeBrowserEvidence = true } = {}) {
  const validation = new Validation(
    "Phase 25 Real-domain Reference Applications",
  );
  const input = Object.fromEntries(
    await Promise.all(
      Object.entries(FILES).map(async ([key, path]) => [
        key,
        await source(path),
      ]),
    ),
  );
  const inspection = inspectReferenceApplications(input);
  for (const [name, passed] of Object.entries(inspection)) {
    validation.equal(passed, true, `Reference application contract: ${name}`);
  }

  const traceability = JSON.parse(input.traceability);
  for (const id of ["REQ-001", "REQ-018"]) {
    const requirement = traceability.requirements?.find(
      (entry) => entry.id === id,
    );
    validation.check(
      requirement?.implementation?.includes(FILES.adr),
      `${id} references Phase 25 ADR`,
    );
    validation.check(
      requirement?.tests?.includes("scripts/verify-phase25.mjs"),
      `${id} references Phase 25 verifier`,
    );
    validation.check(
      requirement?.evidence?.includes(PHASE25_EVIDENCE_PATH) &&
        requirement?.evidence?.includes(PHASE25_BROWSER_EVIDENCE_PATH),
      `${id} references Phase 25 evidence`,
    );
  }

  let browserEvidence = null;
  if (includeBrowserEvidence) {
    validation.equal(
      await pathExists(PHASE25_BROWSER_EVIDENCE_PATH),
      true,
      "Phase 25 browser evidence exists",
    );
    if (await pathExists(PHASE25_BROWSER_EVIDENCE_PATH)) {
      browserEvidence = await readJson(PHASE25_BROWSER_EVIDENCE_PATH);
      validation.equal(
        browserEvidence.result,
        "PASS",
        "Public browser flow passes",
      );
      validation.equal(
        browserEvidence.url,
        "https://webeditor.dove9999.com/",
        "Evidence targets the public domain",
      );
      validation.equal(
        browserEvidence.projectCount,
        4,
        "Four reference Projects are visible",
      );
      validation.equal(
        browserEvidence.totalProductionRowCount,
        3_938,
        "Production row total is exact",
      );
      validation.equal(
        browserEvidence.publishedRuntimeChecks,
        4,
        "Every Published Runtime was opened",
      );
      validation.equal(
        browserEvidence.sameLevelActionGeometry,
        true,
        "Home actions share geometry",
      );
      validation.equal(
        browserEvidence.mobileDocumentWidth,
        419,
        "Mobile document remains bounded",
      );
      validation.equal(
        browserEvidence.consoleErrorCount,
        0,
        "Browser console has no errors",
      );
      validation.equal(
        browserEvidence.failedRequestCount,
        0,
        "Required browser requests all pass",
      );
    }
  }

  return validation.result({ inspection, browserEvidence });
}

async function main() {
  try {
    await finishVerification(PHASE25_EVIDENCE_PATH, await validatePhase25());
  } catch (error) {
    await finishVerification(
      PHASE25_EVIDENCE_PATH,
      unexpectedFailure("Phase 25 Real-domain Reference Applications", error),
    );
  }
}

if (isMainModule(import.meta.url)) await main();
