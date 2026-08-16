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
import { validatePhase19 } from "./verify-phase19.mjs";

export const PHASE20_EVIDENCE_PATH =
  "artifacts/phase20/project-corpus-generation-validation.json";
export const PHASE20_MANIFEST_PATH =
  "artifacts/phase20/project-corpus-manifest.json";
export const PHASE20_RUN_PATH = "artifacts/phase20/corpus-generation-run.json";

export const EXPECTED_CATEGORY_COUNTS = Object.freeze({
  minimal: 10,
  dashboard: 20,
  statistics: 20,
  crud: 15,
  navigation: 15,
  "complex-graph": 10,
  accessibility: 5,
  "stress-recovery": 5,
});

const FILES = {
  corpus: "webeditor_project_corpus_v3.json",
  manifest: PHASE20_MANIFEST_PATH,
  run: PHASE20_RUN_PATH,
  domain: "packages/domain/src/project-corpus.ts",
  domainExports: "packages/domain/src/index.ts",
  migration: "apps/server/src/metadata/database.ts",
  service: "apps/server/src/project-corpus/project-corpus-service.ts",
  routes: "apps/server/src/routes/project-corpus.ts",
  app: "apps/server/src/app.ts",
  cli: "apps/server/src/project-corpus/generate-cli.ts",
  integration: "apps/server/test/integration/project-corpus-generation.test.ts",
  serverPackage: "apps/server/package.json",
  rootPackage: "package.json",
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

function exactObject(actual, expected) {
  return stableJson(actual) === stableJson(expected);
}

function exactSet(actual, expected) {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    [...actual]
      .sort()
      .every((value, index) => value === [...expected].sort()[index])
  );
}

function sumScale(projects) {
  return projects.reduce(
    (total, project) => ({
      pageCount: total.pageCount + project.scale.pageCount,
      elementCount: total.elementCount + project.scale.elementCount,
      nodeCount: total.nodeCount + project.scale.nodeCount,
      tableCount: total.tableCount + project.scale.tableCount,
      runtimeRowCount: total.runtimeRowCount + project.scale.runtimeRowCount,
    }),
    {
      pageCount: 0,
      elementCount: 0,
      nodeCount: 0,
      tableCount: 0,
      runtimeRowCount: 0,
    },
  );
}

