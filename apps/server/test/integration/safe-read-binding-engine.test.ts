import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  BindingExecutionDto,
  BindingQueryPreviewDto,
  DataRelationshipGraphDto,
  DataSchemaDto,
  ElementEntryDto,
  PageDto,
  RelationshipBindingMutationDto,
  RelationshipConnectionPreviewDto,
  SampleDataMutationDto,
} from "@webeditor/domain";
import Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { buildServer } from "../../src/app.js";

const directories: string[] = [];
const apps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function fixture(options: { readonly clock?: () => Date } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "webeditor-phase11-"));
  directories.push(directory);
  const storageRoot = join(directory, "projects");
  const databasePath = join(directory, "metadata", "webeditor.sqlite");
  const app = buildServer({
    metadataDatabasePath: databasePath,
    storageRoot,
    ...(options.clock === undefined ? {} : { clock: options.clock }),
  });
  apps.push(app);
  return { app, databasePath, storageRoot };
}

async function seed(app: FastifyInstance) {
  const projectResponse = await app.inject({
    method: "POST",
    url: "/api/v1/projects",
    payload: {
      name: `READ ${randomUUID().slice(0, 8)}`,
      slug: `read-${randomUUID().slice(0, 8)}`,
    },
  });
  expect(projectResponse.statusCode, projectResponse.body).toBe(201);
  const project = (
    projectResponse.json() as {
      project: { id: string; revision: number };
    }
  ).project;
  const pageResponse = await app.inject({
    method: "POST",
    url: `/api/v1/projects/${project.id}/pages`,
    payload: {
      name: "분석",
      pageType: "blank",
      expectedProjectRevision: project.revision,
      idempotencyKey: `page-${randomUUID()}`,
    },
  });
  expect(pageResponse.statusCode, pageResponse.body).toBe(201);
  const page = pageResponse.json() as {
    page: PageDto;
    projectRevision: number;
  };
  const tableElementResponse = await app.inject({
    method: "POST",
    url: `/api/v1/pages/${page.page.id}/elements`,
    payload: {
      elementType: "data-table",
      expectedLayoutRevision: 0,
      expectedProjectRevision: page.projectRevision,
      idempotencyKey: `table-element-${randomUUID()}`,
    },
  });
  expect(tableElementResponse.statusCode, tableElementResponse.body).toBe(201);
  const tableElement = tableElementResponse.json() as {
    entry: ElementEntryDto;
    layoutRevision: number;
    projectRevision: number;
  };
  const histogramElementResponse = await app.inject({
    method: "POST",
    url: `/api/v1/pages/${page.page.id}/elements`,
    payload: {
      elementType: "histogram",
      expectedLayoutRevision: tableElement.layoutRevision,
      expectedProjectRevision: tableElement.projectRevision,
      idempotencyKey: `histogram-element-${randomUUID()}`,
    },
  });
  expect(
    histogramElementResponse.statusCode,
    histogramElementResponse.body,
  ).toBe(201);
  const histogramElement = histogramElementResponse.json() as {
    entry: ElementEntryDto;
    projectRevision: number;
  };
  const tableResponse = await app.inject({
    method: "POST",
    url: `/api/v1/projects/${project.id}/tables`,
    payload: {
      displayName: "시계열",
      template: "TIME_SERIES",
      expectedSchemaRevision: 0,
      expectedProjectRevision: histogramElement.projectRevision,
      idempotencyKey: `table-${randomUUID()}`,
    },
  });
  expect(tableResponse.statusCode, tableResponse.body).toBe(201);
  const schema = tableResponse.json() as DataSchemaDto;
  const planResponse = await app.inject({
    method: "POST",
    url: `/api/v1/projects/${project.id}/schema/plan`,
    payload: {
      expectedSchemaRevision: schema.schemaRevision,
      expectedProjectRevision: schema.projectRevision,
    },
  });
  expect(planResponse.statusCode, planResponse.body).toBe(200);
  const planId = (planResponse.json() as { plan: { id: string } }).plan.id;
  const applyResponse = await app.inject({
    method: "POST",
    url: `/api/v1/projects/${project.id}/schema/apply`,
    payload: {
      planId,
      expectedSchemaRevision: schema.schemaRevision,
      expectedProjectRevision: schema.projectRevision,
      confirmDestructive: false,
      idempotencyKey: `schema-${randomUUID()}`,
    },
  });
  expect(applyResponse.statusCode, applyResponse.body).toBe(200);
  return {
    project,
    page: page.page,
    tableElement: tableElement.entry,
    histogramElement: histogramElement.entry,
    schema,
  };
}

