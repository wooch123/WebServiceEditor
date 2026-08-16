import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type {
  DataRelationshipGraphDto,
  DataSchemaDto,
  ReferenceApplicationSuiteDto,
  RuntimeBindingResultDto,
} from "@webeditor/domain";
import { afterEach, describe, expect, it } from "vitest";

import { buildServer } from "../../src/app.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("reference applications", () => {
  it(
    "creates four published domain systems with real related rows, executable bindings, backups, and idempotent reuse",
    { timeout: 240_000 },
    async () => {
      const directory = await mkdtemp(
        join(tmpdir(), "webeditor-reference-applications-"),
      );
      temporaryDirectories.push(directory);
      const app = buildServer({
        metadataDatabasePath: join(directory, "metadata.sqlite"),
        storageRoot: join(directory, "storage"),
        projectCorpusManifestPath: resolve(
          process.cwd(),
          "../../webeditor_project_corpus_v3.json",
        ),
        staticRoot: false,
      });

      try {
        const response = await app.inject({
          method: "POST",
          url: "/api/v1/internal/sample-projects/reference-applications",
        });
        expect(response.statusCode, response.body).toBe(201);
        const suite = response.json().suite as ReferenceApplicationSuiteDto;
        expect(suite).toMatchObject({
          totalProjectCount: 4,
          totalTestRowCount: 3_938,
          totalProductionRowCount: 3_938,
          status: "READY",
        });
        expect(suite.projects.map(({ kind }) => kind)).toEqual([
          "SEMICONDUCTOR_YIELD",
          "COMMERCE_OPERATIONS",
          "PERSONAL_BLOG",
          "WORK_MANAGEMENT",
        ]);
        expect(suite.projects.map(({ testRowCount }) => testRowCount)).toEqual([
          600, 1_370, 1_012, 956,
        ]);

        for (const project of suite.projects) {
          expect(project).toMatchObject({
            pageCount: 4,
            elementCount: 19,
            bindingCount: 13,
            status: "READY",
          });
          const schemaResponse = await app.inject({
            method: "GET",
            url: `/api/v1/projects/${project.projectId}/schema`,
          });
          expect(schemaResponse.statusCode, schemaResponse.body).toBe(200);
          const schema = schemaResponse.json() as DataSchemaDto;
          expect(schema.runtime.test.appliedRevision).toBe(
            schema.schemaRevision,
          );
          expect(schema.runtime.production.appliedRevision).toBe(
            schema.schemaRevision,
          );
          expect(schema.relations.length).toBeGreaterThanOrEqual(3);

          const graphResponse = await app.inject({
            method: "GET",
            url: `/api/v1/projects/${project.projectId}/relationship-graph`,
          });
          expect(graphResponse.statusCode, graphResponse.body).toBe(200);
          const graph = graphResponse.json() as DataRelationshipGraphDto;
          const readBinding = graph.edges.find(
            ({ bindingType }) => bindingType === "READ",
          );
          expect(readBinding).toBeDefined();
          const runtimeResponse = await app.inject({
            method: "POST",
            url: `/api/v1/runtime/${project.projectId}/query/${readBinding?.id}`,
            payload: { parameters: {} },
          });
          expect(runtimeResponse.statusCode, runtimeResponse.body).toBe(200);
          const runtime = runtimeResponse.json() as RuntimeBindingResultDto;
          expect(runtime.result.rowCount).toBeGreaterThan(0);
          expect(runtime.environment).toBe("production");
        }

        const replay = await app.inject({
          method: "POST",
          url: "/api/v1/internal/sample-projects/reference-applications",
        });
        expect(replay.statusCode, replay.body).toBe(201);
        const replaySuite = replay.json().suite as ReferenceApplicationSuiteDto;
        expect(replaySuite.projects.map(({ projectId }) => projectId)).toEqual(
          suite.projects.map(({ projectId }) => projectId),
        );
        expect(replaySuite.totalProductionRowCount).toBe(3_938);
      } finally {
        await app.close();
      }
    },
  );
});