export function inspectPhase20Manifest(manifest, corpus, runEvidence) {
  const projects = Array.isArray(manifest.projects) ? manifest.projects : [];
  const sourceProjects = Array.isArray(corpus.projects) ? corpus.projects : [];
  const checksumPayload = { ...manifest };
  delete checksumPayload.manifestChecksum;
  delete checksumPayload.completedAt;
  const expectedIndices = Array.from({ length: 100 }, (_, index) => index + 1);
  const expectedCorpusIds = expectedIndices.map(
    (index) => `CORPUS-${String(index).padStart(3, "0")}`,
  );
  const categoryCounts = projects.reduce((counts, project) => {
    counts[project.archetype] = (counts[project.archetype] ?? 0) + 1;
    return counts;
  }, {});
  const ids = projects.map((project) => project.projectId);
  const projectSentinels = projects.map((project) => project.isolationSentinel);
  const runtimeSentinels = projects.map(
    (project) => project.runtimeRowSentinel,
  );
  const fingerprints = projects.map((project) => project.structureFingerprint);
  const sourceByCorpusId = new Map(
    sourceProjects.map((project) => [project.corpusId, project]),
  );
  const scalesExact = projects.every((project) =>
    exactObject(project.scale, sourceByCorpusId.get(project.corpusId)?.scale),
  );
  return {
    metadata:
      manifest.schemaVersion === 1 &&
      manifest.seed === "webeditor-project-corpus-v3" &&
      manifest.generatorVersion === "1.0.0" &&
      manifest.projectCount === 100 &&
      /^[0-9a-f-]{36}$/u.test(manifest.runId ?? ""),
    projectCount: projects.length === 100,
    exactIndices: exactObject(
      projects.map((project) => project.projectIndex),
      expectedIndices,
    ),
    exactCorpusIds: exactObject(
      projects.map((project) => project.corpusId),
      expectedCorpusIds,
    ),
    generatedStatuses: projects.every(
      (project) => project.status === "GENERATED",
    ),
    uniqueProjectIds: new Set(ids).size === 100,
    uniqueProjectSentinels: new Set(projectSentinels).size === 100,
    uniqueRuntimeSentinels: new Set(runtimeSentinels).size === 100,
    uniqueFingerprints: new Set(fingerprints).size === 100,
    sentinelPatterns:
      projectSentinels.every(
        (value, index) =>
          value ===
          `WEBEDITOR-PROJECT-SENTINEL-${String(index + 1).padStart(3, "0")}`,
      ) &&
      runtimeSentinels.every(
        (value, index) =>
          value ===
          `WEBEDITOR-RUNTIME-SENTINEL-${String(index + 1).padStart(3, "0")}`,
      ),
    categoryCounts:
      exactObject(categoryCounts, EXPECTED_CATEGORY_COUNTS) &&
      exactObject(manifest.summary?.categoryCounts, EXPECTED_CATEGORY_COUNTS),
    scalesExact,
    scaleTotals: exactObject(manifest.summary?.scaleTotals, sumScale(projects)),
    coverage:
      exactSet(manifest.summary?.coverage?.themes, corpus.coverage.themes) &&
      exactSet(
        manifest.summary?.coverage?.pageTypes,
        corpus.coverage.pageTypes,
      ) &&
      exactSet(
        manifest.summary?.coverage?.layoutPresets,
        corpus.coverage.layoutPresets,
      ) &&
      exactSet(
        manifest.summary?.coverage?.elementTypes,
        corpus.coverage.elementTypes,
      ) &&
      exactSet(
        manifest.summary?.coverage?.bindingTypes,
        corpus.coverage.bindingTypes,
      ),
    coverageCounts:
      manifest.summary?.coverage?.themes?.length === 60 &&
      manifest.summary?.coverage?.pageTypes?.length === 12 &&
      manifest.summary?.coverage?.layoutPresets?.length === 22 &&
      manifest.summary?.coverage?.elementTypes?.length === 55 &&
      manifest.summary?.coverage?.bindingTypes?.length === 11,
    summaryCounts:
      manifest.summary?.generatedProjectCount === 100 &&
      manifest.summary?.uniqueProjectSentinelCount === 100 &&
      manifest.summary?.uniqueRuntimeSentinelCount === 100 &&
      manifest.summary?.uniqueStructureFingerprintCount === 100,
    boundaryProjects:
      exactObject(projects[0]?.scale, {
        pageCount: 2,
        elementCount: 5,
        nodeCount: 4,
        tableCount: 2,
        runtimeRowCount: 20,
      }) &&
      exactObject(projects[99]?.scale, {
        pageCount: 40,
        elementCount: 270,
        nodeCount: 280,
        tableCount: 30,
        runtimeRowCount: 35_000,
      }),
    manifestChecksum:
      /^[0-9a-f]{64}$/u.test(manifest.manifestChecksum ?? "") &&
      sha256(stableJson(checksumPayload)) === manifest.manifestChecksum,
    runEvidence:
      runEvidence?.result === "PASS" &&
      runEvidence?.target === "isolated real Metadata and Runtime workspace" &&
      runEvidence?.run?.id === manifest.runId &&
      runEvidence?.run?.status === "GENERATED" &&
      runEvidence?.run?.projectCount === 100 &&
      runEvidence?.generatedProjectCount === 100 &&
      runEvidence?.manifestChecksum === manifest.manifestChecksum &&
      runEvidence?.run?.manifestChecksum === manifest.manifestChecksum,
  };
}

