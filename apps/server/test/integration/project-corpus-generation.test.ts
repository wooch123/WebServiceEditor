import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { buildServer } from "../../src/app.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map(async (directory) =>
        rm(directory, { force: true, recursive: true }),
      ),
  );
});

describe("deterministic 100-Project Corpus generation and verification", () => {
  it(
    "creates all 100 real isolated Projects, exact scale, coverage, Sentinels, and a durable checksummed manifest",
    { timeout: 600_000 },
    async () => {
      const directory = await mkdtemp(join(tmpdir(), "webeditor-corpus-"));
      temporaryDirectories.push(directory);
      const databasePath = join(directory, "metadata.sqlite");
      const storageRoot = join(directory, "storage");
      const manifestPath = resolve(
        process.cwd(),
        "../../webeditor_project_corpus_v3.json",
      );
      const app = buildServer({
        metadataDatabasePath: databasePath,
        storageRoot,
        projectCorpusManifestPath: manifestPath,
        staticRoot: false,
      });

      let runId: string;
      try {
        const generated = await app.inject({
          method: "POST",
          url: "/api/v1/internal/project-corpus/generate",
          payload: {
            seed: "webeditor-project-corpus-v3",
            idempotencyKey: "phase20-generate-corpus",
          },
        });
        expect(generated.statusCode, generated.body).toBe(201);
        const run = generated.json().run;
        runId = run.id;
        expect(run).toMatchObject({
          seed: "webeditor-project-corpus-v3",
          projectCount: 100,
          generatorVersion: "1.0.0",
          status: "GENERATED",
        });
        expect(run.manifestChecksum).toMatch(/^[0-9a-f]{64}$/u);
        expect(run.summary).toMatchObject({
          generatedProjectCount: 100,
          uniqueProjectSentinelCount: 100,
          uniqueRuntimeSentinelCount: 100,
          uniqueStructureFingerprintCount: 100,
          categoryCounts: {
            minimal: 10,
            dashboard: 20,
            statistics: 20,
            crud: 15,
            navigation: 15,
            "complex-graph": 10,
            accessibility: 5,
            "stress-recovery": 5,
          },
        });
        expect(run.summary.coverage).toMatchObject({
          themes: expect.arrayContaining([
            "dark-polar-night",
            "light-clean-paper",
          ]),
          pageTypes: expect.arrayContaining(["blank", "spc-dashboard"]),
          layoutPresets: expect.arrayContaining([
            "analysis-dashboard",
            "trend-analysis",
          ]),
          elementTypes: expect.arrayContaining(["text", "tabs-navigation"]),
          bindingTypes: expect.arrayContaining(["read", "navigation"]),
        });
        expect(run.summary.coverage.themes).toHaveLength(60);
        expect(run.summary.coverage.pageTypes).toHaveLength(12);
        expect(run.summary.coverage.layoutPresets).toHaveLength(22);
        expect(run.summary.coverage.elementTypes).toHaveLength(55);
        expect(run.summary.coverage.bindingTypes).toHaveLength(11);

        const resultsResponse = await app.inject({
          method: "GET",
          url: `/api/v1/internal/project-corpus/${runId}/results`,
        });
        expect(resultsResponse.statusCode).toBe(200);
        const results = resultsResponse.json().results;
        expect(results).toHaveLength(100);
        expect(results[0]).toMatchObject({
          corpusId: "CORPUS-001",
          projectIndex: 1,
          archetype: "minimal",
          status: "GENERATED",
          isolationSentinel: "WEBEDITOR-PROJECT-SENTINEL-001",
          runtimeRowSentinel: "WEBEDITOR-RUNTIME-SENTINEL-001",
          scale: {
            pageCount: 2,
            elementCount: 5,
            nodeCount: 4,
            tableCount: 2,
            runtimeRowCount: 20,
          },
        });
        expect(results[99]).toMatchObject({
          corpusId: "CORPUS-100",
          projectIndex: 100,
          archetype: "stress-recovery",
          status: "GENERATED",
          isolationSentinel: "WEBEDITOR-PROJECT-SENTINEL-100",
          runtimeRowSentinel: "WEBEDITOR-RUNTIME-SENTINEL-100",
          scale: {
            pageCount: 40,
            elementCount: 270,
            nodeCount: 280,
            tableCount: 30,
            runtimeRowCount: 35_000,
          },
        });

        const replay = await app.inject({
          method: "POST",
          url: "/api/v1/internal/project-corpus/generate",
          payload: {
            seed: "webeditor-project-corpus-v3",
            idempotencyKey: "phase20-generate-corpus",
          },
        });
        expect(replay.statusCode).toBe(201);
        expect(replay.json().run.id).toBe(runId);
        const conflict = await app.inject({
          method: "POST",
          url: "/api/v1/internal/project-corpus/generate",
          payload: {
            seed: "another-seed",
            idempotencyKey: "phase20-generate-corpus",
          },
        });
        expect(conflict.statusCode).toBe(409);
        expect(conflict.json().error.code).toBe("IDEMPOTENCY_PAYLOAD_CONFLICT");
      } finally {
        await app.close();
      }

      const database = new Database(databasePath, { readonly: true });
      const resultRows = database
        .prepare(
          `SELECT r.corpus_id, r.project_id, r.isolation_sentinel,
                  r.runtime_row_sentinel, p.description,
                  (SELECT t.physical_name FROM data_tables t
                   WHERE t.project_id = r.project_id AND t.deleted_at IS NULL
                   ORDER BY t.created_at, t.id LIMIT 1) AS table_name,
                  (SELECT f.physical_name FROM data_fields f
                   JOIN data_tables t ON t.id = f.table_id
                   WHERE t.project_id = r.project_id AND t.deleted_at IS NULL
                     AND f.deleted_at IS NULL
                   ORDER BY t.created_at, t.id, f.sort_order, f.id LIMIT 1)
                    AS field_name
           FROM project_corpus_results r
           JOIN projects p ON p.id = r.project_id
           WHERE r.corpus_run_id = ? ORDER BY r.project_index`,
        )
        .all(runId) as readonly {
        readonly corpus_id: string;
        readonly project_id: string;
        readonly isolation_sentinel: string;
        readonly runtime_row_sentinel: string;
        readonly description: string;
        readonly table_name: string;
        readonly field_name: string;
      }[];
      expect(resultRows).toHaveLength(100);
      expect(
        resultRows.every((row) =>
          row.description.includes(row.isolation_sentinel),
        ),
      ).toBe(true);
      expect(database.pragma("quick_check", { simple: true })).toBe("ok");
      expect(database.pragma("foreign_key_check")).toEqual([]);
      for (const row of [resultRows[0], resultRows[99]]) {
        expect(row).toBeDefined();
        const runtimePath = join(
          storageRoot,
          "active",
          row!.project_id,
          "test.sqlite",
        );
        const runtime = new Database(runtimePath, { readonly: true });
        expect(row!.table_name).toMatch(/^[a-z][a-z0-9_]+$/u);
        expect(row!.field_name).toMatch(/^[a-z][a-z0-9_]+$/u);
        const sentinel = runtime
          .prepare(
            `SELECT count(*) AS count FROM "${row!.table_name}"
             WHERE "${row!.field_name}" = ?`,
          )
          .get(row!.runtime_row_sentinel) as { readonly count: number };
        expect(sentinel.count).toBe(1);
        const state = runtime
          .prepare(
            "SELECT project_id, environment FROM webeditor_runtime_metadata",
          )
          .get();
        expect(state).toEqual({
          project_id: row!.project_id,
          environment: "test",
        });
        expect(runtime.pragma("quick_check", { simple: true })).toBe("ok");
        runtime.close();
      }
      database.close();

      const reportPath = join(
        storageRoot,
        "reports",
        "corpus",
        runId,
        "project-corpus-manifest.json",
      );
      expect(existsSync(reportPath)).toBe(true);
      const report = JSON.parse(readFileSync(reportPath, "utf8"));
      expect(report).toMatchObject({
        schemaVersion: 1,
        runId,
        projectCount: 100,
        manifestChecksum: expect.stringMatching(/^[0-9a-f]{64}$/u),
      });

      const restarted = buildServer({
        metadataDatabasePath: databasePath,
        storageRoot,
        projectCorpusManifestPath: manifestPath,
        staticRoot: false,
      });
      try {
        const detail = await restarted.inject({
          method: "GET",
          url: `/api/v1/internal/project-corpus/${runId}`,
        });
        expect(detail.statusCode).toBe(200);
        expect(detail.json().run.status).toBe("GENERATED");
        expect(detail.json().results).toHaveLength(100);
        const verificationResponse = await restarted.inject({
          method: "POST",
          url: `/api/v1/internal/project-corpus/${runId}/verify`,
          payload: {
            idempotencyKey: "phase21-verify-corpus",
          },
        });
        expect(verificationResponse.statusCode, verificationResponse.body).toBe(
          200,
        );
        const verification = verificationResponse.json().verification;
        const verificationReport = JSON.parse(
          readFileSync(
            join(storageRoot, verification.resultsEvidencePath),
            "utf8",
          ),
        );
        expect(
          verification.status,
          JSON.stringify(
            verificationReport.results.filter(
              (result: { readonly status: string }) => result.status !== "PASS",
            ),
            null,
            2,
          ),
        ).toBe("VERIFIED");
        expect(verification).toMatchObject({
          runId,
          status: "VERIFIED",
          summary: {
            passCount: 100,
            failCount: 0,
            blockedCount: 0,
            skippedCount: 0,
            crossProjectLeakCount: 0,
            orphanRecordCount: 0,
            orphanFileCount: 0,
            criticalErrorCount: 0,
            purgeFixtureCount: 1,
          },
        });
        expect(verification.verificationChecksum).toMatch(/^[0-9a-f]{64}$/u);
        for (const metric of [
          "projectList",
          "searchSort",
          "projectOpen",
          "autoSave",
          "preview",
          "publish",
          "runtime",
          "backup",
          "trash",
          "restore",
          "restartReady",
        ]) {
          expect(verification.summary.performance[metric]).toMatchObject({
            count: expect.any(Number),
            p50Ms: expect.any(Number),
            p95Ms: expect.any(Number),
            maxMs: expect.any(Number),
            passed: true,
          });
        }
        const verifiedDetail = await restarted.inject({
          method: "GET",
          url: `/api/v1/internal/project-corpus/${runId}`,
        });
        expect(verifiedDetail.statusCode).toBe(200);
        expect(verifiedDetail.json().run.status).toBe("VERIFIED");
        expect(
          verifiedDetail
            .json()
            .results.every(
              (result: { readonly status: string }) => result.status === "PASS",
            ),
        ).toBe(true);
        const replayVerification = await restarted.inject({
          method: "POST",
          url: `/api/v1/internal/project-corpus/${runId}/verify`,
          payload: { idempotencyKey: "phase21-verify-corpus" },
        });
        expect(replayVerification.statusCode).toBe(200);
        expect(
          replayVerification.json().verification.verificationChecksum,
        ).toBe(verification.verificationChecksum);
        for (const path of [
          verification.resultsEvidencePath,
          verification.performanceEvidencePath,
        ]) {
          expect(existsSync(join(storageRoot, path))).toBe(true);
        }
        const showcaseResponse = await restarted.inject({
          method: "POST",
          url: "/api/v1/internal/sample-projects/feature-showcase",
        });
        expect(showcaseResponse.statusCode, showcaseResponse.body).toBe(201);
        const showcase = showcaseResponse.json().project;
        expect(showcase).toMatchObject({
          name: "기능 종합 샘플",
          slug: "feature-showcase",
          pageCount: 22,
          tableCount: 9,
          runtimeRowCount: 5_001,
          pageTypeCount: 12,
          layoutPresetCount: 22,
          elementTypeCount: 55,
          status: "READY",
        });
        expect(showcase.elementCount).toBeGreaterThanOrEqual(55);
        expect(showcase.bindingCount).toBeGreaterThanOrEqual(5);
        const showcaseRuntime = await restarted.inject({
          method: "GET",
          url: `/api/v1/runtime/${showcase.projectId}/navigation`,
        });
        expect(showcaseRuntime.statusCode, showcaseRuntime.body).toBe(200);
        expect(showcaseRuntime.json().pages).toHaveLength(22);
        const showcaseReplay = await restarted.inject({
          method: "POST",
          url: "/api/v1/internal/sample-projects/feature-showcase",
        });
        expect(showcaseReplay.statusCode).toBe(201);
        expect(showcaseReplay.json().project.projectId).toBe(
          showcase.projectId,
        );
        const ready = await restarted.inject({
          method: "GET",
          url: "/api/v1/ready",
        });
        expect(ready.statusCode).toBe(200);
      } finally {
        await restarted.close();
      }
    },
  );
});
