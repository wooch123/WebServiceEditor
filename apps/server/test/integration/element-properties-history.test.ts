import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  ElementEntryDto,
  ElementHistoryDto,
  ElementHistoryMutationDto,
  ElementInspectorDto,
  ElementRegistryDto,
  ElementType,
  PageDto,
  ProjectDto,
  PublishedRuntimePageDto,
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

const fixtures: Fixture[] = [];
const apps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
  for (const fixture of fixtures.splice(0)) {
    rmSync(fixture.directory, { force: true, recursive: true });
  }
});

function createFixture(): Fixture {
  const directory = mkdtempSync(join(tmpdir(), "webeditor-phase6-"));
  const fixture = {
    directory,
    databasePath: join(directory, "metadata", "webeditor.sqlite"),
    storageRoot: join(directory, "projects"),
  };
  fixtures.push(fixture);
  return fixture;
}

function createServer(
  fixture: Fixture,
  failureInjector?: (point: string) => void,
): FastifyInstance {
  const app = buildServer({
    metadataDatabasePath: fixture.databasePath,
    storageRoot: fixture.storageRoot,
    ...(failureInjector === undefined
      ? {}
      : { elementFailureInjector: failureInjector }),
  });
  apps.push(app);
  return app;
}

async function closeServer(app: FastifyInstance): Promise<void> {
  const index = apps.indexOf(app);
  if (index >= 0) apps.splice(index, 1);
  await app.close();
}

async function createProject(app: FastifyInstance, slug: string) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/projects",
    payload: { name: slug, slug },
  });
  expect(response.statusCode, response.body).toBe(201);
  return (response.json() as { project: ProjectDto }).project;
}

