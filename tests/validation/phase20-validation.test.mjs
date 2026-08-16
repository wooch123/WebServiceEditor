import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it } from "node:test";

import {
  EXPECTED_CATEGORY_COUNTS,
  inspectPhase20Implementation,
  inspectPhase20Manifest,
  validatePhase20,
} from "../../scripts/verify-phase20.mjs";

const root = resolve(import.meta.dirname, "../..");

async function json(path) {
  return JSON.parse(await readFile(resolve(root, path), "utf8"));
}

describe("Phase 20 validation contract", () => {
  it("passes the real generated Corpus before governance finalization", async () => {
    const report = await validatePhase20({
      repositoryRoot: root,
      includeGovernance: false,
      includePhase19Regression: true,
    });
    assert.equal(report.result, "PASS", JSON.stringify(report.failures));
    assert.equal(report.details.runId, "81ecae93-da67-4489-a63a-fd3e161605aa");
    assert.equal(report.details.scaleTotals.runtimeRowCount, 416_900);
  });

  it("pins the exact category distribution and generated boundary projects", async () => {
    const [manifest, corpus, run] = await Promise.all([
      json("artifacts/phase20/project-corpus-manifest.json"),
      json("webeditor_project_corpus_v3.json"),
      json("artifacts/phase20/corpus-generation-run.json"),
    ]);
    const inspection = inspectPhase20Manifest(manifest, corpus, run);
    assert.deepEqual(EXPECTED_CATEGORY_COUNTS, {
      minimal: 10,
      dashboard: 20,
      statistics: 20,
      crud: 15,
      navigation: 15,
      "complex-graph": 10,
      accessibility: 5,
      "stress-recovery": 5,
    });
    assert.equal(inspection.boundaryProjects, true);
    assert.equal(inspection.coverageCounts, true);
    assert.equal(inspection.scalesExact, true);
  });

  it("rejects a missing Project", async () => {
    const [manifest, corpus, run] = await Promise.all([
      json("artifacts/phase20/project-corpus-manifest.json"),
      json("webeditor_project_corpus_v3.json"),
      json("artifacts/phase20/corpus-generation-run.json"),
    ]);
    const mutated = { ...manifest, projects: manifest.projects.slice(1) };
    const inspection = inspectPhase20Manifest(mutated, corpus, run);
    assert.equal(inspection.projectCount, false);
    assert.equal(inspection.exactIndices, false);
  });

  it("rejects duplicate isolation and runtime Sentinels", async () => {
    const [manifest, corpus, run] = await Promise.all([
      json("artifacts/phase20/project-corpus-manifest.json"),
      json("webeditor_project_corpus_v3.json"),
      json("artifacts/phase20/corpus-generation-run.json"),
    ]);
    const projects = manifest.projects.map((project) => ({ ...project }));
    projects[1].isolationSentinel = projects[0].isolationSentinel;
    projects[1].runtimeRowSentinel = projects[0].runtimeRowSentinel;
    const inspection = inspectPhase20Manifest(
      { ...manifest, projects },
      corpus,
      run,
    );
    assert.equal(inspection.uniqueProjectSentinels, false);
    assert.equal(inspection.uniqueRuntimeSentinels, false);
  });

  it("rejects manifest and run checksum tampering", async () => {
    const [manifest, corpus, run] = await Promise.all([
      json("artifacts/phase20/project-corpus-manifest.json"),
      json("webeditor_project_corpus_v3.json"),
      json("artifacts/phase20/corpus-generation-run.json"),
    ]);
    const inspection = inspectPhase20Manifest(
      { ...manifest, manifestChecksum: "0".repeat(64) },
      corpus,
      { ...run, manifestChecksum: "1".repeat(64) },
    );
    assert.equal(inspection.manifestChecksum, false);
    assert.equal(inspection.runEvidence, false);
  });

  it("rejects a weak route inventory and mock-only service", () => {
    const baseline = {
      domain: "PROJECT_CORPUS_RUN_STATUSES ProjectCorpusRunDetailDto",
      domainExports: 'export * from "./project-corpus.js"',
      migration:
        "LATEST_METADATA_SCHEMA_VERSION = 17 CREATE TABLE project_corpus_runs CREATE TABLE project_corpus_results UNIQUE (corpus_run_id, isolation_sentinel) UNIQUE (corpus_run_id, runtime_row_sentinel)",
      routes:
        'server.post("/api/v1/internal/project-corpus/generate", handler)',
      app: "registerProjectCorpusRoutes new ProjectCorpusService",
      service:
        'PROJECT_CORPUS_GENERATOR_VERSION = "1.0.0" stableJson manifestChecksum IDEMPOTENCY_PAYLOAD_CONFLICT',
      cli: "WEBEDITOR_CORPUS_WORKSPACE_ROOT is required Corpus workspace must be isolated staticRoot: false",
      integration:
        "creates all 100 real isolated Projects toHaveLength(100) IDEMPOTENCY_PAYLOAD_CONFLICT quick_check foreign_key_check restarted",
      serverPackage: '{"corpus:generate":"run"}',
      rootPackage: '{"test:corpus:generate":"run","verify:phase20":"run"}',
    };
    const inspection = inspectPhase20Implementation(baseline);
    assert.equal(inspection.routes, false);
    assert.equal(inspection.realServices, false);
  });
});
