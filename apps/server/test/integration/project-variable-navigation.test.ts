import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  BindingQueryPreviewDto,
  DataRelationshipGraphDto,
  DataSchemaDto,
  DraftPreviewDto,
  DraftRuntimeNavigationDto,
  DraftRuntimePageDto,
  ElementEntryDto,
  PageDto,
  ProjectVariableMutationDto,
  RelationshipBindingMutationDto,
  RelationshipConnectionPreviewDto,
  RuntimeBindingResultDto,
} from "@webeditor/domain";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { buildServer } from "../../src/app.js";

const apps: FastifyInstance[] = [];
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "webeditor-phase14-"));
  directories.push(directory);
  const app = buildServer({
    metadataDatabasePath: join(directory, "metadata", "webeditor.sqlite"),
    storageRoot: join(directory, "projects"),
  });
  apps.push(app);
  return app;
}

async function graph(app: FastifyInstance, projectId: string) {
  const response = await app.inject({
    method: "GET",
    url: `/api/v1/projects/${projectId}/relationship-graph`,
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json() as DataRelationshipGraphDto;
}

async function previewConnection(
  app: FastifyInstance,
  state: DataRelationshipGraphDto,
  input: {
    readonly sourceObjectId: string;
    readonly sourceRole?: string;
    readonly targetObjectId: string;
    readonly targetRole: string;
  },
) {
  const source = state.nodes
    .flatMap(({ ports }) => ports)
    .find(
      ({ direction, role, objectId }) =>
        direction === "output" &&
        (input.sourceRole === undefined
          ? objectId === input.sourceObjectId
          : role === input.sourceRole && objectId === input.sourceObjectId),
    );
  const target = state.nodes
    .find(({ objectId }) => objectId === input.targetObjectId)
    ?.ports.find(
      ({ direction, role }) =>
        direction === "input" && role === input.targetRole,
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

async function createRead(
  app: FastifyInstance,
  projectId: string,
  sourceFieldId: string,
  targetElementId: string,
  targetRole: string,
  selectFieldIds: readonly string[],
  shape: "ROWS" | "VALUES",
) {
  const state = await graph(app, projectId);
  const connection = await previewConnection(app, state, {
    sourceObjectId: sourceFieldId,
    targetObjectId: targetElementId,
    targetRole,
  });
  const queryResponse = await app.inject({
    method: "POST",
    url: `/api/v1/projects/${projectId}/binding-query-previews`,
    payload: {
      connectionPreviewId: connection.previewId,
      spec: {
        mode: "LIST",
        selectFieldIds,
        filters: [],
        orderBy: [],
        aggregate: null,
        groupByFieldId: null,
        limit: 100,
      },
      mapping: {
        shape,
        labelFieldId: null,
        valueFieldId: shape === "VALUES" ? sourceFieldId : null,
        secondaryFieldId: null,
      },
      expectedGraphRevision: connection.graphRevision,
      expectedProjectRevision: connection.projectRevision,
    },
  });
  expect(queryResponse.statusCode, queryResponse.body).toBe(200);
  const query = queryResponse.json() as BindingQueryPreviewDto;
  const response = await app.inject({
    method: "POST",
    url: `/api/v1/projects/${projectId}/bindings`,
    payload: {
      previewId: connection.previewId,
      queryPreviewId: query.queryPreviewId,
      bindingType: "READ",
      expectedGraphRevision: query.graphRevision,
      expectedProjectRevision: query.projectRevision,
      idempotencyKey: `read-${randomUUID()}`,
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json() as RelationshipBindingMutationDto;
}

describe("Phase 14 Project Variable navigation", () => {
  it("persists typed variables with revision, key uniqueness, and exact delete replay", async () => {
    const app = fixture();
    const projectResponse = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      payload: {
        name: "변수 Registry",
        slug: `variable-registry-${randomUUID().slice(0, 8)}`,
      },
    });
    const project = (
      projectResponse.json() as {
        project: { id: string; revision: number };
      }
    ).project;
    const createPayload = {
      key: "selected_lot",
      name: "선택 Lot",
      valueType: "number",
      scope: "session",
      transport: "URL_QUERY",
      sensitive: false,
      defaultValue: null,
      expectedProjectRevision: project.revision,
      idempotencyKey: `variable-${randomUUID()}`,
    } as const;
    const createResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/variables`,
      payload: createPayload,
    });
    expect(createResponse.statusCode, createResponse.body).toBe(201);
    const created = createResponse.json() as ProjectVariableMutationDto;
    const replayResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/variables`,
      payload: createPayload,
    });
    expect(replayResponse.statusCode, replayResponse.body).toBe(201);
    expect(replayResponse.json()).toEqual(created);

    const duplicateResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/variables`,
      payload: {
        ...createPayload,
        expectedProjectRevision: created.projectRevision,
        idempotencyKey: `variable-${randomUUID()}`,
      },
    });
    expect(duplicateResponse.statusCode, duplicateResponse.body).toBe(409);
    expect(duplicateResponse.json()).toMatchObject({
      error: { code: "VARIABLE_KEY_CONFLICT" },
    });

    const sensitiveUrlResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/variables`,
      payload: {
        ...createPayload,
        key: "secret",
        sensitive: true,
        expectedProjectRevision: created.projectRevision,
        idempotencyKey: `variable-${randomUUID()}`,
      },
    });
    expect(sensitiveUrlResponse.statusCode, sensitiveUrlResponse.body).toBe(
      400,
    );
    expect(sensitiveUrlResponse.json()).toMatchObject({
      error: { code: "SENSITIVE_VARIABLE_URL_FORBIDDEN" },
    });

    const updateResponse = await app.inject({
      method: "PATCH",
      url: `/api/v1/variables/${created.variable.id}`,
      payload: {
        name: "선택 Lot ID",
        expectedRevision: created.variable.revision,
        expectedProjectRevision: created.projectRevision,
        idempotencyKey: `variable-update-${randomUUID()}`,
      },
    });
    expect(updateResponse.statusCode, updateResponse.body).toBe(200);
    const updated = updateResponse.json() as ProjectVariableMutationDto;
    expect(updated.variable).toMatchObject({
      name: "선택 Lot ID",
      revision: 2,
    });

    const deletePayload = {
      expectedRevision: updated.variable.revision,
      expectedProjectRevision: updated.projectRevision,
      idempotencyKey: `variable-delete-${randomUUID()}`,
    };
    const deleteResponse = await app.inject({
      method: "DELETE",
      url: `/api/v1/variables/${updated.variable.id}`,
      payload: deletePayload,
    });
    expect(deleteResponse.statusCode, deleteResponse.body).toBe(200);
    const deleted = deleteResponse.json();
    const deleteReplayResponse = await app.inject({
      method: "DELETE",
      url: `/api/v1/variables/${updated.variable.id}`,
      payload: deletePayload,
    });
    expect(deleteReplayResponse.statusCode, deleteReplayResponse.body).toBe(
      200,
    );
    expect(deleteReplayResponse.json()).toEqual(deleted);
    const listResponse = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${project.id}/variables`,
    });
    expect(listResponse.statusCode, listResponse.body).toBe(200);
    expect(listResponse.json()).toMatchObject({ variables: [] });
  });

  it("selects one Data Table value, navigates, and executes only the declared filtered READ", async () => {
    const app = fixture();
    const projectResponse = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      payload: {
        name: "변수 이동",
        slug: `variable-navigation-${randomUUID().slice(0, 8)}`,
      },
    });
    expect(projectResponse.statusCode, projectResponse.body).toBe(201);
    const project = (
      projectResponse.json() as {
        project: { id: string; revision: number };
      }
    ).project;

    const sourcePageResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/pages`,
      payload: {
        name: "목록",
        pageType: "blank",
        expectedProjectRevision: project.revision,
        idempotencyKey: `page-${randomUUID()}`,
      },
    });
    const sourcePage = sourcePageResponse.json() as {
      page: PageDto;
      projectRevision: number;
    };
    const targetPageResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/pages`,
      payload: {
        name: "상세",
        pageType: "blank",
        expectedProjectRevision: sourcePage.projectRevision,
        idempotencyKey: `page-${randomUUID()}`,
      },
    });
    const targetPage = targetPageResponse.json() as {
      page: PageDto;
      projectRevision: number;
    };

    const tableElementResponse = await app.inject({
      method: "POST",
      url: `/api/v1/pages/${sourcePage.page.id}/elements`,
      payload: {
        elementType: "data-table",
        expectedLayoutRevision: 0,
        expectedProjectRevision: targetPage.projectRevision,
        idempotencyKey: `element-${randomUUID()}`,
      },
    });
    expect(tableElementResponse.statusCode, tableElementResponse.body).toBe(
      201,
    );
    const tableElement = tableElementResponse.json() as {
      entry: ElementEntryDto;
      projectRevision: number;
    };
    const chartElementResponse = await app.inject({
      method: "POST",
      url: `/api/v1/pages/${targetPage.page.id}/elements`,
      payload: {
        elementType: "histogram",
        expectedLayoutRevision: 0,
        expectedProjectRevision: tableElement.projectRevision,
        idempotencyKey: `element-${randomUUID()}`,
      },
    });
    expect(chartElementResponse.statusCode, chartElementResponse.body).toBe(
      201,
    );
    const chartElement = chartElementResponse.json() as {
      entry: ElementEntryDto;
      projectRevision: number;
    };

    const tableResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/tables`,
      payload: {
        displayName: "측정값",
        template: "TIME_SERIES",
        expectedSchemaRevision: 0,
        expectedProjectRevision: chartElement.projectRevision,
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
    const sampleResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/sample-data/generate`,
      payload: {
        rowCount: 8,
        reset: true,
        idempotencyKey: `sample-${randomUUID()}`,
      },
    });
    expect(sampleResponse.statusCode, sampleResponse.body).toBe(200);

    const valueField = schema.tables[0]?.fields.find(
      ({ displayName }) => displayName === "값",
    );
    expect(valueField).toBeDefined();
    const tableRead = await createRead(
      app,
      project.id,
      valueField?.id ?? "",
      tableElement.entry.element.id,
      "rows",
      schema.tables[0]?.fields.map(({ id }) => id) ?? [],
      "ROWS",
    );
    const chartRead = await createRead(
      app,
      project.id,
      valueField?.id ?? "",
      chartElement.entry.element.id,
      "values",
      [valueField?.id ?? ""],
      "VALUES",
    );

    let state = await graph(app, project.id);
    const variableResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/variables`,
      payload: {
        key: "selected_value",
        name: "선택값",
        valueType: "number",
        scope: "session",
        transport: "URL_QUERY",
        sensitive: false,
        defaultValue: null,
        expectedProjectRevision: state.projectRevision,
        idempotencyKey: `variable-${randomUUID()}`,
      },
    });
    expect(variableResponse.statusCode, variableResponse.body).toBe(201);
    const variable = variableResponse.json() as ProjectVariableMutationDto;

    state = await graph(app, project.id);
    const filterPreview = await previewConnection(app, state, {
      sourceObjectId: tableElement.entry.element.id,
      sourceRole: "selection",
      targetObjectId: chartElement.entry.element.id,
      targetRole: "values",
    });
    expect(filterPreview.allowedBindingTypes).toContain("FILTER");
    const filterResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/bindings`,
      payload: {
        previewId: filterPreview.previewId,
        bindingType: "FILTER",
        dependency: {
          kind: "FILTER",
          variableId: variable.variable.id,
          sourceFieldId: valueField?.id,
          targetReadBindingId: chartRead.binding.id,
          targetFieldId: valueField?.id,
          operator: "EQ",
        },
        expectedGraphRevision: filterPreview.graphRevision,
        expectedProjectRevision: filterPreview.projectRevision,
        idempotencyKey: `filter-${randomUUID()}`,
      },
    });
    expect(filterResponse.statusCode, filterResponse.body).toBe(201);

    state = await graph(app, project.id);
    const navigatePreview = await previewConnection(app, state, {
      sourceObjectId: tableElement.entry.element.id,
      sourceRole: "selection",
      targetObjectId: targetPage.page.id,
      targetRole: "navigation",
    });
    expect(navigatePreview.allowedBindingTypes).toContain("NAVIGATE");
    const navigateResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/bindings`,
      payload: {
        previewId: navigatePreview.previewId,
        bindingType: "NAVIGATE",
        dependency: {
          kind: "NAVIGATE",
          variableId: variable.variable.id,
          sourceFieldId: valueField?.id,
          targetPageId: targetPage.page.id,
          transport: "URL_QUERY",
        },
        expectedGraphRevision: navigatePreview.graphRevision,
        expectedProjectRevision: navigatePreview.projectRevision,
        idempotencyKey: `navigate-${randomUUID()}`,
      },
    });
    expect(navigateResponse.statusCode, navigateResponse.body).toBe(201);
    const navigate = navigateResponse.json() as RelationshipBindingMutationDto;

    const previewResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/draft-previews`,
      payload: { expectedProjectRevision: navigate.projectRevision },
    });
    expect(previewResponse.statusCode, previewResponse.body).toBe(201);
    const preview = previewResponse.json() as DraftPreviewDto;
    const navigationResponse = await app.inject({
      method: "GET",
      url: `/api/v1/draft-previews/${preview.previewId}/navigation`,
    });
    const navigation = navigationResponse.json() as DraftRuntimeNavigationDto;
    expect(navigation.variables).toEqual([variable.variable]);
    const sourceRuntimeResponse = await app.inject({
      method: "GET",
      url: `/api/v1/draft-previews/${preview.previewId}/pages/${sourcePage.page.id}`,
    });
    const sourceRuntime = sourceRuntimeResponse.json() as DraftRuntimePageDto;
    expect(sourceRuntime.actionChains).toHaveLength(1);
    expect(sourceRuntime.actionChains[0]).toMatchObject({
      sourceElementId: tableElement.entry.element.id,
      variableId: variable.variable.id,
      sourceFieldId: valueField?.id,
      filter: { targetReadBindingId: chartRead.binding.id },
      navigation: { targetPageId: targetPage.page.id, transport: "URL_QUERY" },
    });

    const sourceDataResponse = await app.inject({
      method: "POST",
      url: `/api/v1/draft-previews/${preview.previewId}/query/${tableRead.binding.id}`,
      payload: { parameters: {} },
    });
    expect(sourceDataResponse.statusCode, sourceDataResponse.body).toBe(200);
    const sourceData = sourceDataResponse.json() as RuntimeBindingResultDto;
    const selectedValue = sourceData.result.rows[2]?.[valueField?.id ?? ""];
    expect(typeof selectedValue).toBe("number");
    const filteredResponse = await app.inject({
      method: "POST",
      url: `/api/v1/draft-previews/${preview.previewId}/query/${chartRead.binding.id}`,
      payload: { parameters: { [variable.variable.id]: selectedValue } },
    });
    expect(filteredResponse.statusCode, filteredResponse.body).toBe(200);
    const filtered = filteredResponse.json() as RuntimeBindingResultDto;
    expect(filtered.result.rows).toHaveLength(1);
    expect(filtered.result.rows[0]?.[valueField?.id ?? ""]).toBe(selectedValue);
    expect(filtered.result.renderData.values).toEqual([selectedValue]);

    const undeclaredResponse = await app.inject({
      method: "POST",
      url: `/api/v1/draft-previews/${preview.previewId}/query/${tableRead.binding.id}`,
      payload: { parameters: { [variable.variable.id]: selectedValue } },
    });
    expect(undeclaredResponse.statusCode, undeclaredResponse.body).toBe(400);
    expect(undeclaredResponse.json()).toMatchObject({
      error: { code: "UNSUPPORTED_BINDING_PARAMETER" },
    });
  });
});