export function inspectPhase20Implementation(source) {
  const routeMatches = [
    ...source.routes.matchAll(
      /server\.(?:get|post)\s*(?:<[^>]+>)?\s*\(\s*["`]([^"`]+)["`]/gu,
    ),
  ].map((match) => match[1]);
  return {
    domain:
      /PROJECT_CORPUS_RUN_STATUSES/u.test(source.domain) &&
      /ProjectCorpusRunDetailDto/u.test(source.domain) &&
      /project-corpus\.js/u.test(source.domainExports),
    migration:
      /LATEST_METADATA_SCHEMA_VERSION\s*=\s*17/u.test(source.migration) &&
      /CREATE TABLE project_corpus_runs/u.test(source.migration) &&
      /CREATE TABLE project_corpus_results/u.test(source.migration) &&
      /UNIQUE \(corpus_run_id, isolation_sentinel\)/u.test(source.migration) &&
      /UNIQUE \(corpus_run_id, runtime_row_sentinel\)/u.test(source.migration),
    routes: [
      "/api/v1/internal/project-corpus/generate",
      "/api/v1/internal/project-corpus/:runId",
      "/api/v1/internal/project-corpus/:runId/results",
    ].every((route) => routeMatches.includes(route)),
    registered:
      /registerProjectCorpusRoutes/u.test(source.app) &&
      /new ProjectCorpusService/u.test(source.app),
    realServices:
      /projectService\.create/u.test(source.service) &&
      /pageService\.create/u.test(source.service) &&
      /elementService\.create/u.test(source.service) &&
      /layoutPresetService\.(?:preview|apply)/u.test(source.service) &&
      /schemaService\.(?:createTable|apply)/u.test(source.service) &&
      /relationshipService\.updateNodePosition/u.test(source.service) &&
      /new Database/u.test(source.service),
    deterministic:
      /PROJECT_CORPUS_GENERATOR_VERSION\s*=\s*"1\.0\.0"/u.test(
        source.service,
      ) &&
      /stableJson/u.test(source.service) &&
      /manifestChecksum/u.test(source.service) &&
      /IDEMPOTENCY_PAYLOAD_CONFLICT/u.test(source.service),
    isolatedCli:
      /WEBEDITOR_CORPUS_WORKSPACE_ROOT is required/u.test(source.cli) &&
      /Corpus workspace must be isolated/u.test(source.cli) &&
      /staticRoot:\s*false/u.test(source.cli),
    packageScripts:
      /"corpus:generate"/u.test(source.serverPackage) &&
      /"test:corpus:generate"/u.test(source.rootPackage) &&
      /"verify:phase20"/u.test(source.rootPackage),
    integration:
      /creates all 100 real isolated Projects/u.test(source.integration) &&
      /toHaveLength\(100\)/u.test(source.integration) &&
      /IDEMPOTENCY_PAYLOAD_CONFLICT/u.test(source.integration) &&
      /quick_check/u.test(source.integration) &&
      /foreign_key_check/u.test(source.integration) &&
      /server-restart|restarted/u.test(source.integration),
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

export async function validatePhase20({
  repositoryRoot = REPOSITORY_ROOT,
  includeGovernance = true,
  includePhase19Regression = true,
} = {}) {
  const validation = new Validation(
    "Phase 20 Deterministic 100-Project Corpus Generation",
  );
  const source = await readSources(repositoryRoot);
  const corpus = JSON.parse(source.corpus);
  const manifest = JSON.parse(source.manifest);
  const runEvidence = JSON.parse(source.run);
  const manifestInspection = inspectPhase20Manifest(
    manifest,
    corpus,
    runEvidence,
  );
  const implementationInspection = inspectPhase20Implementation(source);

  for (const [name, value] of Object.entries(manifestInspection)) {
    validation.check(value, `Phase 20 generated manifest failed: ${name}`);
  }
  for (const [name, value] of Object.entries(implementationInspection)) {
    validation.check(value, `Phase 20 implementation failed: ${name}`);
  }
  validateExactSet(
    validation,
    manifest.projects.map((project) => project.corpusId),
    corpus.projects.map((project) => project.corpusId),
    "Phase 20 Corpus IDs",
  );

  if (includeGovernance) {
    const traceability = JSON.parse(source.traceability);
    const requirement = traceability.requirements.find(
      ({ id }) => id === "REQ-032",
    );
    validation.check(
      ["IN PROGRESS", "OPERATIONALLY VERIFIED"].includes(requirement?.status) &&
        requirement?.implementation.includes(
          "apps/server/src/project-corpus/project-corpus-service.ts",
        ) &&
        requirement?.tests.includes("scripts/verify-phase20.mjs") &&
        requirement?.evidence.includes(PHASE20_EVIDENCE_PATH) &&
        requirement?.evidence.includes(PHASE20_MANIFEST_PATH) &&
        requirement?.evidence.includes(PHASE20_RUN_PATH),
      "REQ-032 Phase 20 generation traceability is incomplete",
    );
    validation.check(
      /\|\s*20\s*\|\s*OPERATIONALLY VERIFIED\s*\|/u.test(source.status) &&
        /## Phase 20 evidence/u.test(source.status) &&
        source.status.includes(PHASE20_EVIDENCE_PATH) &&
        source.status.includes(PHASE20_MANIFEST_PATH) &&
        source.status.includes(PHASE20_RUN_PATH),
      "Phase 20 implementation status is incomplete",
    );
  }

  let phase19Regression = "NOT_RUN";
  if (includePhase19Regression) {
    const previous = await validatePhase19({
      repositoryRoot,
      includeBrowserEvidence: false,
      includePhase18Regression: false,
      includeGovernance: false,
    });
    phase19Regression = previous.result;
    validation.check(previous.result === "PASS", "Phase 19 regression failed", {
      failures: previous.failures,
    });
  }

  return validation.result({
    manifestInspection,
    implementationInspection,
    phase19Regression,
    runId: manifest.runId,
    manifestChecksum: manifest.manifestChecksum,
    scaleTotals: manifest.summary.scaleTotals,
    evidencePath: PHASE20_EVIDENCE_PATH,
    manifestPath: PHASE20_MANIFEST_PATH,
    runPath: PHASE20_RUN_PATH,
  });
}

if (isMainModule(import.meta.url)) {
  try {
    await finishVerification(PHASE20_EVIDENCE_PATH, await validatePhase20());
  } catch (error) {
    await finishVerification(
      PHASE20_EVIDENCE_PATH,
      unexpectedFailure(
        "Phase 20 Deterministic 100-Project Corpus Generation",
        error,
      ),
    );
  }
}