async function graph(app: FastifyInstance, projectId: string) {
  const response = await app.inject({
    method: "GET",
    url: `/api/v1/projects/${projectId}/relationship-graph`,
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json() as DataRelationshipGraphDto;
}

async function connectionPreview(
  app: FastifyInstance,
  state: DataRelationshipGraphDto,
  sourceFieldId: string,
  targetElementId: string,
  targetRole: string,
) {
  const source = state.nodes
    .find(({ type }) => type === "table")
    ?.ports.find(
      ({ direction, objectId }) =>
        direction === "output" && objectId === sourceFieldId,
    );
  const target = state.nodes
    .find(({ objectId }) => objectId === targetElementId)
    ?.ports.find(
      ({ direction, role }) => direction === "input" && role === targetRole,
    );
  expect(source).toBeDefined();
  expect(target).toBeDefined();
  const response = await app.inject({
    method: "POST",
    url: `/api/v1/projects/${state.projectId}/connections/preview`,
    payload: {
      sourcePortId: source?.id,
      targetPortId: target?.id,
      expectedGraphRevision: state.graphRevision,
      expectedProjectRevision: state.projectRevision,
    },
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json() as RelationshipConnectionPreviewDto;
}

function digest(path: string) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

describe("Phase 11 safe READ Binding Engine", () => {
  it("generates deterministic Test rows and previews bound FILTER/SORT/LIST data without changing Production", async () => {
    const { app, databasePath, storageRoot } = fixture();
    const seeded = await seed(app);
    const activePath = join(storageRoot, "active", seeded.project.id);
    const productionPath = join(activePath, "production.sqlite");
    const productionBefore = digest(productionPath);
    const valueField = seeded.schema.tables[0]?.fields.find(
      ({ displayName }) => displayName === "값",
    );
    expect(valueField).toBeDefined();
    const sampleKey = `sample-${randomUUID()}`;
    const samplePayload = {
      rowCount: 10,
      reset: true,
      idempotencyKey: sampleKey,
    };
    const sampleResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${seeded.project.id}/sample-data/generate`,
      payload: samplePayload,
    });
    expect(sampleResponse.statusCode, sampleResponse.body).toBe(200);
    const samples = sampleResponse.json() as SampleDataMutationDto;
    expect(samples).toMatchObject({ tableCount: 1, rowCount: 10 });
    expect(samples.databaseChecksum).toMatch(/^[0-9a-f]{64}$/u);
    const metadata = new Database(databasePath);
    metadata
      .prepare("DELETE FROM audit_logs WHERE correlation_id = ?")
      .run(sampleKey);
    metadata
      .prepare(
        `UPDATE sample_data_commands
         SET response_status = 202, response_json = ?
         WHERE project_id = ? AND idempotency_key = ?`,
      )
      .run(
        JSON.stringify({
          state: "PENDING",
          before: [{ tableId: seeded.schema.tables[0]?.id, count: 0 }],
          expected: [{ tableId: seeded.schema.tables[0]?.id, count: 10 }],
          responseRowCount: 10,
        }),
        seeded.project.id,
        sampleKey,
      );
    metadata.close();
    const sampleReplay = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${seeded.project.id}/sample-data/generate`,
      payload: samplePayload,
    });
    expect(sampleReplay.statusCode, sampleReplay.body).toBe(200);
    expect(sampleReplay.json()).toEqual(samples);
    const recoveredMetadata = new Database(databasePath, { readonly: true });
    expect(
      recoveredMetadata
        .prepare(
          "SELECT response_status FROM sample_data_commands WHERE project_id = ? AND idempotency_key = ?",
        )
        .get(seeded.project.id, sampleKey),
    ).toEqual({ response_status: 200 });
    expect(
      recoveredMetadata
        .prepare(
          "SELECT count(*) AS count FROM audit_logs WHERE correlation_id = ?",
        )
        .get(sampleKey),
    ).toEqual({ count: 1 });
    recoveredMetadata.close();
    expect(digest(productionPath)).toBe(productionBefore);

    const runtime = new Database(join(activePath, "test.sqlite"));
    runtime
      .prepare(
        `UPDATE "${seeded.schema.tables[0]?.physicalName}" SET "${valueField?.physicalName}" = -999`,
      )
      .run();
    runtime.close();
    const sameCountRegeneration = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${seeded.project.id}/sample-data/generate`,
      payload: {
        rowCount: 10,
        reset: true,
        idempotencyKey: `sample-${randomUUID()}`,
      },
    });
    expect(sameCountRegeneration.statusCode, sameCountRegeneration.body).toBe(
      200,
    );
    const regeneratedRuntime = new Database(join(activePath, "test.sqlite"), {
      readonly: true,
    });
    expect(
      regeneratedRuntime
        .prepare(
          `SELECT count(*) AS count FROM "${seeded.schema.tables[0]?.physicalName}" WHERE "${valueField?.physicalName}" = -999`,
        )
        .get(),
    ).toEqual({ count: 0 });
    regeneratedRuntime.close();

    const allFields = seeded.schema.tables[0]?.fields ?? [];
    const state = await graph(app, seeded.project.id);
    const connection = await connectionPreview(
      app,
      state,
      valueField?.id ?? "",
      seeded.tableElement.element.id,
      "rows",
    );
    const queryResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${seeded.project.id}/binding-query-previews`,
      payload: {
        connectionPreviewId: connection.previewId,
        spec: {
          mode: "LIST",
          selectFieldIds: allFields.map(({ id }) => id),
          filters: [{ fieldId: valueField?.id, operator: "GTE", value: 3.75 }],
          orderBy: [{ fieldId: valueField?.id, direction: "DESC" }],
          aggregate: null,
          groupByFieldId: null,
          limit: 5,
        },
        mapping: {
          shape: "ROWS",
          labelFieldId: null,
          valueFieldId: null,
          secondaryFieldId: null,
        },
        expectedGraphRevision: connection.graphRevision,
        expectedProjectRevision: connection.projectRevision,
      },
    });
    expect(queryResponse.statusCode, queryResponse.body).toBe(200);
    const query = queryResponse.json() as BindingQueryPreviewDto;
    expect(query.result).toMatchObject({
      rowCount: 5,
      truncated: true,
      renderState: "DATA",
    });
    expect(query.result.rows.map((row) => row[valueField?.id ?? ""])).toEqual([
      12.5, 11.25, 10, 8.75, 7.5,
    ]);
    expect(query.result.renderData.rows?.[0]).toMatchObject({ 값: 12.5 });
    expect(query.planChecksum).toMatch(/^[0-9a-f]{64}$/u);

    const createResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${seeded.project.id}/bindings`,
      payload: {
        previewId: connection.previewId,
        queryPreviewId: query.queryPreviewId,
        bindingType: "READ",
        expectedGraphRevision: query.graphRevision,
        expectedProjectRevision: query.projectRevision,
        idempotencyKey: `binding-${randomUUID()}`,
      },
    });
    expect(createResponse.statusCode, createResponse.body).toBe(201);
    const created = createResponse.json() as RelationshipBindingMutationDto;
    const executionResponse = await app.inject({
      method: "POST",
      url: `/api/v1/bindings/${created.binding.id}/preview`,
      payload: {},
    });
    expect(executionResponse.statusCode, executionResponse.body).toBe(200);
    const execution = executionResponse.json() as BindingExecutionDto;
    expect(execution.environment).toBe("test");
    expect(execution.result).toEqual(query.result);
    expect(execution.targetElementId).toBe(seeded.tableElement.element.id);
    expect(digest(productionPath)).toBe(productionBefore);
  });

  it("maps Histogram values, rejects raw SQL and stale/cancelled previews, and resets only Test rows", async () => {
    const { app, databasePath, storageRoot } = fixture();
    const seeded = await seed(app);
    const valueField = seeded.schema.tables[0]?.fields.find(
      ({ displayName }) => displayName === "값",
    );
    expect(valueField).toBeDefined();
    const sampleResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${seeded.project.id}/sample-data/generate`,
      payload: {
        rowCount: 12,
        reset: true,
        idempotencyKey: `sample-${randomUUID()}`,
      },
    });
    expect(sampleResponse.statusCode, sampleResponse.body).toBe(200);
    let state = await graph(app, seeded.project.id);
    const cancelledConnection = await connectionPreview(
      app,
      state,
      valueField?.id ?? "",
      seeded.histogramElement.element.id,
      "values",
    );
    const rawSql = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${seeded.project.id}/binding-query-previews`,
      payload: {
        connectionPreviewId: cancelledConnection.previewId,
        spec: {
          mode: "LIST",
          selectFieldIds: [valueField?.id],
          filters: [],
          orderBy: [],
          aggregate: null,
          groupByFieldId: null,
          limit: 100,
          sql: "DROP TABLE projects",
        },
        mapping: {
          shape: "VALUES",
          labelFieldId: null,
          valueFieldId: valueField?.id,
          secondaryFieldId: null,
        },
        expectedGraphRevision: cancelledConnection.graphRevision,
        expectedProjectRevision: cancelledConnection.projectRevision,
      },
    });
    expect(rawSql.statusCode, rawSql.body).toBe(400);
    const noBinding = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${seeded.project.id}/bindings`,
    });
    expect(noBinding.json()).toMatchObject({ bindings: [] });

    state = await graph(app, seeded.project.id);
    const connection = await connectionPreview(
      app,
      state,
      valueField?.id ?? "",
      seeded.histogramElement.element.id,
      "values",
    );
    const queryResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${seeded.project.id}/binding-query-previews`,
      payload: {
        connectionPreviewId: connection.previewId,
        spec: {
          mode: "LIST",
          selectFieldIds: [valueField?.id],
          filters: [
            {
              fieldId: valueField?.id,
              operator: "NE",
              value: "1 OR 1=1 --",
            },
          ],
          orderBy: [],
          aggregate: null,
          groupByFieldId: null,
          limit: 500,
        },
        mapping: {
          shape: "VALUES",
          labelFieldId: null,
          valueFieldId: valueField?.id,
          secondaryFieldId: null,
        },
        expectedGraphRevision: connection.graphRevision,
        expectedProjectRevision: connection.projectRevision,
      },
    });
    expect(queryResponse.statusCode, queryResponse.body).toBe(200);
    const query = queryResponse.json() as BindingQueryPreviewDto;
    expect(query.result.renderData.values).toEqual([
      1.25, 2.5, 3.75, 5, 6.25, 7.5, 8.75, 10, 11.25, 12.5, 13.75, 15,
    ]);

    const aggregateResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${seeded.project.id}/binding-query-previews`,
      payload: {
        connectionPreviewId: connection.previewId,
        spec: {
          mode: "AGGREGATE",
          selectFieldIds: [valueField?.id],
          filters: [],
          orderBy: [],
          aggregate: { function: "AVG", fieldId: valueField?.id },
          groupByFieldId: null,
          limit: 500,
        },
        mapping: {
          shape: "VALUES",
          labelFieldId: null,
          valueFieldId: valueField?.id,
          secondaryFieldId: null,
        },
        expectedGraphRevision: connection.graphRevision,
        expectedProjectRevision: connection.projectRevision,
      },
    });
    expect(aggregateResponse.statusCode, aggregateResponse.body).toBe(200);
    expect(
      (aggregateResponse.json() as BindingQueryPreviewDto).result.renderData
        .values,
    ).toEqual([8.125]);

    const createResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${seeded.project.id}/bindings`,
      payload: {
        previewId: connection.previewId,
        queryPreviewId: query.queryPreviewId,
        bindingType: "READ",
        expectedGraphRevision: query.graphRevision,
        expectedProjectRevision: query.projectRevision,
        idempotencyKey: `binding-${randomUUID()}`,
      },
    });
    expect(createResponse.statusCode, createResponse.body).toBe(201);
    const created = createResponse.json() as RelationshipBindingMutationDto;
    const publishResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${seeded.project.id}/publish`,
      payload: {
        expectedProjectRevision: created.projectRevision,
        idempotencyKey: `publish-binding-${randomUUID()}`,
      },
    });
    expect(publishResponse.statusCode, publishResponse.body).toBe(200);
    const productionPath = join(
      storageRoot,
      "active",
      seeded.project.id,
      "production.sqlite",
    );
    const productionBefore = digest(productionPath);
    const runtimeResponse = await app.inject({
      method: "POST",
      url: `/api/v1/runtime/${seeded.project.id}/query/${created.binding.id}`,
      payload: { parameters: {} },
    });
    expect(runtimeResponse.statusCode, runtimeResponse.body).toBe(409);
    expect(runtimeResponse.json()).toMatchObject({
      error: { code: "RUNTIME_SCHEMA_NOT_APPLIED" },
    });
    const resetResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${seeded.project.id}/sample-data/reset`,
      payload: { idempotencyKey: `reset-${randomUUID()}` },
    });
    expect(resetResponse.statusCode, resetResponse.body).toBe(200);
    expect(resetResponse.json()).toMatchObject({ rowCount: 12 });
    expect(digest(productionPath)).toBe(productionBefore);
    const afterReset = await app.inject({
      method: "POST",
      url: `/api/v1/bindings/${created.binding.id}/preview`,
      payload: {},
    });
    expect(afterReset.statusCode, afterReset.body).toBe(200);
    expect((afterReset.json() as BindingExecutionDto).result).toMatchObject({
      rowCount: 0,
      renderState: "EMPTY",
      renderData: { values: [] },
    });

    const otherProjectResponse = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      payload: {
        name: "다른 프로젝트",
        slug: `other-${randomUUID().slice(0, 8)}`,
      },
    });
    const otherProjectId = (
      otherProjectResponse.json() as { project: { id: string } }
    ).project.id;
    const crossProject = await app.inject({
      method: "POST",
      url: `/api/v1/runtime/${otherProjectId}/query/${created.binding.id}`,
      payload: { parameters: {} },
    });
    expect(crossProject.statusCode, crossProject.body).toBe(404);

    const metadata = new Database(databasePath);
    metadata.prepare("UPDATE bindings SET mapping_json = ? WHERE id = ?").run(
      JSON.stringify({
        target: {
          nodeType: "element",
          objectId: randomUUID(),
          portRole: "values",
        },
        render: query.mapping,
      }),
      created.binding.id,
    );
    metadata.close();
    const tampered = await app.inject({
      method: "POST",
      url: `/api/v1/bindings/${created.binding.id}/preview`,
      payload: {},
    });
    expect(tampered.statusCode, tampered.body).toBe(409);
    expect(tampered.json()).toMatchObject({
      error: { code: "BINDING_MAPPING_TARGET_MISMATCH" },
    });
  });

  it("expires the server-owned query candidate without creating a Binding", async () => {
    let now = new Date("2026-08-16T00:00:00.000Z");
    const { app } = fixture({ clock: () => now });
    const seeded = await seed(app);
    const valueField = seeded.schema.tables[0]?.fields.find(
      ({ displayName }) => displayName === "값",
    );
    const state = await graph(app, seeded.project.id);
    const connection = await connectionPreview(
      app,
      state,
      valueField?.id ?? "",
      seeded.histogramElement.element.id,
      "values",
    );
    const queryResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${seeded.project.id}/binding-query-previews`,
      payload: {
        connectionPreviewId: connection.previewId,
        spec: {
          mode: "LIST",
          selectFieldIds: [valueField?.id],
          filters: [],
          orderBy: [],
          aggregate: null,
          groupByFieldId: null,
          limit: 100,
        },
        mapping: {
          shape: "VALUES",
          labelFieldId: null,
          valueFieldId: valueField?.id,
          secondaryFieldId: null,
        },
        expectedGraphRevision: connection.graphRevision,
        expectedProjectRevision: connection.projectRevision,
      },
    });
    expect(queryResponse.statusCode, queryResponse.body).toBe(200);
    const query = queryResponse.json() as BindingQueryPreviewDto;
    now = new Date("2026-08-16T00:00:16.000Z");
    const createResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${seeded.project.id}/bindings`,
      payload: {
        previewId: connection.previewId,
        queryPreviewId: query.queryPreviewId,
        bindingType: "READ",
        expectedGraphRevision: query.graphRevision,
        expectedProjectRevision: query.projectRevision,
        idempotencyKey: `expired-${randomUUID()}`,
      },
    });
    expect(createResponse.statusCode, createResponse.body).toBe(409);
    expect(createResponse.json()).toMatchObject({
      error: { code: "BINDING_QUERY_PREVIEW_NOT_FOUND" },
    });
    const bindings = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${seeded.project.id}/bindings`,
    });
    expect(bindings.json()).toMatchObject({ bindings: [] });
  });
});
