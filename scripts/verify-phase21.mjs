import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  REPOSITORY_ROOT,
  Validation,
  finishVerification,
  isMainModule,
  unexpectedFailure,
  validateExactSet,
} from "./lib/verification.mjs";
import { validatePhase20 } from "./verify-phase20.mjs";

export const PHASE21_EVIDENCE_PATH =
  "artifacts/phase21/project-corpus-operational-validation.json";
export const PHASE21_RESULTS_PATH =
  "artifacts/phase21/project-corpus-results.json";
export const PHASE21_PERFORMANCE_PATH =
  "artifacts/phase21/project-corpus-performance.json";
export const PHASE21_RUN_PATH =
  "artifacts/phase21/corpus-verification-run.json";

const FILES = {
  corpus: "webeditor_project_corpus_v3.json",
  results: PHASE21_RESULTS_PATH,
  performance: PHASE21_PERFORMANCE_PATH,
  run: PHASE21_RUN_PATH,
  domain: "packages/domain/src/project-corpus.ts",
  exports: "packages/domain/src/index.ts",
  service: "apps/server/src/project-corpus/project-corpus-service.ts",
  routes: "apps/server/src/routes/project-corpus.ts",
  verifyCli: "apps/server/src/project-corpus/verify-cli.ts",
  integration: "apps/server/test/integration/project-corpus-generation.test.ts",
  rootPackage: "package.json",
  serverPackage: "apps/server/package.json",
  traceability: "docs/requirement-traceability.json",
  status: "docs/implementation-status.md",
};

function stableJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
    .join(",")}}`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function requiredScenarios(corpus) {
  return [
    ...new Set(
      corpus.projects.flatMap((project) => [
        ...project.requiredScenarios,
        ...project.specialScenarios,
      ]),
    ),
  ];
}

export function inspectPhase21Results(results, performance, run, corpus) {
  const projects = Array.isArray(results.results) ? results.results : [];
  const checksumPayload = { ...results };
  delete checksumPayload.verificationChecksum;
  const required = requiredScenarios(corpus);
  const observed = [
    ...new Set(projects.flatMap((project) => Object.keys(project.scenarios))),
  ];
  const metrics = performance.performance ?? {};
  const budgetExpectations = {
    projectList: 2_000,
    searchSort: 300,
    projectOpen: 3_000,
    autoSave: 1_000,
    preview: 2_000,
    publish: 2_000,
    runtime: 2_000,
    restartReady: 3_000,
  };
  return {
    metadata:
      results.schemaVersion === 1 &&
      results.status === "VERIFIED" &&
      /^[0-9a-f-]{36}$/u.test(results.runId ?? "") &&
      /^[0-9a-f-]{36}$/u.test(results.verifierInstanceId ?? ""),
    exactly100:
      projects.length === 100 &&
      new Set(projects.map(({ corpusId }) => corpusId)).size === 100 &&
      new Set(projects.map(({ projectId }) => projectId)).size === 100,
    exactCorpusIds:
      projects.map(({ corpusId }) => corpusId).join("|") ===
      corpus.projects.map(({ corpusId }) => corpusId).join("|"),
    allPass:
      projects.every(
        (project) =>
          project.status === "PASS" &&
          project.error === null &&
          Object.values(project.scenarios).every((value) => value === "PASS"),
      ) &&
      results.summary?.passCount === 100 &&
      results.summary?.failCount === 0 &&
      results.summary?.blockedCount === 0 &&
      results.summary?.skippedCount === 0,
    scenarioCoverage:
      required.every((scenario) => observed.includes(scenario)) &&
      projects.every((project) =>
        corpus.projects
          .find(({ corpusId }) => corpusId === project.corpusId)
          ?.requiredScenarios.every(
            (scenario) => project.scenarios[scenario] === "PASS",
          ),
      ),
    isolation:
      results.summary?.crossProjectLeakCount === 0 &&
      results.summary?.orphanRecordCount === 0 &&
      results.summary?.orphanFileCount === 0 &&
      results.summary?.criticalErrorCount === 0 &&
      results.summary?.purgeFixtureCount === 1,
    metrics: projects.every(
      (project) =>
        Object.values(project.metrics).every(
          (value) => Number.isFinite(value) && value >= 0,
        ) && project.assertions?.runtime?.sentinelCount === 1,
    ),
    performance:
      performance.status === "VERIFIED" &&
      performance.runId === results.runId &&
      Object.entries(budgetExpectations).every(
        ([name, budget]) =>
          metrics[name]?.budgetMs === budget &&
          metrics[name]?.passed === true &&
          metrics[name]?.maxMs <= budget,
      ) &&
      ["backup", "trash", "restore"].every(
        (name) =>
          metrics[name]?.passed === true && metrics[name]?.count === 100,
      ) &&
      metrics.metadataBytes > 0 &&
      metrics.storageBytes > 0 &&
      metrics.serverRssBytes > 0,
    checksum:
      /^[0-9a-f]{64}$/u.test(results.verificationChecksum ?? "") &&
      sha256(stableJson(checksumPayload)) === results.verificationChecksum &&
      performance.verificationChecksum === results.verificationChecksum,
    restartEvidence:
      run.result === "PASS" &&
      run.target ===
        "isolated real Metadata and Runtime workspace after restart" &&
      run.runId === results.runId &&
      run.passCount === 100 &&
      run.verificationChecksum === results.verificationChecksum,
  };
}

export function inspectPhase21Implementation(source) {
  return {
    domain:
      /VerifyProjectCorpusRequest/u.test(source.domain) &&
      /ProjectCorpusVerificationDto/u.test(source.domain) &&
      /FeatureShowcaseProjectDto/u.test(source.domain) &&
      /project-corpus\.js/u.test(source.exports),
    routes:
      /project-corpus\/:runId\/verify/u.test(source.routes) &&
      /sample-projects\/feature-showcase/u.test(source.routes),
    restartBoundary:
      /generatorInstanceId/u.test(source.service) &&
      /CORPUS_RESTART_REQUIRED/u.test(source.service) &&
      /VERIFICATION_INTERRUPTED/u.test(source.service),
    realOperations:
      /createDraftPreview/u.test(source.service) &&
      /pageService\.publish/u.test(source.service) &&
      /runtimeNavigation/u.test(source.service) &&
      /backupService\.create/u.test(source.service) &&
      /backupService\.verify/u.test(source.service) &&
      /projectService\.trash/u.test(source.service) &&
      /projectService\.restore/u.test(source.service) &&
      /previewAutoLayout/u.test(source.service) &&
      /foreign_key_check/u.test(source.service),
    showcase:
      /기능 종합 샘플/u.test(source.service) &&
      /feature-showcase/u.test(source.service) &&
      /55/u.test(source.integration) &&
      /5_000|5000/u.test(source.integration) &&
      /toHaveLength\(22\)/u.test(source.integration),
    cli:
      /WEBEDITOR_CORPUS_RUN_ID/u.test(source.verifyCli) &&
      /Corpus workspace must be isolated/u.test(source.verifyCli) &&
      /status !== "VERIFIED"/u.test(source.verifyCli),
    scripts:
      /"corpus:verify"/u.test(source.serverPackage) &&
      /"test:corpus:verify"/u.test(source.rootPackage) &&
      /"verify:phase21"/u.test(source.rootPackage),
    integration:
      /generation and verification/u.test(source.integration) &&
      /sample-projects\/feature-showcase/u.test(source.integration) &&
      /passCount/u.test(source.integration) &&
      /verificationChecksum/u.test(source.integration),
  };
}

async function readSources(repositoryRoot) {
  return Object.fromEntries(
    await Promise.all(
      Object.entries(FILES).map(async ([key, path]) => [
        key,
        await readFile(resolve(repositoryRoot, path), "utf8"),
      ]),
    ),
  );
}

export async function validatePhase21({
  repositoryRoot = REPOSITORY_ROOT,
  includeGovernance = true,
  includePhase20Regression = true,
} = {}) {
  const validation = new Validation(
    "Phase 21 100-Project Operational Verification",
  );
  const source = await readSources(repositoryRoot);
  const corpus = JSON.parse(source.corpus);
  const results = JSON.parse(source.results);
  const performance = JSON.parse(source.performance);
  const run = JSON.parse(source.run);
  const resultInspection = inspectPhase21Results(
    results,
    performance,
    run,
    corpus,
  );
  const implementationInspection = inspectPhase21Implementation(source);

  for (const [name, value] of Object.entries(resultInspection)) {
    validation.check(value, `Phase 21 operational evidence failed: ${name}`);
  }
  for (const [name, value] of Object.entries(implementationInspection)) {
    validation.check(value, `Phase 21 implementation failed: ${name}`);
  }
  validateExactSet(
    validation,
    results.results.map(({ corpusId }) => corpusId),
    corpus.projects.map(({ corpusId }) => corpusId),
    "Phase 21 verified Corpus IDs",
  );

  if (includeGovernance) {
    const traceability = JSON.parse(source.traceability);
    const requirement = traceability.requirements.find(
      ({ id }) => id === "REQ-032",
    );
    validation.check(
      requirement?.status === "OPERATIONALLY VERIFIED" &&
        requirement?.implementation.includes(
          "docs/adr/0021-100-project-operational-verification.md",
        ) &&
        requirement?.tests.includes("scripts/verify-phase21.mjs") &&
        requirement?.evidence.includes(PHASE21_EVIDENCE_PATH) &&
        requirement?.evidence.includes(PHASE21_RESULTS_PATH) &&
        requirement?.evidence.includes(PHASE21_PERFORMANCE_PATH) &&
        requirement?.evidence.includes(PHASE21_RUN_PATH),
      "REQ-032 Phase 21 traceability is incomplete",
    );
    validation.check(
      /\|\s*21\s*\|\s*OPERATIONALLY VERIFIED\s*\|/u.test(source.status) &&
        /## Phase 21 evidence/u.test(source.status) &&
        source.status.includes(PHASE21_EVIDENCE_PATH) &&
        source.status.includes(PHASE21_RESULTS_PATH) &&
        source.status.includes(PHASE21_PERFORMANCE_PATH),
      "Phase 21 implementation status is incomplete",
    );
  }

  let phase20Regression = "NOT_RUN";
  if (includePhase20Regression) {
    const previous = await validatePhase20({
      repositoryRoot,
      includeGovernance: true,
      includePhase19Regression: false,
    });
    phase20Regression = previous.result;
    validation.check(previous.result === "PASS", "Phase 20 regression failed", {
      failures: previous.failures,
    });
  }

  return validation.result({
    resultInspection,
    implementationInspection,
    phase20Regression,
    runId: results.runId,
    verificationChecksum: results.verificationChecksum,
    evidencePath: PHASE21_EVIDENCE_PATH,
    resultsPath: PHASE21_RESULTS_PATH,
    performancePath: PHASE21_PERFORMANCE_PATH,
    runPath: PHASE21_RUN_PATH,
  });
}

if (isMainModule(import.meta.url)) {
  try {
    await finishVerification(PHASE21_EVIDENCE_PATH, await validatePhase21());
  } catch (error) {
    await finishVerification(
      PHASE21_EVIDENCE_PATH,
      unexpectedFailure("Phase 21 100-Project Operational Verification", error),
    );
  }
}