async function createPage(
  app: FastifyInstance,
  project: Pick<ProjectDto, "id" | "revision">,
) {
  const response = await app.inject({
    method: "POST",
    url: `/api/v1/projects/${project.id}/pages`,
    payload: {
      name: "Canvas",
      pageType: "blank",
      expectedProjectRevision: project.revision,
      idempotencyKey: `page-${randomUUID()}`,
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json() as {
    readonly page: PageDto;
    readonly projectRevision: number;
  };
}

async function addElement(
  app: FastifyInstance,
  pageId: string,
  type: ElementType,
  layoutRevision: number,
  projectRevision: number,
) {
  const response = await app.inject({
    method: "POST",
    url: `/api/v1/pages/${pageId}/elements`,
    payload: {
      elementType: type,
      expectedLayoutRevision: layoutRevision,
      expectedProjectRevision: projectRevision,
      idempotencyKey: `add-${type}-${randomUUID()}`,
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json() as {
    readonly entry: ElementEntryDto;
    readonly layoutRevision: number;
    readonly projectRevision: number;
    readonly commandId: string;
  };
}

async function history(app: FastifyInstance, projectId: string) {
  const response = await app.inject({
    method: "GET",
    url: `/api/v1/projects/${projectId}/element-history`,
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json() as ElementHistoryDto;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

describe("Phase 6 Element Registry, properties, history, and Runtime", () => {
  it("serves a deterministic Registry and persists every Number Input property through restart", async () => {
    const fixture = createFixture();
    let app = createServer(fixture);
    const registryResponse = await app.inject({
      method: "GET",
      url: "/api/v1/elements/registry",
    });
    expect(registryResponse.statusCode, registryResponse.body).toBe(200);
    const registry = registryResponse.json() as ElementRegistryDto;
    expect(registry.definitions.map(({ type }) => type)).toEqual([
      "text",
      "button",
      "container",
      "kpi-card",
      "number-input",
      "data-table",
      "line-chart",
      "bar-chart",
      "histogram",
      "scatter-plot",
      "box-plot",
      "summary-statistics",
    ]);
    expect(registry.tabs.map(({ id }) => id)).toEqual([
      "general",
      "style",
      "data",
      "interaction",
      "validation",
      "advanced",
    ]);
    expect(registry.checksum).toBe(
      createHash("sha256")
        .update(
          stableJson({
            schemaVersion: registry.schemaVersion,
            tabs: registry.tabs,
            definitions: registry.definitions,
          }),
        )
        .digest("hex"),
    );
    const detail = await app.inject({
      method: "GET",
      url: "/api/v1/elements/registry/data-table",
    });
    expect(detail.statusCode).toBe(200);
    const missingDetail = await app.inject({
      method: "GET",
      url: "/api/v1/elements/registry/not-registered",
    });
    expect(missingDetail.statusCode).toBe(404);
    expect(missingDetail.json()).toMatchObject({
      error: { code: "ELEMENT_DEFINITION_NOT_FOUND" },
    });

    const project = await createProject(app, "registry-properties");
    const page = await createPage(app, project);
    const added = await addElement(
      app,
      page.page.id,
      "number-input",
      0,
      page.projectRevision,
    );
    const values = {
      "general.displayName": "Population",
      "general.internalName": "populationInput",
      "general.visible": false,
      "general.disabled": true,
      "general.locked": true,
      "general.tooltip": "Population size",
      "general.accessibilityLabel": "Population",
      "general.label": "Population",
      "general.placeholder": "100",
      "style.padding": 12,
      "style.margin": 4,
      "style.backgroundToken": "secondary",
      "style.backgroundCustom": "#112233",
      "style.borderToken": "border",
      "style.borderWidth": 2,
      "style.borderStyle": "dashed",
      "style.radius": 10,
      "style.shadow": "md",
      "style.textColorToken": "foreground",
      "style.fontSize": 18,
      "style.fontWeight": "600",
      "style.textAlign": "right",
      "style.contentAlign": "center",
      "data.defaultValue": 100,
      "validation.required": true,
      "validation.minimum": 1,
      "validation.maximum": 1_000,
      "validation.step": 1,
    } as const;
    const propertyPayload = {
      expectedRevision: added.entry.element.revision,
      expectedLayoutRevision: added.layoutRevision,
      expectedProjectRevision: added.projectRevision,
      idempotencyKey: `properties-${randomUUID()}`,
      change: { kind: "PROPERTIES", values },
    } as const;
    const patchedResponse = await app.inject({
      method: "PATCH",
      url: `/api/v1/elements/${added.entry.element.id}`,
      payload: propertyPayload,
    });
    expect(patchedResponse.statusCode, patchedResponse.body).toBe(200);
    const patched = patchedResponse.json() as {
      readonly entry: ElementEntryDto;
      readonly layoutRevision: number;
      readonly projectRevision: number;
    };
    expect(patched.layoutRevision).toBe(added.layoutRevision);
    expect(patched.entry.element.name).toBe("Population");
    expect(patched.entry.element.props).toMatchObject({
      internalName: "populationInput",
      disabled: true,
      defaultValue: 100,
    });
    expect(patched.entry.element.hidden).toBe(true);
    expect(patched.entry.element.locked).toBe(true);

    const inspectorResponse = await app.inject({
      method: "GET",
      url: `/api/v1/elements/${added.entry.element.id}`,
    });
    expect(inspectorResponse.statusCode, inspectorResponse.body).toBe(200);
    const inspector = inspectorResponse.json() as ElementInspectorDto;
    expect(inspector.propertyValues).toMatchObject(values);
    expect(inspector.bindingStatus.status).toBe("UNCONNECTED");
    expect(inspector.propertyValues["validation.status"]).toBe("PASS");

    const historyBeforeInvalid = await history(app, project.id);
    const invalidBounds = await app.inject({
      method: "PATCH",
      url: `/api/v1/elements/${added.entry.element.id}`,
      payload: {
        expectedRevision: patched.entry.element.revision,
        expectedLayoutRevision: patched.layoutRevision,
        expectedProjectRevision: patched.projectRevision,
        idempotencyKey: `invalid-default-bounds-${randomUUID()}`,
        change: {
          kind: "PROPERTIES",
          values: { "validation.minimum": 101 },
        },
      },
    });
    expect(invalidBounds.statusCode).toBe(400);
    expect(invalidBounds.json()).toMatchObject({
      error: { code: "INVALID_ELEMENT_PROPERTY_VALUE" },
    });
    const unchanged = await app.inject({
      method: "GET",
      url: `/api/v1/elements/${added.entry.element.id}`,
    });
    expect(unchanged.statusCode, unchanged.body).toBe(200);
    expect((unchanged.json() as ElementInspectorDto).entry).toEqual(
      inspector.entry,
    );
    expect(await history(app, project.id)).toEqual(historyBeforeInvalid);

    const staleRevision = await app.inject({
      method: "PATCH",
      url: `/api/v1/elements/${added.entry.element.id}`,
      payload: {
        expectedRevision: added.entry.element.revision,
        expectedLayoutRevision: patched.layoutRevision,
        expectedProjectRevision: patched.projectRevision,
        idempotencyKey: `stale-properties-${randomUUID()}`,
        change: {
          kind: "PROPERTIES",
          values: { "general.displayName": "Must not persist" },
        },
      },
    });
    expect(staleRevision.statusCode).toBe(409);
    expect(staleRevision.json()).toMatchObject({
      error: { code: "ELEMENT_REVISION_CONFLICT" },
    });
    const unchangedAfterConflict = await app.inject({
      method: "GET",
      url: `/api/v1/elements/${added.entry.element.id}`,
    });
    expect(
      (unchangedAfterConflict.json() as ElementInspectorDto).entry,
    ).toEqual(inspector.entry);
    expect(await history(app, project.id)).toEqual(historyBeforeInvalid);

    await closeServer(app);
    app = createServer(fixture);
    const restarted = await app.inject({
      method: "GET",
      url: `/api/v1/elements/${added.entry.element.id}`,
    });
    expect(restarted.statusCode, restarted.body).toBe(200);
    expect(
      (restarted.json() as ElementInspectorDto).propertyValues,
    ).toMatchObject(values);
    const replayedAfterRestart = await app.inject({
      method: "PATCH",
      url: `/api/v1/elements/${added.entry.element.id}`,
      payload: propertyPayload,
    });
    expect(replayedAfterRestart.statusCode).toBe(200);
    expect(replayedAfterRestart.body).toBe(patchedResponse.body);
  });

  it("rejects unknown, read-only, polluted, non-finite, oversized, and invalid semantic values without mutation", async () => {
    const fixture = createFixture();
    const app = createServer(fixture);
    const project = await createProject(app, "property-security");
    const page = await createPage(app, project);
    const added = await addElement(
      app,
      page.page.id,
      "text",
      0,
      page.projectRevision,
    );
    const base = {
      expectedRevision: added.entry.element.revision,
      expectedLayoutRevision: added.layoutRevision,
      expectedProjectRevision: added.projectRevision,
    };
    const cases: readonly [string, string][] = [
      ["unknown", '{"unknown.path":"x"}'],
      ["readonly", '{"general.elementId":"x"}'],
      ["polluted", '{"__proto__":"x"}'],
      ["nonfinite", '{"style.padding":1e999}'],
      ["bad-token", '{"style.backgroundToken":"does-not-exist"}'],
      ["bad-color", '{"style.backgroundCustom":"red"}'],
      ["oversized", JSON.stringify({ "general.tooltip": "x".repeat(501) })],
    ];
    for (const [name, valuesJson] of cases) {
      const response = await app.inject({
        method: "PATCH",
        url: `/api/v1/elements/${added.entry.element.id}`,
        headers: { "content-type": "application/json" },
        payload: `{"expectedRevision":${base.expectedRevision},"expectedLayoutRevision":${base.expectedLayoutRevision},"expectedProjectRevision":${base.expectedProjectRevision},"idempotencyKey":"security-${name}-${randomUUID()}","change":{"kind":"PROPERTIES","values":${valuesJson}}}`,
      });
      expect(response.statusCode, `${name}: ${response.body}`).toBe(400);
    }
    const inspector = await app.inject({
      method: "GET",
      url: `/api/v1/elements/${added.entry.element.id}`,
    });
    expect((inspector.json() as ElementInspectorDto).entry).toEqual(
      added.entry,
    );
    expect((await history(app, project.id)).commands).toHaveLength(1);
  });

  it("rolls back an injected Property failure without poisoning its retry key", async () => {
    const fixture = createFixture();
    let failPatch = true;
    const app = createServer(fixture, (point) => {
      if (point === "element:patch-before-command" && failPatch) {
        failPatch = false;
        throw new Error("injected Property transaction failure");
      }
    });
    const project = await createProject(app, "property-rollback");
    const page = await createPage(app, project);
    const added = await addElement(
      app,
      page.page.id,
      "text",
      0,
      page.projectRevision,
    );
    const payload = {
      expectedRevision: added.entry.element.revision,
      expectedLayoutRevision: added.layoutRevision,
      expectedProjectRevision: added.projectRevision,
      idempotencyKey: `property-retry-${randomUUID()}`,
      change: {
        kind: "PROPERTIES",
        values: {
          "general.displayName": "Recovered",
          "general.internalName": "recoveredText",
        },
      },
    } as const;
    const failed = await app.inject({
      method: "PATCH",
      url: `/api/v1/elements/${added.entry.element.id}`,
      payload,
    });
    expect(failed.statusCode).toBe(500);
    const afterFailure = await app.inject({
      method: "GET",
      url: `/api/v1/elements/${added.entry.element.id}`,
    });
    expect(afterFailure.statusCode, afterFailure.body).toBe(200);
    expect((afterFailure.json() as ElementInspectorDto).entry).toEqual(
      added.entry,
    );
    expect(
      (await history(app, project.id)).commands.map(({ type }) => type),
    ).toEqual(["ADD"]);
    const currentProject = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${project.id}`,
    });
    expect(
      (currentProject.json() as { project: ProjectDto }).project.revision,
    ).toBe(added.projectRevision);

    const retried = await app.inject({
      method: "PATCH",
      url: `/api/v1/elements/${added.entry.element.id}`,
      payload,
    });
    expect(retried.statusCode, retried.body).toBe(200);
    expect(
      (retried.json() as { entry: ElementEntryDto }).entry.element,
    ).toMatchObject({
      name: "Recovered",
      props: { internalName: "recoveredText" },
    });
    expect(
      (await history(app, project.id)).commands.map(({ type }) => type),
    ).toEqual(["ADD", "PROPERTIES"]);
  });

  it("undoes and redoes every successful Element command type with monotonic revisions across restart", async () => {
    const fixture = createFixture();
    let app = createServer(fixture);
    const project = await createProject(app, "complete-history");
    const page = await createPage(app, project);
    let layoutRevision = 0;
    let projectRevision = page.projectRevision;

    const first = await addElement(
      app,
      page.page.id,
      "text",
      layoutRevision,
      projectRevision,
    );
    let firstEntry = first.entry;
    layoutRevision = first.layoutRevision;
    projectRevision = first.projectRevision;

    const patch = async (change: Record<string, unknown>) => {
      const response = await app.inject({
        method: "PATCH",
        url: `/api/v1/elements/${firstEntry.element.id}`,
        payload: {
          expectedRevision: firstEntry.element.revision,
          expectedLayoutRevision: layoutRevision,
          expectedProjectRevision: projectRevision,
          idempotencyKey: `change-${randomUUID()}`,
          change,
        },
      });
      expect(response.statusCode, response.body).toBe(200);
      const result = response.json() as {
        entry: ElementEntryDto;
        layoutRevision: number;
        projectRevision: number;
      };
      firstEntry = result.entry;
      layoutRevision = result.layoutRevision;
      projectRevision = result.projectRevision;
    };
    await patch({ kind: "MOVE", x: 8, y: 0 });
    await patch({
      kind: "RESIZE",
      handle: "e",
      x: 8,
      y: 0,
      w: 8,
      h: firstEntry.layout.h,
    });
    await patch({
      kind: "PROPERTIES",
      values: {
        "general.displayName": "History Text",
        "general.internalName": "historyText",
      },
    });
    await patch({ kind: "LOCK", locked: true });
    await patch({ kind: "LOCK", locked: false });

    const second = await addElement(
      app,
      page.page.id,
      "button",
      layoutRevision,
      projectRevision,
    );
    layoutRevision = second.layoutRevision;
    projectRevision = second.projectRevision;
    const batchResponse = await app.inject({
      method: "POST",
      url: "/api/v1/elements/batch-layout",
      payload: {
        pageId: page.page.id,
        expectedLayoutRevision: layoutRevision,
        expectedProjectRevision: projectRevision,
        idempotencyKey: `batch-${randomUUID()}`,
        mode: "COMPLETE",
        items: [
          {
            elementId: firstEntry.element.id,
            expectedRevision: firstEntry.element.revision,
            x: 8,
            y: 10,
            w: firstEntry.layout.w,
            h: firstEntry.layout.h,
          },
          {
            elementId: second.entry.element.id,
            expectedRevision: second.entry.element.revision,
            x: 0,
            y: 0,
            w: second.entry.layout.w,
            h: second.entry.layout.h,
          },
        ],
      },
    });
    expect(batchResponse.statusCode, batchResponse.body).toBe(200);
    const batch = batchResponse.json() as {
      entries: readonly ElementEntryDto[];
      layoutRevision: number;
      projectRevision: number;
    };
    firstEntry = batch.entries.find(
      ({ element }) => element.id === firstEntry.element.id,
    ) as ElementEntryDto;
    const secondEntry = batch.entries.find(
      ({ element }) => element.id === second.entry.element.id,
    ) as ElementEntryDto;
    layoutRevision = batch.layoutRevision;
    projectRevision = batch.projectRevision;
    const deletedResponse = await app.inject({
      method: "DELETE",
      url: `/api/v1/elements/${secondEntry.element.id}`,
      payload: {
        expectedRevision: secondEntry.element.revision,
        expectedLayoutRevision: layoutRevision,
        expectedProjectRevision: projectRevision,
        idempotencyKey: `delete-${randomUUID()}`,
      },
    });
    expect(deletedResponse.statusCode, deletedResponse.body).toBe(200);
    const deleted = deletedResponse.json() as {
      layoutRevision: number;
      projectRevision: number;
    };
    layoutRevision = deleted.layoutRevision;
    projectRevision = deleted.projectRevision;

    const initialHistory = await history(app, project.id);
    expect(new Set(initialHistory.commands.map(({ type }) => type))).toEqual(
      new Set([
        "ADD",
        "MOVE",
        "RESIZE",
        "PROPERTIES",
        "LOCK",
        "BATCH_LAYOUT",
        "DELETE",
      ]),
    );
    const commandCount = initialHistory.commands.length;
    let previousProjectRevision = projectRevision;
    for (let index = 0; index < commandCount; index += 1) {
      const currentHistory = await history(app, project.id);
      expect(currentHistory.undoCommand).not.toBeNull();
      const response = await app.inject({
        method: "POST",
        url: `/api/v1/projects/${project.id}/element-history/undo`,
        payload: {
          expectedProjectRevision: previousProjectRevision,
          expectedCommandId: currentHistory.undoCommand?.id,
          idempotencyKey: `undo-${randomUUID()}`,
        },
      });
      expect(response.statusCode, response.body).toBe(200);
      const result = response.json() as ElementHistoryMutationDto;
      expect(result.projectRevision).toBeGreaterThan(previousProjectRevision);
      previousProjectRevision = result.projectRevision;
      layoutRevision = result.layoutRevision;
      if (index === 2) {
        await closeServer(app);
        app = createServer(fixture);
      }
    }
    expect((await history(app, project.id)).canUndo).toBe(false);
    const emptyList = await app.inject({
      method: "GET",
      url: `/api/v1/pages/${page.page.id}/elements`,
    });
    expect(
      (emptyList.json() as { elements: readonly unknown[] }).elements,
    ).toHaveLength(0);

    for (let index = 0; index < commandCount; index += 1) {
      const currentHistory = await history(app, project.id);
      expect(currentHistory.redoCommand).not.toBeNull();
      const response = await app.inject({
        method: "POST",
        url: `/api/v1/projects/${project.id}/element-history/redo`,
        payload: {
          expectedProjectRevision: previousProjectRevision,
          expectedCommandId: currentHistory.redoCommand?.id,
          idempotencyKey: `redo-${randomUUID()}`,
        },
      });
      expect(response.statusCode, response.body).toBe(200);
      const result = response.json() as ElementHistoryMutationDto;
      expect(result.projectRevision).toBeGreaterThan(previousProjectRevision);
      previousProjectRevision = result.projectRevision;
    }
    const finalHistory = await history(app, project.id);
    expect(finalHistory.canRedo).toBe(false);
    expect(
      finalHistory.commands.every(({ state }) => state === "APPLIED"),
    ).toBe(true);
    const finalList = await app.inject({
      method: "GET",
      url: `/api/v1/pages/${page.page.id}/elements`,
    });
    const finalEntries = (
      finalList.json() as { elements: readonly ElementEntryDto[] }
    ).elements;
    expect(finalEntries).toHaveLength(1);
    expect(finalEntries[0]?.element).toMatchObject({
      id: firstEntry.element.id,
      name: firstEntry.element.name,
      props: firstEntry.element.props,
      style: firstEntry.element.style,
      locked: firstEntry.element.locked,
      hidden: firstEntry.element.hidden,
    });
    expect(finalEntries[0]?.element.revision).toBeGreaterThan(
      firstEntry.element.revision,
    );
    expect(finalEntries[0]?.layout).toEqual(firstEntry.layout);
  });

  it("replays 2xx and deterministic 4xx history operations, discards redo branches, and rolls back retryable 5xx", async () => {
    const fixture = createFixture();
    let failHistory = false;
    let app = createServer(fixture, (point) => {
      if (point === "element:history-before-operation" && failHistory) {
        failHistory = false;
        throw new Error("injected history failure");
      }
    });
    const project = await createProject(app, "history-replay");
    const page = await createPage(app, project);
    const added = await addElement(
      app,
      page.page.id,
      "text",
      0,
      page.projectRevision,
    );
    const currentHistory = await history(app, project.id);
    const wrongCommandId = randomUUID();
    const conflictKey = `history-conflict-${randomUUID()}`;
    const conflictPayload = {
      expectedProjectRevision: added.projectRevision,
      expectedCommandId: wrongCommandId,
      idempotencyKey: conflictKey,
    };
    const conflict = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/element-history/undo`,
      payload: conflictPayload,
    });
    const conflictReplay = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/element-history/undo`,
      payload: conflictPayload,
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflictReplay.statusCode).toBe(409);
    expect(conflictReplay.body).toBe(conflict.body);

    const retryKey = `history-retry-${randomUUID()}`;
    const undoPayload = {
      expectedProjectRevision: added.projectRevision,
      expectedCommandId: currentHistory.undoCommand?.id,
      idempotencyKey: retryKey,
    };
    failHistory = true;
    const failed = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/element-history/undo`,
      payload: undoPayload,
    });
    expect(failed.statusCode).toBe(500);
    expect((await history(app, project.id)).undoCommand?.id).toBe(
      currentHistory.undoCommand?.id,
    );
    const retried = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/element-history/undo`,
      payload: undoPayload,
    });
    expect(retried.statusCode, retried.body).toBe(200);
    const replayed = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/element-history/undo`,
      payload: undoPayload,
    });
    expect(replayed.statusCode).toBe(200);
    expect(replayed.body).toBe(retried.body);
    const undone = retried.json() as ElementHistoryMutationDto;

    const redo = (await history(app, project.id)).redoCommand;
    expect(redo).not.toBeNull();
    const replacement = await addElement(
      app,
      page.page.id,
      "button",
      undone.layoutRevision,
      undone.projectRevision,
    );
    const branched = await history(app, project.id);
    expect(branched.canRedo).toBe(false);
    expect(branched.commands.find(({ id }) => id === redo?.id)?.state).toBe(
      "DISCARDED",
    );
    expect(replacement.projectRevision).toBeGreaterThan(undone.projectRevision);

    await closeServer(app);
    app = createServer(fixture);
    expect((await history(app, project.id)).canRedo).toBe(false);
    const conflictAfterRestart = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/element-history/undo`,
      payload: conflictPayload,
    });
    expect(conflictAfterRestart.statusCode).toBe(409);
    expect(conflictAfterRestart.body).toBe(conflict.body);
    const successAfterRestart = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/element-history/undo`,
      payload: undoPayload,
    });
    expect(successAfterRestart.statusCode).toBe(200);
    expect(successAfterRestart.body).toBe(retried.body);
  });

  it("keeps one Project-scoped Undo/Redo cursor across multiple Pages", async () => {
    const fixture = createFixture();
    const app = createServer(fixture);
    const project = await createProject(app, "cross-page-history");
    const firstPage = await createPage(app, project);
    const secondPage = await createPage(app, {
      id: project.id,
      revision: firstPage.projectRevision,
    });
    const first = await addElement(
      app,
      firstPage.page.id,
      "text",
      0,
      secondPage.projectRevision,
    );
    const second = await addElement(
      app,
      secondPage.page.id,
      "button",
      0,
      first.projectRevision,
    );
    expect((await history(app, project.id)).undoCommand).toMatchObject({
      id: second.commandId,
      pageId: secondPage.page.id,
    });

    const undoSecondResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/element-history/undo`,
      payload: {
        expectedProjectRevision: second.projectRevision,
        expectedCommandId: second.commandId,
        idempotencyKey: `undo-second-page-${randomUUID()}`,
      },
    });
    expect(undoSecondResponse.statusCode, undoSecondResponse.body).toBe(200);
    const undoSecond = undoSecondResponse.json() as ElementHistoryMutationDto;
    expect(undoSecond.pageId).toBe(secondPage.page.id);
    expect((await history(app, project.id)).undoCommand?.id).toBe(
      first.commandId,
    );
    const firstList = await app.inject({
      method: "GET",
      url: `/api/v1/pages/${firstPage.page.id}/elements`,
    });
    const secondList = await app.inject({
      method: "GET",
      url: `/api/v1/pages/${secondPage.page.id}/elements`,
    });
    expect(
      (firstList.json() as { elements: readonly unknown[] }).elements,
    ).toHaveLength(1);
    expect(
      (secondList.json() as { elements: readonly unknown[] }).elements,
    ).toHaveLength(0);

    const undoFirstResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/element-history/undo`,
      payload: {
        expectedProjectRevision: undoSecond.projectRevision,
        expectedCommandId: first.commandId,
        idempotencyKey: `undo-first-page-${randomUUID()}`,
      },
    });
    expect(undoFirstResponse.statusCode, undoFirstResponse.body).toBe(200);
    const undoFirst = undoFirstResponse.json() as ElementHistoryMutationDto;
    expect((await history(app, project.id)).redoCommand?.id).toBe(
      first.commandId,
    );

    const redoFirstResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/element-history/redo`,
      payload: {
        expectedProjectRevision: undoFirst.projectRevision,
        expectedCommandId: first.commandId,
        idempotencyKey: `redo-first-page-${randomUUID()}`,
      },
    });
    expect(redoFirstResponse.statusCode, redoFirstResponse.body).toBe(200);
    const redoFirst = redoFirstResponse.json() as ElementHistoryMutationDto;
    expect((await history(app, project.id)).redoCommand?.id).toBe(
      second.commandId,
    );
    const redoSecondResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/element-history/redo`,
      payload: {
        expectedProjectRevision: redoFirst.projectRevision,
        expectedCommandId: second.commandId,
        idempotencyKey: `redo-second-page-${randomUUID()}`,
      },
    });
    expect(redoSecondResponse.statusCode, redoSecondResponse.body).toBe(200);
    expect((await history(app, project.id)).canRedo).toBe(false);
  });

  it("serves only immutable latest Published Elements and filters hidden Runtime entries", async () => {
    const fixture = createFixture();
    const app = createServer(fixture);
    const project = await createProject(app, "runtime-elements");
    const page = await createPage(app, project);
    const added = await addElement(
      app,
      page.page.id,
      "text",
      0,
      page.projectRevision,
    );
    const published = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/publish`,
      payload: {
        expectedProjectRevision: added.projectRevision,
        idempotencyKey: `publish-${randomUUID()}`,
      },
    });
    expect(published.statusCode, published.body).toBe(200);
    const publishedBody = published.json() as {
      versionId: string;
      projectRevision: number;
    };

    const draft = await app.inject({
      method: "PATCH",
      url: `/api/v1/elements/${added.entry.element.id}`,
      payload: {
        expectedRevision: added.entry.element.revision,
        expectedLayoutRevision: added.layoutRevision,
        expectedProjectRevision: publishedBody.projectRevision,
        idempotencyKey: `draft-${randomUUID()}`,
        change: {
          kind: "PROPERTIES",
          values: {
            "general.displayName": "Draft only",
            "general.visible": false,
          },
        },
      },
    });
    expect(draft.statusCode, draft.body).toBe(200);
    const draftBody = draft.json() as {
      entry: ElementEntryDto;
      projectRevision: number;
    };
    const runtimeBefore = await app.inject({
      method: "GET",
      url: `/api/v1/runtime/${project.id}/pages/${page.page.id}`,
    });
    expect(runtimeBefore.statusCode, runtimeBefore.body).toBe(200);
    const immutable = runtimeBefore.json() as PublishedRuntimePageDto;
    expect(immutable.versionId).toBe(publishedBody.versionId);
    expect(immutable.elements[0]?.element.name).toBe("Text");

    const republished = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/publish`,
      payload: {
        expectedProjectRevision: draftBody.projectRevision,
        idempotencyKey: `republish-${randomUUID()}`,
      },
    });
    expect(republished.statusCode, republished.body).toBe(200);
    const republishedBody = republished.json() as {
      versionId: string;
      projectRevision: number;
    };
    const runtimeAfter = await app.inject({
      method: "GET",
      url: `/api/v1/runtime/${project.id}/pages/${page.page.id}`,
    });
    expect(runtimeAfter.statusCode, runtimeAfter.body).toBe(200);
    const latest = runtimeAfter.json() as PublishedRuntimePageDto;
    expect(latest.versionId).not.toBe(publishedBody.versionId);
    expect(latest.elements).toHaveLength(0);

    const legacyVersionId = randomUUID();
    const legacyDatabase = new Database(fixture.databasePath);
    const latestSequence = legacyDatabase
      .prepare(
        "SELECT max(sequence) AS sequence FROM project_versions WHERE project_id = ?",
      )
      .get(project.id) as { sequence: number };
    legacyDatabase
      .prepare(
        `INSERT INTO project_versions (
           id, project_id, schema_version, sequence, source_project_revision,
           snapshot_json, published_at
         ) VALUES (?, ?, 1, ?, ?, ?, ?)`,
      )
      .run(
        legacyVersionId,
        project.id,
        latestSequence.sequence + 1,
        draftBody.projectRevision,
        JSON.stringify({
          pages: [
            {
              id: page.page.id,
              name: page.page.name,
              route: page.page.route,
              sortOrder: page.page.sortOrder,
              iconName: page.page.iconName,
              iconCatalogVersion: page.page.iconCatalogVersion,
              navigationVisible: true,
              navigationGroup: null,
            },
          ],
          elements: [
            {
              element: {
                ...added.entry.element,
                name: "Legacy Published",
                props: { text: "Legacy snapshot" },
                style: {},
                hidden: false,
              },
              layout: added.entry.layout,
            },
          ],
          layoutRevisions: [
            {
              pageId: page.page.id,
              breakpoint: "desktop",
              revision: added.layoutRevision,
            },
          ],
        }),
        new Date().toISOString(),
      );
    legacyDatabase.close();
    const legacyRuntime = await app.inject({
      method: "GET",
      url: `/api/v1/runtime/${project.id}/pages/${page.page.id}`,
    });
    expect(legacyRuntime.statusCode, legacyRuntime.body).toBe(200);
    const resolvedLegacy = legacyRuntime.json() as PublishedRuntimePageDto;
    expect(resolvedLegacy.versionId).toBe(legacyVersionId);
    expect(resolvedLegacy.elements[0]?.element).toMatchObject({
      name: "Legacy Published",
      props: {
        internalName: "text",
        text: "Legacy snapshot",
        disabled: false,
      },
      style: { padding: 8, backgroundToken: "card" },
    });
    const legacyExportResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/export`,
    });
    expect(legacyExportResponse.statusCode, legacyExportResponse.body).toBe(
      200,
    );
    const exportedLegacyVersion = (
      legacyExportResponse.json() as {
        export: {
          manifest: {
            publishedVersions: {
              id: string;
              elements: readonly ElementEntryDto[];
            }[];
          };
        };
      }
    ).export.manifest.publishedVersions.find(
      ({ id }) => id === legacyVersionId,
    );
    expect(exportedLegacyVersion?.elements[0]?.element).toMatchObject({
      props: {
        internalName: "text",
        text: "Legacy snapshot",
        disabled: false,
      },
      style: { padding: 8, backgroundToken: "card" },
    });

    const unpublished = await createProject(app, "unpublished-elements");
    const unpublishedPage = await createPage(app, unpublished);
    const noVersion = await app.inject({
      method: "GET",
      url: `/api/v1/runtime/${unpublished.id}/pages/${unpublishedPage.page.id}`,
    });
    expect(noVersion.statusCode).toBe(404);
    const foreignPage = await app.inject({
      method: "GET",
      url: `/api/v1/runtime/${project.id}/pages/${unpublishedPage.page.id}`,
    });
    expect(foreignPage.statusCode).toBe(404);
    expect(foreignPage.json()).toMatchObject({
      error: { code: "RUNTIME_PAGE_NOT_FOUND" },
    });

    const invalidDatabase = new Database(fixture.databasePath);
    const invalidSnapshot = JSON.parse(
      (
        invalidDatabase
          .prepare("SELECT snapshot_json FROM project_versions WHERE id = ?")
          .get(legacyVersionId) as { snapshot_json: string }
      ).snapshot_json,
    ) as { elements: { element: { type: string } }[] };
    invalidSnapshot.elements[0]!.element.type = "unregistered-element";
    invalidDatabase
      .prepare(
        `INSERT INTO project_versions (
           id, project_id, schema_version, sequence, source_project_revision,
           snapshot_json, published_at
         ) VALUES (?, ?, 1, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        project.id,
        latestSequence.sequence + 2,
        republishedBody.projectRevision,
        JSON.stringify(invalidSnapshot),
        new Date().toISOString(),
      );
    invalidDatabase.close();
    const invalidRuntime = await app.inject({
      method: "GET",
      url: `/api/v1/runtime/${project.id}/pages/${page.page.id}`,
    });
    expect(invalidRuntime.statusCode).toBe(500);
    expect(invalidRuntime.json()).toMatchObject({
      error: { code: "PUBLISHED_SNAPSHOT_INVALID" },
    });

    const trashed = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/trash`,
      payload: {
        expectedRevision: republishedBody.projectRevision,
        expectedLifecycleRevision: project.lifecycleRevision,
        idempotencyKey: `trash-runtime-${randomUUID()}`,
        reason: "runtime lifecycle isolation",
      },
    });
    expect(trashed.statusCode, trashed.body).toBe(200);
    const trashedRuntime = await app.inject({
      method: "GET",
      url: `/api/v1/runtime/${project.id}/pages/${page.page.id}`,
    });
    expect(trashedRuntime.statusCode).toBe(409);
    expect(trashedRuntime.json()).toMatchObject({
      error: { code: "PROJECT_NOT_ACTIVE" },
    });
  });

  it("enforces Project-scoped history ownership and migrates a v4 command snapshot into replayable history", async () => {
    const fixture = createFixture();
    let app = createServer(fixture);
    const firstProject = await createProject(app, "history-owner-a");
    const firstPage = await createPage(app, firstProject);
    const first = await addElement(
      app,
      firstPage.page.id,
      "text",
      0,
      firstPage.projectRevision,
    );
    const secondProject = await createProject(app, "history-owner-b");
    const secondPage = await createPage(app, secondProject);
    const second = await addElement(
      app,
      secondPage.page.id,
      "button",
      0,
      secondPage.projectRevision,
    );
    const crossProject = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${firstProject.id}/element-history/undo`,
      payload: {
        expectedProjectRevision: first.projectRevision,
        expectedCommandId: second.commandId,
        idempotencyKey: `cross-project-${randomUUID()}`,
      },
    });
    expect(crossProject.statusCode).toBe(409);

    const database = new Database(fixture.databasePath);
    database.pragma("foreign_keys = ON");
    const operation = database
      .prepare(
        `SELECT project_id, command_id, requested_command_id
         FROM element_history_operations WHERE project_id = ?`,
      )
      .get(firstProject.id) as {
      project_id: string;
      command_id: string;
      requested_command_id: string;
    };
    expect(operation).toEqual({
      project_id: firstProject.id,
      command_id: first.commandId,
      requested_command_id: second.commandId,
    });
    expect(() =>
      database
        .prepare(
          `INSERT INTO element_history_operations (
             id, project_id, command_id, requested_command_id, operation_type,
             idempotency_key, request_hash, response_status, response_json,
             created_at
           ) VALUES (?, ?, ?, ?, 'UNDO', ?, 'hash', 409, '{}', ?)`,
        )
        .run(
          randomUUID(),
          firstProject.id,
          second.commandId,
          second.commandId,
          `forbidden-${randomUUID()}`,
          new Date().toISOString(),
        ),
    ).toThrow();
    database.close();

    await closeServer(app);
    const version4 = new Database(fixture.databasePath);
    version4.pragma("foreign_keys = OFF");
    version4
      .prepare(
        "UPDATE elements SET props_json = ?, style_json = ? WHERE id = ?",
      )
      .run('{"text":"Legacy text"}', "{}", first.entry.element.id);
    const legacyCommand = version4
      .prepare("SELECT after_json FROM element_commands WHERE id = ?")
      .get(first.commandId) as { after_json: string };
    const legacyAfter = JSON.parse(legacyCommand.after_json) as {
      element: {
        props: Record<string, unknown>;
        style: Record<string, unknown>;
      };
    };
    legacyAfter.element.props = { text: "Legacy text" };
    legacyAfter.element.style = {};
    version4
      .prepare("UPDATE element_commands SET after_json = ? WHERE id = ?")
      .run(JSON.stringify(legacyAfter), first.commandId);
    version4.exec(`
      DROP TRIGGER pages_initialize_page_type_assignment;
      DROP TABLE page_type_assignments;
      DROP TABLE auth_events;
      DROP TABLE auth_sessions;
      DROP TABLE admin_accounts;
      DROP TABLE backup_restore_runs;
      DROP TABLE backup_commands;
      DROP TABLE project_backups;
      DROP TABLE validation_commands;
      DROP TABLE validation_run_items;
      DROP TABLE validation_runs;
      DROP TRIGGER projects_initialize_theme_settings;
      DROP TABLE theme_revision_commands;
      DROP TABLE project_theme_settings;
      DROP TABLE theme_revisions;
      DROP TABLE binding_query_runs;
      DROP TABLE sample_data_commands;
      DROP TABLE project_variable_commands;
      DROP TABLE project_variables;
      DROP TABLE relationship_layout_history_operations;
      DROP TABLE relationship_layout_commands;
      DROP TABLE relationship_node_positions;
      DROP TRIGGER projects_initialize_relationship_viewport;
      DROP TABLE project_relationship_viewports;
      DROP TABLE binding_history_operations;
      DROP TABLE binding_commands;
      DROP TABLE bindings;
      DROP TRIGGER projects_initialize_binding_state;
      DROP TABLE project_binding_states;
      DROP TRIGGER projects_initialize_schema_state;
      DROP TABLE schema_commands;
      DROP TABLE schema_backups;
      DROP TABLE schema_migration_plans;
      DROP TABLE data_relations;
      DROP TABLE data_fields;
      DROP TABLE data_tables;
      DROP TABLE project_schema_states;
      DROP TABLE element_binding_placeholders;
      DROP TABLE layout_preset_instance_elements;
      DROP TABLE layout_preset_instances;
      DROP TABLE element_history_operations;
      DELETE FROM metadata_migrations WHERE version >= 5;
    `);
    version4.pragma("user_version = 4");
    version4.close();
    app = createServer(fixture);
    const canonical = await app.inject({
      method: "GET",
      url: `/api/v1/elements/${first.entry.element.id}`,
    });
    expect(canonical.statusCode, canonical.body).toBe(200);
    expect(
      (canonical.json() as ElementInspectorDto).entry.element,
    ).toMatchObject({
      props: { internalName: "text", text: "Legacy text", disabled: false },
      style: { padding: 8, backgroundToken: "card" },
    });
    const migratedHistory = await history(app, firstProject.id);
    expect(migratedHistory.undoCommand?.id).toBe(first.commandId);
    const undo = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${firstProject.id}/element-history/undo`,
      payload: {
        expectedProjectRevision: first.projectRevision,
        expectedCommandId: first.commandId,
        idempotencyKey: `migrated-undo-${randomUUID()}`,
      },
    });
    expect(undo.statusCode, undo.body).toBe(200);
    const list = await app.inject({
      method: "GET",
      url: `/api/v1/pages/${firstPage.page.id}/elements`,
    });
    expect((list.json() as { elements: readonly unknown[] }).elements).toEqual(
      [],
    );
    const redoCommand = (await history(app, firstProject.id)).redoCommand;
    const undoBody = undo.json() as ElementHistoryMutationDto;
    const redoResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${firstProject.id}/element-history/redo`,
      payload: {
        expectedProjectRevision: undoBody.projectRevision,
        expectedCommandId: redoCommand?.id,
        idempotencyKey: `migrated-redo-${randomUUID()}`,
      },
    });
    expect(redoResponse.statusCode, redoResponse.body).toBe(200);
    expect(
      (redoResponse.json() as ElementHistoryMutationDto).entries[0]?.element,
    ).toMatchObject({
      props: { internalName: "text", text: "Legacy text", disabled: false },
      style: { padding: 8, backgroundToken: "card" },
    });
  });

  it("preserves Registry state and immutable versions while clone and import start with isolated empty history", async () => {
    const fixture = createFixture();
    const app = createServer(fixture);
    const project = await createProject(app, "history-export-source");
    const page = await createPage(app, project);
    const added = await addElement(
      app,
      page.page.id,
      "data-table",
      0,
      page.projectRevision,
    );
    const patchedResponse = await app.inject({
      method: "PATCH",
      url: `/api/v1/elements/${added.entry.element.id}`,
      payload: {
        expectedRevision: added.entry.element.revision,
        expectedLayoutRevision: added.layoutRevision,
        expectedProjectRevision: added.projectRevision,
        idempotencyKey: `table-properties-${randomUUID()}`,
        change: {
          kind: "PROPERTIES",
          values: {
            "general.displayName": "Measurements",
            "general.internalName": "measurementsTable",
            "general.title": "Measurements",
            "data.emptyLabel": "No measurements",
            "style.density": "compact",
          },
        },
      },
    });
    expect(patchedResponse.statusCode, patchedResponse.body).toBe(200);
    const patched = patchedResponse.json() as {
      entry: ElementEntryDto;
      projectRevision: number;
    };
    const published = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/publish`,
      payload: {
        expectedProjectRevision: patched.projectRevision,
        idempotencyKey: `publish-export-${randomUUID()}`,
      },
    });
    expect(published.statusCode, published.body).toBe(200);

    const clonedResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/clone`,
      payload: { name: "History Clone", slug: "history-clone" },
    });
    expect(clonedResponse.statusCode, clonedResponse.body).toBe(201);
    const clone = (clonedResponse.json() as { project: ProjectDto }).project;
    expect((await history(app, clone.id)).commands).toEqual([]);
    const clonePages = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${clone.id}/pages`,
    });
    const clonePage = (clonePages.json() as { pages: readonly PageDto[] })
      .pages[0] as PageDto;
    const cloneElements = await app.inject({
      method: "GET",
      url: `/api/v1/pages/${clonePage.id}/elements`,
    });
    const cloneEntry = (
      cloneElements.json() as { elements: readonly ElementEntryDto[] }
    ).elements[0] as ElementEntryDto;
    expect(cloneEntry.element).toMatchObject({
      name: "Measurements",
      props: {
        internalName: "measurementsTable",
        title: "Measurements",
        emptyLabel: "No measurements",
      },
      style: { density: "compact" },
      events: [],
    });
    expect(cloneEntry.layout).toMatchObject({
      x: patched.entry.layout.x,
      y: patched.entry.layout.y,
      w: patched.entry.layout.w,
      h: patched.entry.layout.h,
    });

    const exported = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/export`,
    });
    expect(exported.statusCode, exported.body).toBe(200);
    const exportDto = (exported.json() as { export: Record<string, unknown> })
      .export;
    const importedResponse = await app.inject({
      method: "POST",
      url: "/api/v1/projects/import",
      payload: {
        export: exportDto,
        name: "History Import",
        slug: "history-import",
      },
    });
    expect(importedResponse.statusCode, importedResponse.body).toBe(201);
    const imported = (importedResponse.json() as { project: ProjectDto })
      .project;
    expect((await history(app, imported.id)).commands).toEqual([]);
    const importedNavigation = await app.inject({
      method: "GET",
      url: `/api/v1/runtime/${imported.id}/navigation`,
    });
    expect(importedNavigation.statusCode, importedNavigation.body).toBe(200);
    const importedPages = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${imported.id}/pages`,
    });
    const importedPage = (importedPages.json() as { pages: readonly PageDto[] })
      .pages[0] as PageDto;
    const importedElements = await app.inject({
      method: "GET",
      url: `/api/v1/pages/${importedPage.id}/elements`,
    });
    const importedEntry = (
      importedElements.json() as { elements: readonly ElementEntryDto[] }
    ).elements[0] as ElementEntryDto;
    expect(importedEntry.element).toMatchObject({
      name: "Measurements",
      props: {
        internalName: "measurementsTable",
        title: "Measurements",
        emptyLabel: "No measurements",
      },
      style: { density: "compact" },
      events: [],
    });
    expect(importedEntry.layout).toMatchObject({
      x: patched.entry.layout.x,
      y: patched.entry.layout.y,
      w: patched.entry.layout.w,
      h: patched.entry.layout.h,
    });
    const importedRuntime = await app.inject({
      method: "GET",
      url: `/api/v1/runtime/${imported.id}/pages/${importedPage.id}`,
    });
    expect(importedRuntime.statusCode, importedRuntime.body).toBe(200);
    expect(
      (importedRuntime.json() as PublishedRuntimePageDto).elements[0]?.element,
    ).toMatchObject({
      name: "Measurements",
      props: { title: "Measurements", emptyLabel: "No measurements" },
      style: { density: "compact" },
      events: [],
    });
    expect((await history(app, project.id)).commands.length).toBeGreaterThan(0);

    type MutableElementExport = {
      manifest: {
        elements: {
          element: {
            type: string;
            props: Record<string, unknown>;
            style: Record<string, unknown>;
            events: unknown[];
          };
          layout: Record<string, unknown>;
        }[];
      };
    };
    const malformedCases: readonly {
      readonly slug: string;
      readonly mutate: (
        entry: MutableElementExport["manifest"]["elements"][number],
      ) => void;
    }[] = [
      {
        slug: "rejected-registry-rows",
        mutate: ({ element }) => {
          element.props.rows = [
            { unbounded: "runtime data must not be embedded" },
          ];
        },
      },
      {
        slug: "rejected-registry-type",
        mutate: ({ element }) => {
          element.type = "unregistered-element";
        },
      },
      {
        slug: "rejected-registry-events",
        mutate: ({ element }) => {
          element.events = [{ kind: "arbitrary-action" }];
        },
      },
      {
        slug: "rejected-registry-bounds",
        mutate: ({ element, layout }) => {
          element.type = "number-input";
          element.props = { defaultValue: 0, minimum: 100 };
          element.style = {};
          layout.minW = 3;
          layout.minH = 5;
          layout.maxW = 12;
          layout.maxH = 14;
        },
      },
    ];
    for (const malformedCase of malformedCases) {
      const malformed = structuredClone(exportDto) as MutableElementExport;
      malformedCase.mutate(malformed.manifest.elements[0]!);
      const rejected = await app.inject({
        method: "POST",
        url: "/api/v1/projects/import",
        payload: {
          export: malformed,
          name: "Rejected Registry Import",
          slug: malformedCase.slug,
        },
      });
      expect(rejected.statusCode, rejected.body).toBe(400);
    }
    const projects = await app.inject({
      method: "GET",
      url: "/api/v1/projects",
    });
    expect(
      (
        projects.json() as { projects: readonly { slug: string }[] }
      ).projects.some(({ slug }) =>
        malformedCases.some(({ slug: rejectedSlug }) => slug === rejectedSlug),
      ),
    ).toBe(false);
  });

  it("preserves same-project properties and durable history through trash, restart, and restore", async () => {
    const fixture = createFixture();
    let app = createServer(fixture);
    const project = await createProject(app, "history-trash-restore");
    const page = await createPage(app, project);
    const added = await addElement(
      app,
      page.page.id,
      "number-input",
      0,
      page.projectRevision,
    );
    const patchedResponse = await app.inject({
      method: "PATCH",
      url: `/api/v1/elements/${added.entry.element.id}`,
      payload: {
        expectedRevision: added.entry.element.revision,
        expectedLayoutRevision: added.layoutRevision,
        expectedProjectRevision: added.projectRevision,
        idempotencyKey: `trash-properties-${randomUUID()}`,
        change: {
          kind: "PROPERTIES",
          values: {
            "general.displayName": "Preserved Number",
            "general.internalName": "preservedNumber",
            "general.placeholder": "Still here",
            "style.backgroundToken": "accent",
          },
        },
      },
    });
    expect(patchedResponse.statusCode, patchedResponse.body).toBe(200);
    const patched = patchedResponse.json() as {
      entry: ElementEntryDto;
      projectRevision: number;
    };
    const beforeHistory = await history(app, project.id);
    expect(beforeHistory.commands.map(({ type }) => type)).toEqual([
      "ADD",
      "PROPERTIES",
    ]);

    const trashedResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/trash`,
      payload: {
        expectedRevision: patched.projectRevision,
        expectedLifecycleRevision: project.lifecycleRevision,
        idempotencyKey: `trash-history-${randomUUID()}`,
        reason: "Phase 6 lifecycle regression",
      },
    });
    expect(trashedResponse.statusCode, trashedResponse.body).toBe(200);
    const trashed = (trashedResponse.json() as { project: ProjectDto }).project;
    expect(trashed.lifecycleStatus).toBe("TRASHED");

    await closeServer(app);
    app = createServer(fixture);
    const restoredResponse = await app.inject({
      method: "POST",
      url: `/api/v1/recycle-bin/projects/${project.id}/restore`,
      payload: {
        expectedLifecycleRevision: trashed.lifecycleRevision,
        idempotencyKey: `restore-history-${randomUUID()}`,
        conflictResolution: "KEEP_ORIGINAL",
      },
    });
    expect(restoredResponse.statusCode, restoredResponse.body).toBe(200);
    expect(
      (restoredResponse.json() as { project: ProjectDto }).project,
    ).toMatchObject({
      id: project.id,
      lifecycleStatus: "ACTIVE",
    });

    const inspectorResponse = await app.inject({
      method: "GET",
      url: `/api/v1/elements/${added.entry.element.id}`,
    });
    expect(inspectorResponse.statusCode, inspectorResponse.body).toBe(200);
    expect(
      (inspectorResponse.json() as ElementInspectorDto).entry.element,
    ).toMatchObject({
      id: added.entry.element.id,
      name: "Preserved Number",
      props: {
        internalName: "preservedNumber",
        placeholder: "Still here",
      },
      style: { backgroundToken: "accent" },
    });
    expect(await history(app, project.id)).toEqual(beforeHistory);
  });
});
