import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  BindingQueryPreviewDto,
  DataRelationshipGraphDto,
  DataSchemaDto,
  ElementEntryDto,
  PageDto,
  RelationshipBindingMutationDto,
  RelationshipAutoLayoutApplyDto,
  RelationshipAutoLayoutPreviewDto,
  RelationshipConnectionPreviewDto,
  RelationshipHistoryDto,
  RelationshipHistoryMutationDto,
  RelationshipLayoutHistoryDto,
  RelationshipLayoutHistoryMutationDto,
  RelationshipNodePositionMutationDto,
  RelationshipRoutePreviewDto,
  RelationshipViewportDto,
} from "@webeditor/domain";
import Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { buildServer } from "../../src/app.js";

interface Fixture {
  readonly directory: string;
  readonly databasePath: string;
  readonly storageRoot: string;
}

const directories: string[] = [];
const apps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function fixture(): Fixture {
  const directory = mkdtempSync(join(tmpdir(), "webeditor-phase9-"));
  directories.push(directory);
  return {
    directory,
    databasePath: join(directory, "metadata", "webeditor.sqlite"),
    storageRoot: join(directory, "projects"),
  };
}

function server(current: Fixture): FastifyInstance {
  const app = buildServer({
    metadataDatabasePath: current.databasePath,
    storageRoot: current.storageRoot,
  });
  apps.push(app);
  return app;
}

async function close(app: FastifyInstance): Promise<void> {
  const index = apps.indexOf(app);
  if (index >= 0) apps.splice(index, 1);
  await app.close();
}

