import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  BindingQueryPreviewDto,
  DataRelationshipGraphDto,
  DataSchemaDto,
  DraftPreviewDto,
  ElementEntryDto,
  PageDto,
  RelationshipBindingMutationDto,
  RelationshipBindingType,
  RelationshipConnectionPreviewDto,
  RuntimeBindingMutationDto,
  RuntimeBindingResultDto,
} from "@webeditor/domain";
import Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { buildServer } from "../../src/app.js";

const directories: string[] = [];
const apps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "webeditor-phase13-"));
  directories.push(directory);
  const storageRoot = join(directory, "projects");
  const app = buildServer({
    metadataDatabasePath: join(directory, "metadata", "webeditor.sqlite"),
    storageRoot,
  });
  apps.push(app);
  return { app, storageRoot };
}

function digest(path: string) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

async function graph(app: FastifyInstance, projectId: string) {
  const response = await app.inject({
    method: "GET",
    url: `/api/v1/projects/${projectId}/relationship-graph`,
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json() as DataRelationshipGraphDto;
}

async function addElement(
  app: FastifyInstance,
  pageId: string,
  elementType: "button" | "number-input" | "data-table",
  layoutRevision: number,
  projectRevision: number,
) {
  const response = await app.inject({
    method: "POST",
    url: `/api/v1/pages/${pageId}/elements`,
    payload: {
      elementType,
      expectedLayoutRevision: layoutRevision,
      expectedProjectRevision: projectRevision,
      idempotencyKey: `${elementType}-${randomUUID()}`,
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json() as {
    entry: ElementEntryDto;
    layoutRevision: number;
    projectRevision: number;
  };
}

async function connection(
  app: FastifyInstance,
  state: DataRelationshipGraphDto,
  sourceElementId: string,
  targetTableId: string,
) {
  const source = state.nodes
    .find(({ objectId }) => objectId === sourceElementId)
    ?.ports.find(
      ({ direction, valueType }) =>
        direction === "output" && valueType === "event",
    );
  const target = state.nodes
    .find(({ objectId }) => objectId === targetTableId)
    ?.ports.find(
      ({ direction, role }) => direction === "input" && role === "record",
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

async function createWriteBinding(
  app: FastifyInstance,
  state: DataRelationshipGraphDto,
  sourceElementId: string,
  targetTableId: string,
  bindingType: Extract<RelationshipBindingType, "CREATE" | "UPDATE" | "DELETE">,
  fieldMappings: readonly {
    readonly fieldId: string;
    readonly inputElementId: string;
  }[],
) {
  const preview = await connection(app, state, sourceElementId, targetTableId);
  const response = await app.inject({
    method: "POST",
    url: `/api/v1/projects/${state.projectId}/bindings`,
    payload: {
      previewId: preview.previewId,
      bindingType,
      mutation: { fieldMappings },
      expectedGraphRevision: preview.graphRevision,
      expectedProjectRevision: preview.projectRevision,
      idempotencyKey: `${bindingType.toLowerCase()}-binding-${randomUUID()}`,
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json() as RelationshipBindingMutationDto;
}

describe("Phase 13 transactional CRUD Binding Runtime", () => {
  it("creates, refreshes, updates, and deletes real Test rows with rollback and idempotent replay", async () => {
    const { app, storageRoot } = fixture();
    const projectResponse = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      payload: {
        name: "CRUD Runtime",
        slug: `crud-${randomUUID().slice(0, 8)}`,
      },
    });
    expect(projectResponse.statusCode, projectResponse.body).toBe(201);
    const project = (
      projectResponse.json() as { project: { id: string; revision: number } }
    ).project;
    const pageResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/pages`,
      payload: {
        name: "입력",
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
    let layoutRevision = 0;
    let projectRevision = page.projectRevision;
    const entries: ElementEntryDto[] = [];
    for (const type of [
      "number-input",
      "number-input",
      "button",
      "button",
      "button",
      "data-table",
    ] as const) {
      const added = await addElement(
        app,
        page.page.id,
        type,
        layoutRevision,
        projectRevision,
      );
      entries.push(added.entry);
      layoutRevision = added.layoutRevision;
      projectRevision = added.projectRevision;
    }
    const [
      idInput,
      valueInput,
      createButton,
      updateButton,
      deleteButton,
      tableElement,
    ] = entries;
    expect(entries.every(Boolean)).toBe(true);

    const tableResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/tables`,
      payload: {
        displayName: "측정값",
        template: "BLANK",
        expectedSchemaRevision: 0,
        expectedProjectRevision: projectRevision,
        idempotencyKey: `table-${randomUUID()}`,
      },
    });
    let schema = tableResponse.json() as DataSchemaDto;
    const idField = schema.tables[0]?.fields[0];
    expect(idField).toBeDefined();
    const idPatch = await app.inject({
      method: "PATCH",
      url: `/api/v1/fields/${idField?.id}`,
      payload: {
        type: "INTEGER",
        primaryKey: true,
        autoIncrement: true,
        nullable: false,
        expectedRevision: idField?.revision,
        expectedSchemaRevision: schema.schemaRevision,
        expectedProjectRevision: schema.projectRevision,
        idempotencyKey: `id-field-${randomUUID()}`,
      },
    });
    expect(idPatch.statusCode, idPatch.body).toBe(200);
    schema = idPatch.json() as DataSchemaDto;
    const valueResponse = await app.inject({
      method: "POST",
      url: `/api/v1/tables/${schema.tables[0]?.id}/fields`,
      payload: {
        displayName: "값",
        type: "REAL",
        nullable: false,
        unique: true,
        expectedSchemaRevision: schema.schemaRevision,
        expectedProjectRevision: schema.projectRevision,
        idempotencyKey: `value-field-${randomUUID()}`,
      },
    });
    expect(valueResponse.statusCode, valueResponse.body).toBe(201);
    schema = valueResponse.json() as DataSchemaDto;
    const table = schema.tables[0];
    const primary = table?.fields.find(({ primaryKey }) => primaryKey);
    const valueField = table?.fields.find(
      ({ displayName }) => displayName === "값",
    );
    expect(primary).toBeDefined();
    expect(valueField).toBeDefined();
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

    let state = await graph(app, project.id);
    const created = await createWriteBinding(
      app,
      state,
      createButton?.element.id ?? "",
      table?.id ?? "",
      "CREATE",
      [
        {
          fieldId: valueField?.id ?? "",
          inputElementId: valueInput?.element.id ?? "",
        },
      ],
    );
    state = await graph(app, project.id);
    const updated = await createWriteBinding(
      app,
      state,
      updateButton?.element.id ?? "",
      table?.id ?? "",
      "UPDATE",
      [
        {
          fieldId: primary?.id ?? "",
          inputElementId: idInput?.element.id ?? "",
        },
        {
          fieldId: valueField?.id ?? "",
          inputElementId: valueInput?.element.id ?? "",
        },
      ],
    );
    state = await graph(app, project.id);
    const deleted = await createWriteBinding(
      app,
      state,
      deleteButton?.element.id ?? "",
      table?.id ?? "",
      "DELETE",
      [
        {
          fieldId: primary?.id ?? "",
          inputElementId: idInput?.element.id ?? "",
        },
      ],
    );

    state = await graph(app, project.id);
    const source = state.nodes
      .find(({ objectId }) => objectId === table?.id)
      ?.ports.find(
        ({ direction, objectId }) =>
          direction === "output" && objectId === valueField?.id,
      );
    const target = state.nodes
      .find(({ objectId }) => objectId === tableElement?.element.id)
      ?.ports.find(
        ({ direction, role }) => direction === "input" && role === "rows",
      );
    const readConnectionResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/connections/preview`,
      payload: {
        sourcePortId: source?.id,
        targetPortId: target?.id,
        expectedGraphRevision: state.graphRevision,
        expectedProjectRevision: state.projectRevision,
      },
    });
    const readConnection =
      readConnectionResponse.json() as RelationshipConnectionPreviewDto;
    const queryResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/binding-query-previews`,
      payload: {
        connectionPreviewId: readConnection.previewId,
        spec: {
          mode: "LIST",
          selectFieldIds: table?.fields.map(({ id }) => id),
          filters: [],
          orderBy: [{ fieldId: primary?.id, direction: "ASC" }],
          aggregate: null,
          groupByFieldId: null,
          limit: 100,
        },
        mapping: {
          shape: "ROWS",
          labelFieldId: null,
          valueFieldId: null,
          secondaryFieldId: null,
        },
        expectedGraphRevision: readConnection.graphRevision,
        expectedProjectRevision: readConnection.projectRevision,
      },
    });
    expect(queryResponse.statusCode, queryResponse.body).toBe(200);
    const query = queryResponse.json() as BindingQueryPreviewDto;
    const readResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/bindings`,
      payload: {
        previewId: readConnection.previewId,
        queryPreviewId: query.queryPreviewId,
        bindingType: "READ",
        expectedGraphRevision: query.graphRevision,
        expectedProjectRevision: query.projectRevision,
        idempotencyKey: `read-binding-${randomUUID()}`,
      },
    });
    const read = readResponse.json() as RelationshipBindingMutationDto;
    const previewResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/draft-previews`,
      payload: { expectedProjectRevision: read.projectRevision },
    });
    expect(previewResponse.statusCode, previewResponse.body).toBe(201);
    const preview = previewResponse.json() as DraftPreviewDto;
    const runtimePageResponse = await app.inject({
      method: "GET",
      url: `/api/v1/draft-previews/${preview.previewId}/pages/${page.page.id}`,
    });
    expect(runtimePageResponse.statusCode, runtimePageResponse.body).toBe(200);
    expect(
      (
        runtimePageResponse.json() as {
          readonly bindings: readonly { readonly id: string }[];
        }
      ).bindings.map(({ id }) => id),
    ).toEqual([
      created.binding.id,
      updated.binding.id,
      deleted.binding.id,
      read.binding.id,
    ]);
    const productionPath = join(
      storageRoot,
      "active",
      project.id,
      "production.sqlite",
    );
    const productionBefore = digest(productionPath);

    const invalid = await app.inject({
      method: "POST",
      url: `/api/v1/draft-previews/${preview.previewId}/create/${created.binding.id}`,
      payload: {
        values: { [valueInput?.element.id ?? ""]: null },
        idempotencyKey: `invalid-${randomUUID()}`,
      },
    });
    expect(invalid.statusCode, invalid.body).toBe(422);
    expect(invalid.json()).toMatchObject({
      error: {
        code: "BINDING_MUTATION_VALIDATION_FAILED",
        details: {
          fieldErrors: [
            { fieldId: valueField?.id, inputElementId: valueInput?.element.id },
          ],
        },
      },
    });

    const createKey = `create-row-${randomUUID()}`;
    const createPayload = {
      values: { [valueInput?.element.id ?? ""]: 12.5 },
      idempotencyKey: createKey,
    };
    const createRow = await app.inject({
      method: "POST",
      url: `/api/v1/draft-previews/${preview.previewId}/create/${created.binding.id}`,
      payload: createPayload,
    });
    expect(createRow.statusCode, createRow.body).toBe(200);
    const createResult = createRow.json() as RuntimeBindingMutationDto;
    expect(createResult).toMatchObject({
      operation: "CREATE",
      environment: "test",
      affectedRows: 1,
      insertedPrimaryKey: 1,
      refreshBindingIds: [read.binding.id],
    });
    const replay = await app.inject({
      method: "POST",
      url: `/api/v1/draft-previews/${preview.previewId}/create/${created.binding.id}`,
      payload: createPayload,
    });
    expect(replay.json()).toEqual(createResult);

    const constraint = await app.inject({
      method: "POST",
      url: `/api/v1/draft-previews/${preview.previewId}/create/${created.binding.id}`,
      payload: {
        values: { [valueInput?.element.id ?? ""]: 12.5 },
        idempotencyKey: `create-duplicate-${randomUUID()}`,
      },
    });
    expect(constraint.statusCode, constraint.body).toBe(409);
    expect(constraint.json()).toMatchObject({
      error: {
        code: "BINDING_MUTATION_CONSTRAINT",
        details: {
          fieldErrors: [
            { fieldId: valueField?.id, inputElementId: valueInput?.element.id },
          ],
        },
      },
    });

    const readAfterCreate = await app.inject({
      method: "POST",
      url: `/api/v1/draft-previews/${preview.previewId}/query/${read.binding.id}`,
      payload: { parameters: {} },
    });
    expect(readAfterCreate.statusCode, readAfterCreate.body).toBe(200);
    expect(
      (readAfterCreate.json() as RuntimeBindingResultDto).result.renderData
        .rows,
    ).toEqual([{ ID: 1, 값: 12.5 }]);

    const updateRow = await app.inject({
      method: "POST",
      url: `/api/v1/draft-previews/${preview.previewId}/update/${updated.binding.id}`,
      payload: {
        values: {
          [idInput?.element.id ?? ""]: 1,
          [valueInput?.element.id ?? ""]: 27.25,
        },
        idempotencyKey: `update-row-${randomUUID()}`,
      },
    });
    expect(updateRow.statusCode, updateRow.body).toBe(200);
    expect(updateRow.json()).toMatchObject({
      operation: "UPDATE",
      affectedRows: 1,
    });

    const conflict = await app.inject({
      method: "POST",
      url: `/api/v1/draft-previews/${preview.previewId}/update/${updated.binding.id}`,
      payload: {
        values: {
          [idInput?.element.id ?? ""]: 999,
          [valueInput?.element.id ?? ""]: 1,
        },
        idempotencyKey: `update-missing-${randomUUID()}`,
      },
    });
    expect(conflict.statusCode, conflict.body).toBe(409);
    expect(conflict.json()).toMatchObject({
      error: { code: "BINDING_MUTATION_ROW_CONFLICT" },
    });

    const deleteRow = await app.inject({
      method: "POST",
      url: `/api/v1/draft-previews/${preview.previewId}/delete/${deleted.binding.id}`,
      payload: {
        values: { [idInput?.element.id ?? ""]: 1 },
        idempotencyKey: `delete-row-${randomUUID()}`,
      },
    });
    expect(deleteRow.statusCode, deleteRow.body).toBe(200);
    expect(deleteRow.json()).toMatchObject({
      operation: "DELETE",
      affectedRows: 1,
    });
    const readAfterDelete = await app.inject({
      method: "POST",
      url: `/api/v1/draft-previews/${preview.previewId}/query/${read.binding.id}`,
      payload: { parameters: {} },
    });
    expect(
      (readAfterDelete.json() as RuntimeBindingResultDto).result.rowCount,
    ).toBe(0);
    expect(digest(productionPath)).toBe(productionBefore);

    const testDatabase = new Database(
      join(storageRoot, "active", project.id, "test.sqlite"),
      { readonly: true },
    );
    expect(
      testDatabase
        .prepare(`SELECT count(*) AS count FROM "${table?.physicalName}"`)
        .get(),
    ).toEqual({ count: 0 });
    expect(
      testDatabase
        .prepare(
          "SELECT count(*) AS count FROM webeditor_runtime_mutation_commands",
        )
        .get(),
    ).toEqual({ count: 3 });
    testDatabase.close();
  });
});
