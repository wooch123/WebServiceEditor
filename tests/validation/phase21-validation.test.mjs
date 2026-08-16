import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it } from "node:test";

import {
  inspectPhase21Implementation,
  inspectPhase21Results,
  validatePhase21,
} from "../../scripts/verify-phase21.mjs";

const root = resolve(import.meta.dirname, "../..");

async function json(path) {
  return JSON.parse(await readFile(resolve(root, path), "utf8"));
}

async function evidence() {
  return Promise.all([
    json("artifacts/phase21/project-corpus-results.json"),
    json("artifacts/phase21/project-corpus-performance.json"),
    json("artifacts/phase21/corpus-verification-run.json"),
    json("webeditor_project_corpus_v3.json"),
  ]);
}

describe("Phase 21 validation contract", () => {
  it("passes the real 100-Project operational run", async () => {
    const report = await validatePhase21({
      repositoryRoot: root,
      includeGovernance: false,
      includePhase20Regression: true,
    });
    assert.equal(report.result, "PASS", JSON.stringify(report.failures));
    assert.equal(report.details.resultInspection.exactly100, true);
    assert.equal(report.details.resultInspection.isolation, true);
  });

  it("rejects one failed or skipped Project scenario", async () => {
    const [results, performance, run, corpus] = await evidence();
    const projects = JSON.parse(JSON.stringify(results.results));
    projects[0].scenarios.publish = "FAIL";
    const inspection = inspectPhase21Results(
      { ...results, results: projects },
      performance,
      run,
      corpus,
    );
    assert.equal(inspection.allPass, false);
    assert.equal(inspection.checksum, false);
  });

  it("rejects Sentinel leakage, orphans, or a missing purge fixture", async () => {
    const [results, performance, run, corpus] = await evidence();
    const inspection = inspectPhase21Results(
      {
        ...results,
        summary: {
          ...results.summary,
          crossProjectLeakCount: 1,
          orphanFileCount: 1,
          purgeFixtureCount: 0,
        },
      },
      performance,
      run,
      corpus,
    );
    assert.equal(inspection.isolation, false);
  });

  it("rejects a performance budget regression", async () => {
    const [results, performance, run, corpus] = await evidence();
    const inspection = inspectPhase21Results(
      results,
      {
        ...performance,
        performance: {
          ...performance.performance,
          projectOpen: {
            ...performance.performance.projectOpen,
            maxMs: 3_001,
            passed: false,
          },
        },
      },
      run,
      corpus,
    );
    assert.equal(inspection.performance, false);
  });

  it("rejects mock-only implementation text", () => {
    const inspection = inspectPhase21Implementation({
      domain: "VerifyProjectCorpusRequest",
      exports: "",
      service: "mock only",
      routes: "",
      verifyCli: "",
      integration: "",
      rootPackage: "{}",
      serverPackage: "{}",
    });
    assert.equal(Object.values(inspection).every(Boolean), false);
  });
});