async function seed(app: FastifyInstance) {
  const projectResponse = await app.inject({
    method: "POST",
    url: "/api/v1/projects",
    payload: {
      name: `관계 ${randomUUID().slice(0, 8)}`,
      slug: `relationship-${randomUUID().slice(0, 8)}`,
    },
  });
  expect(projectResponse.statusCode, projectResponse.body).toBe(201);
  const project = (
    projectResponse.json() as {
      project: { id: string; revision: number; lifecycleRevision: number };
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
  const pageBody = pageResponse.json() as {
    readonly page: PageDto;
    readonly projectRevision: number;
  };
  const elementResponse = await app.inject({
    method: "POST",
    url: `/api/v1/pages/${pageBody.page.id}/elements`,
    payload: {
      elementType: "data-table",
      expectedLayoutRevision: 0,
      expectedProjectRevision: pageBody.projectRevision,
      idempotencyKey: `element-${randomUUID()}`,
    },
  });
  expect(elementResponse.statusCode, elementResponse.body).toBe(201);
  const element = elementResponse.json() as {
    readonly entry: ElementEntryDto;
    readonly projectRevision: number;
  };
  const tableResponse = await app.inject({
    method: "POST",
    url: `/api/v1/projects/${project.id}/tables`,
    payload: {
      displayName: "측정값",
      template: "ENTITY",
      expectedSchemaRevision: 0,
      expectedProjectRevision: element.projectRevision,
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
  return { project, page: pageBody.page, element: element.entry, schema };
}

async function readQueryPreview(
  app: FastifyInstance,
  seeded: Awaited<ReturnType<typeof seed>>,
  connection: RelationshipConnectionPreviewDto,
): Promise<BindingQueryPreviewDto> {
  const fields = seeded.schema.tables[0]?.fields ?? [];
  const response = await app.inject({
    method: "POST",
    url: `/api/v1/projects/${seeded.project.id}/binding-query-previews`,
    payload: {
      connectionPreviewId: connection.previewId,
      spec: {
        mode: "LIST",
        selectFieldIds: fields.map(({ id }) => id),
        filters: [],
        orderBy: [],
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
      expectedGraphRevision: connection.graphRevision,
      expectedProjectRevision: connection.projectRevision,
    },
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json() as BindingQueryPreviewDto;
}

async function graph(app: FastifyInstance, projectId: string) {
  const response = await app.inject({
    method: "GET",
    url: `/api/v1/projects/${projectId}/relationship-graph`,
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json() as DataRelationshipGraphDto;
}

describe("Phase 9 Data Relationship Canvas", () => {
  it("projects Page, Element, and Table nodes with strict left-input/right-output ports and blocks forbidden directions before writing", async () => {
    const current = fixture();
    const app = server(current);
    const seeded = await seed(app);
    const initial = await graph(app, seeded.project.id);

    expect(initial.nodes.map(({ type }) => type).sort()).toEqual([
      "element",
      "page",
      "table",
    ]);
    expect(initial.edges).toEqual([]);
    for (const node of initial.nodes) {
      for (const port of node.ports) {
        expect(port.id).toMatch(
          new RegExp(`^${port.objectId}:.+:${port.direction}:[0-9]+$`),
        );
        expect(port.side).toBe(port.direction === "input" ? "left" : "right");
      }
    }

    const inputPorts = initial.nodes.flatMap((node) =>
      node.ports.filter(({ direction }) => direction === "input"),
    );
    const invalid = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${seeded.project.id}/connections/preview`,
      payload: {
        sourcePortId: inputPorts[0]?.id,
        targetPortId: inputPorts[1]?.id,
        expectedGraphRevision: initial.graphRevision,
        expectedProjectRevision: initial.projectRevision,
      },
    });
    expect(invalid.statusCode, invalid.body).toBe(200);
    expect(invalid.json()).toMatchObject({
      compatible: false,
      allowedBindingTypes: [],
    });
    expect((await graph(app, seeded.project.id)).edges).toEqual([]);
  });

  it("uses one server preview to create one READ Binding/visual Edge and replays the same result idempotently", async () => {
    const current = fixture();
    const app = server(current);
    const seeded = await seed(app);
    const initial = await graph(app, seeded.project.id);
    const source = initial.nodes
      .find(({ type }) => type === "table")
      ?.ports.find(({ direction }) => direction === "output");
    const target = initial.nodes
      .find(({ type }) => type === "element")
      ?.ports.find(
        ({ direction, role }) => direction === "input" && role === "rows",
      );
    expect(source).toBeDefined();
    expect(target).toBeDefined();

    const previewResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${seeded.project.id}/connections/preview`,
      payload: {
        sourcePortId: source?.id,
        targetPortId: target?.id,
        expectedGraphRevision: initial.graphRevision,
        expectedProjectRevision: initial.projectRevision,
      },
    });
    expect(previewResponse.statusCode, previewResponse.body).toBe(200);
    const preview = previewResponse.json() as RelationshipConnectionPreviewDto;
    expect(preview).toMatchObject({
      compatible: true,
      allowedBindingTypes: ["READ"],
      issues: [],
    });
    expect((await graph(app, seeded.project.id)).edges).toEqual([]);

    const queryPreview = await readQueryPreview(app, seeded, preview);

    const key = `binding-${randomUUID()}`;
    const payload = {
      previewId: preview.previewId,
      bindingType: "READ",
      queryPreviewId: queryPreview.queryPreviewId,
      expectedGraphRevision: preview.graphRevision,
      expectedProjectRevision: preview.projectRevision,
      idempotencyKey: key,
    };
    const createdResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${seeded.project.id}/bindings`,
      payload,
    });
    expect(createdResponse.statusCode, createdResponse.body).toBe(201);
    const created = createdResponse.json() as RelationshipBindingMutationDto;
    expect(created.binding).toMatchObject({
      bindingType: "READ",
      source: { side: "right", direction: "output", portId: source?.id },
      target: { side: "left", direction: "input", portId: target?.id },
      status: "READY",
    });
    const after = await graph(app, seeded.project.id);
    expect(after.edges).toHaveLength(1);
    expect(after.edges[0]).toEqual(created.binding);

    const replay = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${seeded.project.id}/bindings`,
      payload,
    });
    expect(replay.statusCode, replay.body).toBe(201);
    expect(replay.json()).toEqual(created);
    expect((await graph(app, seeded.project.id)).edges).toHaveLength(1);

    const project = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${seeded.project.id}`,
    });
    expect(project.statusCode, project.body).toBe(200);
    expect(project.json()).toMatchObject({ project: { bindingCount: 1 } });
  });

  it("deletes, undoes, redoes, and restores the same stable Binding history after restart", async () => {
    const current = fixture();
    let app = server(current);
    const seeded = await seed(app);
    const initial = await graph(app, seeded.project.id);
    const source = initial.nodes
      .find(({ type }) => type === "page")
      ?.ports.find(
        ({ direction, role }) => direction === "output" && role === "contains",
      );
    const target = initial.nodes
      .find(({ type }) => type === "element")
      ?.ports.find(
        ({ direction, role }) => direction === "input" && role === "contains",
      );
    const previewResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${seeded.project.id}/connections/preview`,
      payload: {
        sourcePortId: source?.id,
        targetPortId: target?.id,
        expectedGraphRevision: initial.graphRevision,
        expectedProjectRevision: initial.projectRevision,
      },
    });
    const preview = previewResponse.json() as RelationshipConnectionPreviewDto;
    const createResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${seeded.project.id}/bindings`,
      payload: {
        previewId: preview.previewId,
        bindingType: "CONTAINS",
        expectedGraphRevision: preview.graphRevision,
        expectedProjectRevision: preview.projectRevision,
        idempotencyKey: `contains-${randomUUID()}`,
      },
    });
    expect(createResponse.statusCode, createResponse.body).toBe(201);
    const created = createResponse.json() as RelationshipBindingMutationDto;
    const deleteResponse = await app.inject({
      method: "DELETE",
      url: `/api/v1/bindings/${created.binding.id}`,
      payload: {
        expectedRevision: created.binding.revision,
        expectedGraphRevision: created.graphRevision,
        expectedProjectRevision: created.projectRevision,
        idempotencyKey: `delete-${randomUUID()}`,
      },
    });
    expect(deleteResponse.statusCode, deleteResponse.body).toBe(200);
    expect((await graph(app, seeded.project.id)).edges).toEqual([]);

    await close(app);
    app = server(current);
    const historyResponse = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${seeded.project.id}/binding-history`,
    });
    expect(historyResponse.statusCode, historyResponse.body).toBe(200);
    const history = historyResponse.json() as RelationshipHistoryDto;
    expect(history.undo).toMatchObject({
      commandType: "DELETE_BINDING",
      bindingId: created.binding.id,
    });

    const undoResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${seeded.project.id}/binding-history/undo`,
      payload: {
        expectedCommandId: history.undo?.id,
        expectedGraphRevision: history.graphRevision,
        expectedProjectRevision: history.projectRevision,
        idempotencyKey: `undo-${randomUUID()}`,
      },
    });
    expect(undoResponse.statusCode, undoResponse.body).toBe(200);
    const undo = undoResponse.json() as RelationshipHistoryMutationDto;
    expect(undo.binding.id).toBe(created.binding.id);
    expect(
      (await graph(app, seeded.project.id)).edges.map(({ id }) => id),
    ).toEqual([created.binding.id]);

    const redoHistoryResponse = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${seeded.project.id}/binding-history`,
    });
    const redoHistory = redoHistoryResponse.json() as RelationshipHistoryDto;
    const redoResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${seeded.project.id}/binding-history/redo`,
      payload: {
        expectedCommandId: redoHistory.redo?.id,
        expectedGraphRevision: redoHistory.graphRevision,
        expectedProjectRevision: redoHistory.projectRevision,
        idempotencyKey: `redo-${randomUUID()}`,
      },
    });
    expect(redoResponse.statusCode, redoResponse.body).toBe(200);
    expect((await graph(app, seeded.project.id)).edges).toEqual([]);
  });

  it("hides a Binding while its endpoint is soft-deleted, restores it, and still fails closed for an orphaned port", async () => {
    const current = fixture();
    let app = server(current);
    const seeded = await seed(app);
    const initial = await graph(app, seeded.project.id);
    const source = initial.nodes
      .find(({ type }) => type === "table")
      ?.ports.find(({ direction }) => direction === "output");
    const target = initial.nodes
      .find(({ type }) => type === "element")
      ?.ports.find(
        ({ direction, role }) => direction === "input" && role === "rows",
      );
    const previewResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${seeded.project.id}/connections/preview`,
      payload: {
        sourcePortId: source?.id,
        targetPortId: target?.id,
        expectedGraphRevision: initial.graphRevision,
        expectedProjectRevision: initial.projectRevision,
      },
    });
    const preview = previewResponse.json() as RelationshipConnectionPreviewDto;
    const queryPreview = await readQueryPreview(app, seeded, preview);
    const createResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${seeded.project.id}/bindings`,
      payload: {
        previewId: preview.previewId,
        bindingType: "READ",
        queryPreviewId: queryPreview.queryPreviewId,
        expectedGraphRevision: preview.graphRevision,
        expectedProjectRevision: preview.projectRevision,
        idempotencyKey: `soft-delete-binding-${randomUUID()}`,
      },
    });
    expect(createResponse.statusCode, createResponse.body).toBe(201);
    const created = createResponse.json() as RelationshipBindingMutationDto;

    await close(app);
    let database = new Database(current.databasePath);
    database
      .prepare("UPDATE elements SET deleted_at = ? WHERE id = ?")
      .run("2026-08-16T01:00:00.000Z", seeded.element.element.id);
    database.close();
    app = server(current);
    expect((await graph(app, seeded.project.id)).edges).toEqual([]);

    await close(app);
    database = new Database(current.databasePath);
    database
      .prepare("UPDATE elements SET deleted_at = NULL WHERE id = ?")
      .run(seeded.element.element.id);
    database.close();
    app = server(current);
    expect(
      (await graph(app, seeded.project.id)).edges.map(({ id }) => id),
    ).toEqual([created.binding.id]);

    await close(app);
    database = new Database(current.databasePath);
    database
      .prepare("UPDATE bindings SET target_port_id = ? WHERE id = ?")
      .run(`${seeded.element.element.id}:missing:input:99`, created.binding.id);
    database.close();
    expect(() => server(current)).toThrow("missing graph port");
  });

  it("remaps Binding ownership through clone and import and preserves it through trash, restart, and restore", async () => {
    const current = fixture();
    let app = server(current);
    const seeded = await seed(app);
    const initial = await graph(app, seeded.project.id);
    const source = initial.nodes
      .find(({ type }) => type === "table")
      ?.ports.find(({ direction }) => direction === "output");
    const target = initial.nodes
      .find(({ type }) => type === "element")
      ?.ports.find(
        ({ direction, role }) => direction === "input" && role === "rows",
      );
    const previewResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${seeded.project.id}/connections/preview`,
      payload: {
        sourcePortId: source?.id,
        targetPortId: target?.id,
        expectedGraphRevision: initial.graphRevision,
        expectedProjectRevision: initial.projectRevision,
      },
    });
    const preview = previewResponse.json() as RelationshipConnectionPreviewDto;
    const queryPreview = await readQueryPreview(app, seeded, preview);
    const createResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${seeded.project.id}/bindings`,
      payload: {
        previewId: preview.previewId,
        bindingType: "READ",
        queryPreviewId: queryPreview.queryPreviewId,
        expectedGraphRevision: preview.graphRevision,
        expectedProjectRevision: preview.projectRevision,
        idempotencyKey: `lifecycle-binding-${randomUUID()}`,
      },
    });
    expect(createResponse.statusCode, createResponse.body).toBe(201);
    const original = createResponse.json() as RelationshipBindingMutationDto;

    const positionedGraph = await graph(app, seeded.project.id);
    const positionedPage = positionedGraph.nodes.find(
      ({ type }) => type === "page",
    );
    const moveResponse = await app.inject({
      method: "PATCH",
      url: `/api/v1/projects/${seeded.project.id}/relationship-nodes/${encodeURIComponent(positionedPage?.id ?? "")}`,
      payload: {
        x: 176,
        y: 224,
        pinned: true,
        expectedPositionRevision: positionedPage?.positionRevision,
        expectedGraphRevision: positionedGraph.graphRevision,
        expectedProjectRevision: positionedGraph.projectRevision,
        idempotencyKey: `lifecycle-position-${randomUUID()}`,
      },
    });
    expect(moveResponse.statusCode, moveResponse.body).toBe(200);
    expect(moveResponse.json().position).toMatchObject({ x: 168, y: 216 });
    const viewportResponse = await app.inject({
      method: "PATCH",
      url: `/api/v1/projects/${seeded.project.id}/relationship-viewport`,
      payload: { x: 64, y: -48, zoom: 1.4, expectedRevision: 0 },
    });
    expect(viewportResponse.statusCode, viewportResponse.body).toBe(200);

    const cloneResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${seeded.project.id}/clone`,
      payload: {
        name: "관계 복제",
        slug: `relationship-clone-${randomUUID().slice(0, 8)}`,
      },
    });
    expect(cloneResponse.statusCode, cloneResponse.body).toBe(201);
    const clone = (
      cloneResponse.json() as {
        project: {
          id: string;
          revision: number;
          lifecycleRevision: number;
        };
      }
    ).project;
    const cloneGraph = await graph(app, clone.id);
    expect(cloneGraph.edges).toHaveLength(1);
    expect(cloneGraph.edges[0]).toMatchObject({
      projectId: clone.id,
      bindingType: "READ",
      target: { portRole: original.binding.target.portRole },
    });
    expect(cloneGraph.edges[0]?.id).not.toBe(original.binding.id);
    expect(cloneGraph.edges[0]?.source.objectId).not.toBe(
      original.binding.source.objectId,
    );
    expect(cloneGraph.edges[0]?.source.portRole).toBe(
      `field-${cloneGraph.edges[0]?.source.objectId}`,
    );
    expect(cloneGraph.edges[0]?.target.objectId).not.toBe(
      original.binding.target.objectId,
    );
    expect(cloneGraph.nodes.find(({ type }) => type === "page")).toMatchObject({
      x: 168,
      y: 216,
      pinned: true,
    });
    expect(cloneGraph.viewport).toMatchObject({ x: 64, y: -48, zoom: 1.4 });

    const exportResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${seeded.project.id}/export`,
    });
    expect(exportResponse.statusCode, exportResponse.body).toBe(200);
    const importedResponse = await app.inject({
      method: "POST",
      url: "/api/v1/projects/import",
      payload: {
        export: (exportResponse.json() as { export: unknown }).export,
        name: "관계 가져오기",
        slug: `relationship-import-${randomUUID().slice(0, 8)}`,
      },
    });
    expect(importedResponse.statusCode, importedResponse.body).toBe(201);
    const imported = (importedResponse.json() as { project: { id: string } })
      .project;
    const importedGraph = await graph(app, imported.id);
    expect(importedGraph.edges).toHaveLength(1);
    expect(importedGraph.edges[0]?.id).not.toBe(original.binding.id);
    expect(importedGraph.edges[0]?.projectId).toBe(imported.id);
    expect(
      importedGraph.nodes.find(({ type }) => type === "page"),
    ).toMatchObject({ x: 168, y: 216, pinned: true });
    expect(importedGraph.viewport).toMatchObject({
      x: 64,
      y: -48,
      zoom: 1.4,
    });

    const cloneProjectResponse = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${clone.id}`,
    });
    const cloneProject = (
      cloneProjectResponse.json() as {
        project: { revision: number; lifecycleRevision: number };
      }
    ).project;
    const trashResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${clone.id}/trash`,
      payload: {
        expectedRevision: cloneProject.revision,
        expectedLifecycleRevision: cloneProject.lifecycleRevision,
        idempotencyKey: `trash-binding-${randomUUID()}`,
        reason: "회귀",
      },
    });
    expect(trashResponse.statusCode, trashResponse.body).toBe(200);
    const trashed = (
      trashResponse.json() as {
        project: { lifecycleRevision: number };
      }
    ).project;
    await close(app);
    app = server(current);
    const restoreResponse = await app.inject({
      method: "POST",
      url: `/api/v1/recycle-bin/projects/${clone.id}/restore`,
      payload: {
        expectedLifecycleRevision: trashed.lifecycleRevision,
        idempotencyKey: `restore-binding-${randomUUID()}`,
        conflictResolution: "KEEP_ORIGINAL",
      },
    });
    expect(restoreResponse.statusCode, restoreResponse.body).toBe(200);
    const restoredGraph = await graph(app, clone.id);
    expect(restoredGraph.edges).toHaveLength(1);
    expect(restoredGraph.edges[0]?.id).toBe(cloneGraph.edges[0]?.id);
    expect(
      restoredGraph.nodes.find(({ type }) => type === "page"),
    ).toMatchObject({ x: 168, y: 216, pinned: true });
    expect(restoredGraph.viewport).toEqual(cloneGraph.viewport);
  });

  it("fails startup when persisted Node position ownership is tampered", async () => {
    const current = fixture();
    const app = server(current);
    const seeded = await seed(app);
    const state = await graph(app, seeded.project.id);
    const pageNode = state.nodes.find(({ type }) => type === "page");
    const moveResponse = await app.inject({
      method: "PATCH",
      url: `/api/v1/projects/${seeded.project.id}/relationship-nodes/${encodeURIComponent(pageNode?.id ?? "")}`,
      payload: {
        x: 120,
        y: 160,
        pinned: false,
        expectedPositionRevision: pageNode?.positionRevision,
        expectedGraphRevision: state.graphRevision,
        expectedProjectRevision: state.projectRevision,
        idempotencyKey: `tamper-position-${randomUUID()}`,
      },
    });
    expect(moveResponse.statusCode, moveResponse.body).toBe(200);
    await close(app);
    const database = new Database(current.databasePath);
    database
      .prepare(
        "UPDATE relationship_node_positions SET object_id = ? WHERE project_id = ? AND node_id = ?",
      )
      .run(randomUUID(), seeded.project.id, pageNode?.id);
    database.close();
    expect(() => server(current)).toThrow("invalid graph ownership");
  });

  it("persists free Node movement and viewport, previews orthogonal routes, and applies one undoable ELK layout", async () => {
    const current = fixture();
    let app = server(current);
    const seeded = await seed(app);
    let state = await graph(app, seeded.project.id);
    const source = state.nodes
      .find(({ type }) => type === "page")
      ?.ports.find(
        ({ direction, role }) => direction === "output" && role === "contains",
      );
    const target = state.nodes
      .find(({ type }) => type === "element")
      ?.ports.find(
        ({ direction, role }) => direction === "input" && role === "contains",
      );
    const previewResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${seeded.project.id}/connections/preview`,
      payload: {
        sourcePortId: source?.id,
        targetPortId: target?.id,
        expectedGraphRevision: state.graphRevision,
        expectedProjectRevision: state.projectRevision,
      },
    });
    const connection =
      previewResponse.json() as RelationshipConnectionPreviewDto;
    const createResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${seeded.project.id}/bindings`,
      payload: {
        previewId: connection.previewId,
        bindingType: "CONTAINS",
        expectedGraphRevision: connection.graphRevision,
        expectedProjectRevision: connection.projectRevision,
        idempotencyKey: `layout-binding-${randomUUID()}`,
      },
    });
    expect(createResponse.statusCode, createResponse.body).toBe(201);
    state = await graph(app, seeded.project.id);
    expect(state.routes).toHaveLength(1);
    expect(state.routes[0]).toMatchObject({
      bindingId: state.edges[0]?.id,
      crossesNode: false,
    });
    for (
      let index = 1;
      index < (state.routes[0]?.points.length ?? 0);
      index += 1
    ) {
      const before = state.routes[0]?.points[index - 1];
      const after = state.routes[0]?.points[index];
      expect(before?.x === after?.x || before?.y === after?.y).toBe(true);
    }

    const pageNode = state.nodes.find(({ type }) => type === "page");
    expect(pageNode).toBeDefined();
    const moveKey = `move-node-${randomUUID()}`;
    const movePayload = {
      x: 144,
      y: 264,
      pinned: true,
      expectedPositionRevision: pageNode?.positionRevision,
      expectedGraphRevision: state.graphRevision,
      expectedProjectRevision: state.projectRevision,
      idempotencyKey: moveKey,
    };
    const movedResponse = await app.inject({
      method: "PATCH",
      url: `/api/v1/projects/${seeded.project.id}/relationship-nodes/${encodeURIComponent(pageNode?.id ?? "")}`,
      payload: movePayload,
    });
    expect(movedResponse.statusCode, movedResponse.body).toBe(200);
    const moved = movedResponse.json() as RelationshipNodePositionMutationDto;
    expect(moved.position).toMatchObject({ x: 144, y: 264, pinned: true });
    const moveReplay = await app.inject({
      method: "PATCH",
      url: `/api/v1/projects/${seeded.project.id}/relationship-nodes/${encodeURIComponent(pageNode?.id ?? "")}`,
      payload: movePayload,
    });
    expect(moveReplay.statusCode, moveReplay.body).toBe(200);
    expect(moveReplay.json()).toEqual(moved);
    const moveConflict = await app.inject({
      method: "PATCH",
      url: `/api/v1/projects/${seeded.project.id}/relationship-nodes/${encodeURIComponent(pageNode?.id ?? "")}`,
      payload: { ...movePayload, x: 145 },
    });
    expect(moveConflict.statusCode, moveConflict.body).toBe(409);
    expect(moveConflict.json()).toMatchObject({
      error: { code: "IDEMPOTENCY_PAYLOAD_CONFLICT" },
    });
    state = await graph(app, seeded.project.id);
    expect(moved.routes).toEqual(state.routes);

    const routePositions = state.nodes.map((node) => ({
      nodeId: node.id,
      nodeType: node.type,
      objectId: node.objectId,
      x: node.type === "element" ? node.x + 96 : node.x,
      y: node.y,
      pinned: node.pinned,
      revision: node.positionRevision,
    }));
    const routePreviewResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${seeded.project.id}/edges/route-preview`,
      payload: {
        positions: routePositions,
        expectedGraphRevision: state.graphRevision,
        expectedProjectRevision: state.projectRevision,
      },
    });
    expect(routePreviewResponse.statusCode, routePreviewResponse.body).toBe(
      200,
    );
    const routePreview =
      routePreviewResponse.json() as RelationshipRoutePreviewDto;
    expect(routePreview.routes).toHaveLength(1);
    expect(
      (await graph(app, seeded.project.id)).nodes.find(
        ({ type }) => type === "element",
      )?.x,
    ).not.toBe(
      routePositions.find(({ nodeType }) => nodeType === "element")?.x,
    );

    const viewportResponse = await app.inject({
      method: "PATCH",
      url: `/api/v1/projects/${seeded.project.id}/relationship-viewport`,
      payload: { x: 80, y: -32, zoom: 1.25, expectedRevision: 0 },
    });
    expect(viewportResponse.statusCode, viewportResponse.body).toBe(200);
    expect(viewportResponse.json() as RelationshipViewportDto).toMatchObject({
      x: 80,
      y: -32,
      zoom: 1.25,
      revision: 1,
    });

    await close(app);
    app = server(current);
    state = await graph(app, seeded.project.id);
    expect(state.nodes.find(({ type }) => type === "page")).toMatchObject({
      x: 144,
      y: 264,
      pinned: true,
      positionRevision: 1,
    });
    expect(state.viewport).toMatchObject({ x: 80, y: -32, zoom: 1.25 });
    const beforeAuto = state.nodes.map(({ id, x, y }) => ({ id, x, y }));

    const autoPreviewResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${seeded.project.id}/auto-layout`,
      payload: {
        action: "PREVIEW",
        expectedGraphRevision: state.graphRevision,
        expectedProjectRevision: state.projectRevision,
      },
    });
    expect(autoPreviewResponse.statusCode, autoPreviewResponse.body).toBe(200);
    const autoPreview =
      autoPreviewResponse.json() as RelationshipAutoLayoutPreviewDto;
    expect(autoPreview.positions).toHaveLength(state.nodes.length);
    expect(autoPreview.crossingCountAfter).toBeLessThanOrEqual(
      autoPreview.crossingCountBefore,
    );
    expect(
      autoPreview.positions.find(({ nodeType }) => nodeType === "page"),
    ).toMatchObject({ x: 144, y: 264, pinned: true });

    const autoLayoutKey = `auto-layout-${randomUUID()}`;
    const autoLayoutPayload = {
      action: "APPLY",
      previewId: autoPreview.previewId,
      expectedGraphRevision: autoPreview.graphRevision,
      expectedProjectRevision: autoPreview.projectRevision,
      idempotencyKey: autoLayoutKey,
    } as const;
    const applyResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${seeded.project.id}/auto-layout`,
      payload: autoLayoutPayload,
    });
    expect(applyResponse.statusCode, applyResponse.body).toBe(200);
    const applied = applyResponse.json() as RelationshipAutoLayoutApplyDto;
    expect(applied.positions).toHaveLength(state.nodes.length);
    const applyReplay = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${seeded.project.id}/auto-layout`,
      payload: autoLayoutPayload,
    });
    expect(applyReplay.statusCode, applyReplay.body).toBe(200);
    expect(applyReplay.json()).toEqual(applied);
    state = await graph(app, seeded.project.id);
    for (let left = 0; left < state.nodes.length; left += 1) {
      for (let right = left + 1; right < state.nodes.length; right += 1) {
        const a = state.nodes[left];
        const b = state.nodes[right];
        expect(
          (a?.x ?? 0) + (a?.width ?? 0) <= (b?.x ?? 0) ||
            (b?.x ?? 0) + (b?.width ?? 0) <= (a?.x ?? 0) ||
            (a?.y ?? 0) + (a?.height ?? 0) <= (b?.y ?? 0) ||
            (b?.y ?? 0) + (b?.height ?? 0) <= (a?.y ?? 0),
        ).toBe(true);
      }
    }

    const historyResponse = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${seeded.project.id}/relationship-layout-history`,
    });
    const layoutHistory =
      historyResponse.json() as RelationshipLayoutHistoryDto;
    expect(layoutHistory.undo).toMatchObject({ commandType: "AUTO_LAYOUT" });
    const undoPayload = {
      expectedCommandId: layoutHistory.undo?.id,
      expectedGraphRevision: layoutHistory.graphRevision,
      expectedProjectRevision: layoutHistory.projectRevision,
      idempotencyKey: `layout-undo-${randomUUID()}`,
    };
    const undoResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${seeded.project.id}/relationship-layout-history/undo`,
      payload: undoPayload,
    });
    expect(undoResponse.statusCode, undoResponse.body).toBe(200);
    const undone = undoResponse.json() as RelationshipLayoutHistoryMutationDto;
    expect(undone.operation).toBe("UNDO");
    const undoReplay = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${seeded.project.id}/relationship-layout-history/undo`,
      payload: undoPayload,
    });
    expect(undoReplay.statusCode, undoReplay.body).toBe(200);
    expect(undoReplay.json()).toEqual(undone);
    expect(
      (await graph(app, seeded.project.id)).nodes.map(({ id, x, y }) => ({
        id,
        x,
        y,
      })),
    ).toEqual(beforeAuto);
  });

  it("applies a compact Page scope without writing positions outside that Page", async () => {
    const current = fixture();
    const app = server(current);
    const seeded = await seed(app);
    const initial = await graph(app, seeded.project.id);
    const page = initial.nodes.find(({ type }) => type === "page");
    const element = initial.nodes.find(({ type }) => type === "element");
    const table = initial.nodes.find(({ type }) => type === "table");
    expect(page).toBeDefined();
    expect(element).toBeDefined();
    expect(table).toBeDefined();
    const scopeNodeIds = [page?.id, element?.id] as string[];

    const invalidScope = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${seeded.project.id}/auto-layout`,
      payload: {
        action: "PREVIEW",
        scopeNodeIds: [page?.id, page?.id],
        expectedGraphRevision: initial.graphRevision,
        expectedProjectRevision: initial.projectRevision,
      },
    });
    expect(invalidScope.statusCode, invalidScope.body).toBe(400);
    expect((await graph(app, seeded.project.id)).projectRevision).toBe(
      initial.projectRevision,
    );

    const previewResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${seeded.project.id}/auto-layout`,
      payload: {
        action: "PREVIEW",
        scopeNodeIds,
        expectedGraphRevision: initial.graphRevision,
        expectedProjectRevision: initial.projectRevision,
      },
    });
    expect(previewResponse.statusCode, previewResponse.body).toBe(200);
    const preview = previewResponse.json() as RelationshipAutoLayoutPreviewDto;
    expect(preview.scopeNodeIds).toEqual([...scopeNodeIds].sort());
    expect(preview.positions).toHaveLength(initial.nodes.length);
    expect(
      preview.positions.find(({ nodeId }) => nodeId === table?.id),
    ).toMatchObject({
      x: table?.x,
      y: table?.y,
      revision: table?.positionRevision,
    });

    const applyResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${seeded.project.id}/auto-layout`,
      payload: {
        action: "APPLY",
        previewId: preview.previewId,
        expectedGraphRevision: preview.graphRevision,
        expectedProjectRevision: preview.projectRevision,
        idempotencyKey: `page-layout-${randomUUID()}`,
      },
    });
    expect(applyResponse.statusCode, applyResponse.body).toBe(200);
    const applied = applyResponse.json() as RelationshipAutoLayoutApplyDto;
    expect(applied.positions.map(({ nodeId }) => nodeId).sort()).toEqual(
      [...scopeNodeIds].sort(),
    );
    const after = await graph(app, seeded.project.id);
    expect(after.nodes.find(({ id }) => id === table?.id)).toMatchObject({
      x: table?.x,
      y: table?.y,
      positionRevision: table?.positionRevision,
    });
    expect(
      after.nodes
        .filter(({ id }) => scopeNodeIds.includes(id))
        .every(
          ({ x, y, positionRevision }) =>
            x % 24 === 0 && y % 24 === 0 && positionRevision > 0,
        ),
    ).toBe(true);

    const historyResponse = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${seeded.project.id}/relationship-layout-history`,
    });
    const layoutHistory =
      historyResponse.json() as RelationshipLayoutHistoryDto;
    expect(layoutHistory.undo).toMatchObject({ commandType: "AUTO_LAYOUT" });
    const undoResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${seeded.project.id}/relationship-layout-history/undo`,
      payload: {
        expectedCommandId: layoutHistory.undo?.id,
        expectedGraphRevision: layoutHistory.graphRevision,
        expectedProjectRevision: layoutHistory.projectRevision,
        idempotencyKey: `page-layout-undo-${randomUUID()}`,
      },
    });
    expect(undoResponse.statusCode, undoResponse.body).toBe(200);
    const restored = await graph(app, seeded.project.id);
    expect(restored.nodes.map(({ id, x, y }) => ({ id, x, y }))).toEqual(
      initial.nodes.map(({ id, x, y }) => ({ id, x, y })),
    );
    expect(restored.nodes.find(({ id }) => id === table?.id)).toMatchObject({
      positionRevision: table?.positionRevision,
    });
  });
});
