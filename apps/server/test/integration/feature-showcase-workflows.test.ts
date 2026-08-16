import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type {
  DataRelationshipGraphDto,
  DataSchemaDto,
  DraftPreviewDto,
  FeatureShowcaseProjectDto,
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

describe("Feature Showcase executable workflows", () => {
  it(
    "connects real input and action Elements to an isolated CRUD Table and leaves a verified Test row",
    { timeout: 120_000 },
    async () => {
      const directory = await mkdtemp(
        join(tmpdir(), "webeditor-feature-showcase-"),
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
          url: "/api/v1/internal/sample-projects/feature-showcase",
        });
        expect(response.statusCode, response.body).toBe(201);
        const showcase = response.json().project as FeatureShowcaseProjectDto;
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
        expect(showcase.bindingCount).toBeGreaterThanOrEqual(5);

        const schemaResponse = await app.inject({
          method: "GET",
          url: `/api/v1/projects/${showcase.projectId}/schema`,
        });
        expect(schemaResponse.statusCode, schemaResponse.body).toBe(200);
        const schema = schemaResponse.json() as DataSchemaDto;
        expect(schema.runtime.test.appliedRevision).toBe(schema.schemaRevision);
        expect(schema.runtime.production.appliedRevision).toBe(0);
        const table = schema.tables.find(
          ({ displayName }) => displayName === "Interactive Records",
        );
        expect(table).toBeDefined();
        const idField = table?.fields.find(
          ({ displayName }) => displayName === "ID",
        );
        const valueField = table?.fields.find(
          ({ displayName }) => displayName === "값",
        );
        expect(idField).toMatchObject({
          type: "INTEGER",
          primaryKey: true,
          autoIncrement: true,
        });
        expect(valueField?.type).toBe("REAL");

        const graphResponse = await app.inject({
          method: "GET",
          url: `/api/v1/projects/${showcase.projectId}/relationship-graph`,
        });
        expect(graphResponse.statusCode, graphResponse.body).toBe(200);
        const graph = graphResponse.json() as DataRelationshipGraphDto;
        expect(
          new Set(graph.edges.map(({ bindingType }) => bindingType)),
        ).toEqual(new Set(["CONTAINS", "READ", "CREATE", "UPDATE", "DELETE"]));
        const readBinding = graph.edges.find(
          (edge) =>
            edge.bindingType === "READ" &&
            edge.source.objectId === valueField?.id,
        );
        expect(readBinding).toBeDefined();
        expect(
          graph.edges.filter(({ bindingType }) =>
            ["CREATE", "UPDATE", "DELETE"].includes(bindingType),
          ),
        ).toHaveLength(3);

        const projectResponse = await app.inject({
          method: "GET",
          url: `/api/v1/projects/${showcase.projectId}`,
        });
        const projectRevision = projectResponse.json().project
          .revision as number;
        const previewResponse = await app.inject({
          method: "POST",
          url: `/api/v1/projects/${showcase.projectId}/draft-previews`,
          payload: { expectedProjectRevision: projectRevision },
        });
        expect(previewResponse.statusCode, previewResponse.body).toBe(201);
        const preview = previewResponse.json() as DraftPreviewDto;
        const queryResponse = await app.inject({
          method: "POST",
          url: `/api/v1/draft-previews/${preview.previewId}/query/${readBinding?.id}`,
          payload: { parameters: {} },
        });
        expect(queryResponse.statusCode, queryResponse.body).toBe(200);
        const query = queryResponse.json() as RuntimeBindingResultDto;
        expect(query).toMatchObject({ environment: "test" });
        expect(query.result.rowCount).toBe(1);
        expect(query.result.rows[0]?.[valueField?.id ?? ""]).toBe(27.25);

        const replay = await app.inject({
          method: "POST",
          url: "/api/v1/internal/sample-projects/feature-showcase",
        });
        expect(replay.statusCode, replay.body).toBe(201);
        expect(replay.json().project).toMatchObject({
          projectId: showcase.projectId,
          tableCount: 9,
          runtimeRowCount: 5_001,
          bindingCount: showcase.bindingCount,
          publishedVersionId: showcase.publishedVersionId,
        });
      } finally {
        await app.close();
      }
    },
  );
});
