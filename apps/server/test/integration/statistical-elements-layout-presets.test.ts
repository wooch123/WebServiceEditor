import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ELEMENT_DEFINITIONS,
  LAYOUT_PRESET_IDS,
  type ApplyLayoutPresetDto,
  type ElementHistoryMutationDto,
  type LayoutPresetInstanceDto,
  type LayoutPresetPreviewDto,
  type LayoutPresetRegistryDto,
  type PageDto,
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

interface Project {
  readonly id: string;
  readonly name: string;
  readonly revision: number;
  readonly lifecycleRevision: number;
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
  const directory = mkdtempSync(join(tmpdir(), "webeditor-phase7-"));
  directories.push(directory);
  return {
    directory,
    databasePath: join(directory, "metadata", "webeditor.sqlite"),
    storageRoot: join(directory, "projects"),
  };
}

function server(
  current: Fixture,
  options: {
    readonly failPreset?: () => boolean;
    readonly clock?: () => Date;
  } = {},
): FastifyInstance {
  const app = buildServer({
    metadataDatabasePath: current.databasePath,
    storageRoot: current.storageRoot,
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    ...(options.failPreset === undefined
      ? {}
      : {
          layoutPresetFailureInjector: () => {
            if (options.failPreset?.())
              throw new Error("injected preset failure");
          },
        }),
  });
  apps.push(app);
  return app;
}

async function close(app: FastifyInstance): Promise<void> {
  const index = apps.indexOf(app);
  if (index >= 0) apps.splice(index, 1);
  await app.close();
}

async function createProjectAndPage(app: FastifyInstance): Promise<{
  readonly project: Project;
  readonly page: PageDto;
  readonly projectRevision: number;
}> {
  const projectResponse = await app.inject({
    method: "POST",
    url: "/api/v1/projects",
    payload: {
      name: `Phase 7 ${randomUUID().slice(0, 8)}`,
      slug: `phase-7-${randomUUID().slice(0, 8)}`,
    },
  });
  expect(projectResponse.statusCode, projectResponse.body).toBe(201);
  const project = (projectResponse.json() as { project: Project }).project;
  const pageResponse = await app.inject({
    method: "POST",
    url: `/api/v1/projects/${project.id}/pages`,
    payload: {
      name: "Analysis",
      pageType: "blank",
      expectedProjectRevision: project.revision,
      idempotencyKey: `phase7-page-${randomUUID()}`,
    },
  });
  expect(pageResponse.statusCode, pageResponse.body).toBe(201);
  const pageBody = pageResponse.json() as {
    readonly page: PageDto;
    readonly projectRevision: number;
  };
  return { project, ...pageBody };
}

async function preview(
  app: FastifyInstance,
  pageId: string,
  presetId: string,
  projectRevision: number,
  layoutRevision = 0,
  mode: "ADD" | "REPLACE" = "ADD",
): Promise<LayoutPresetPreviewDto> {
  const response = await app.inject({
    method: "POST",
    url: `/api/v1/pages/${pageId}/layout-presets/${presetId}/preview`,
    payload: {
      mode,
      expectedLayoutRevision: layoutRevision,
      expectedProjectRevision: projectRevision,
    },
  });
  expect(response.statusCode, response.body).toBe(200);
  return (response.json() as { preview: LayoutPresetPreviewDto }).preview;
}

async function apply(
  app: FastifyInstance,
  pageId: string,
  presetId: string,
  candidate: LayoutPresetPreviewDto,
  idempotencyKey: string,
) {
  const request = {
    previewId: candidate.previewId,
    expectedLayoutRevision: candidate.layoutRevision,
    expectedProjectRevision: candidate.projectRevision,
    idempotencyKey,
  };
  const response = await app.inject({
    method: "POST",
    url: `/api/v1/pages/${pageId}/layout-presets/${presetId}/apply`,
    payload: request,
  });
  return { response, request };
}

function sqliteSchema(databasePath: string): string {
  const database = new Database(databasePath, { readonly: true });
  try {
    return JSON.stringify(
      database
        .prepare(
          `SELECT type, name, tbl_name, sql FROM sqlite_schema
           WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name`,
        )
        .all(),
    );
  } finally {
    database.close();
  }
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

async function instances(
  app: FastifyInstance,
  pageId: string,
): Promise<readonly LayoutPresetInstanceDto[]> {
  const response = await app.inject({
    method: "GET",
    url: `/api/v1/pages/${pageId}/layout-preset-instances`,
  });
  expect(response.statusCode, response.body).toBe(200);
  return (response.json() as { instances: readonly LayoutPresetInstanceDto[] })
    .instances;
}

describe("Phase 7 statistical Elements and Layout Presets", () => {
  it("uses real templates with exact element count and coordinate bounds/no overlap for all 22 Presets", async () => {
    const current = fixture();
    const app = server(current);
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/layout-presets",
    });
    expect(response.statusCode, response.body).toBe(200);
    const registry = response.json() as LayoutPresetRegistryDto;
    for (const definition of registry.definitions) {
      expect(definition.elementCount).toBe(definition.elements.length);
      expect(definition.elements.length).toBeGreaterThan(0);
      expect(
        new Set(definition.elements.map(({ templateId }) => templateId)).size,
      ).toBe(definition.elements.length);
      for (const [index, template] of definition.elements.entries()) {
        expect(template.layout.x).toBeGreaterThanOrEqual(0);
        expect(template.layout.y).toBeGreaterThanOrEqual(0);
        expect(template.layout.x + template.layout.w).toBeLessThanOrEqual(24);
        for (const other of definition.elements.slice(index + 1)) {
          const separated =
            template.layout.x + template.layout.w <= other.layout.x ||
            other.layout.x + other.layout.w <= template.layout.x ||
            template.layout.y + template.layout.h <= other.layout.y ||
            other.layout.y + other.layout.h <= template.layout.y;
          expect(separated).toBe(true);
        }
      }
      expect(definition.bindingPlaceholders.length).toBeGreaterThan(0);
      for (const placeholder of definition.bindingPlaceholders) {
        const template = definition.elements.find(
          ({ templateId }) => templateId === placeholder.templateId,
        );
        expect(template).toBeDefined();
        const elementDefinition = ELEMENT_DEFINITIONS.find(
          ({ type }) => type === template?.elementType,
        );
        expect(
          elementDefinition?.bindingPorts.some(
            (port) =>
              port.id === placeholder.portId &&
              port.required &&
              port.direction === "input" &&
              port.side === "left",
          ),
        ).toBe(true);
        expect(placeholder.status).toBe("UNCONNECTED");
      }
    }
  });

  it("reloads exact durable instances after restart while suggestedSchema leaves runtime DB schema and checksums unchanged", async () => {
    const current = fixture();
    let app = server(current);
    const registryResponse = await app.inject({
      method: "GET",
      url: "/api/v1/layout-presets",
    });
    expect(registryResponse.statusCode, registryResponse.body).toBe(200);
    const registry = registryResponse.json() as LayoutPresetRegistryDto;
    expect(registry.definitions.map(({ id }) => id)).toEqual(LAYOUT_PRESET_IDS);
    expect(registry.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(
      registry.definitions.every(({ elementCount }) => elementCount > 0),
    ).toBe(true);
    expect(
      registry.definitions.every(
        ({ bindingPlaceholders }) => bindingPlaceholders.length > 0,
      ),
    ).toBe(true);
    expect(
      registry.definitions.find(({ id }) => id === "data-entry")
        ?.suggestedSchema,
    ).not.toBeNull();
    expect(JSON.stringify(registry)).not.toMatch(/previewData|sampleData/);

    const { project, page, projectRevision } = await createProjectAndPage(app);
    const testDatabase = join(
      current.storageRoot,
      "active",
      project.id,
      "test.sqlite",
    );
    const productionDatabase = join(
      current.storageRoot,
      "active",
      project.id,
      "production.sqlite",
    );
    const beforeRuntime = {
      test: sha256(testDatabase),
      production: sha256(productionDatabase),
      testSchema: sqliteSchema(testDatabase),
      productionSchema: sqliteSchema(productionDatabase),
    };
    const candidate = await preview(
      app,
      page.id,
      "data-entry",
      projectRevision,
    );
    expect(candidate.presetSnapshot.id).toBe("data-entry");
    expect(candidate.proposedElements).toHaveLength(
      candidate.createdElementCount,
    );
    expect(candidate.coordinateChecksum).toMatch(/^[0-9a-f]{64}$/);
    expect(candidate.suggestedSchema).not.toBeNull();
    const beforeApply = new Database(current.databasePath, { readonly: true });
    expect(
      (
        beforeApply.prepare("SELECT count(*) AS count FROM elements").get() as {
          count: number;
        }
      ).count,
    ).toBe(0);
    beforeApply.close();

    const key = `preset-apply-${randomUUID()}`;
    const appliedResponse = await apply(
      app,
      page.id,
      "data-entry",
      candidate,
      key,
    );
    expect(
      appliedResponse.response.statusCode,
      appliedResponse.response.body,
    ).toBe(201);
    const applied = appliedResponse.response.json() as ApplyLayoutPresetDto;
    expect(applied.coordinateChecksum).toBe(candidate.coordinateChecksum);
    expect(applied.instance.coordinateChecksum).toBe(
      candidate.coordinateChecksum,
    );
    expect(applied.proposedElements).toEqual(candidate.proposedElements);
    expect(applied.layoutRevision).toBe(candidate.layoutRevision + 1);
    expect(applied.projectRevision).toBe(candidate.projectRevision + 1);
    expect(
      applied.bindingPlaceholders.every(
        ({ status }) => status === "UNCONNECTED",
      ),
    ).toBe(true);
    expect(applied.createdElementIds).toHaveLength(
      candidate.createdElementCount,
    );
    expect({
      test: sha256(testDatabase),
      production: sha256(productionDatabase),
      testSchema: sqliteSchema(testDatabase),
      productionSchema: sqliteSchema(productionDatabase),
    }).toEqual(beforeRuntime);

    const replay = await app.inject({
      method: "POST",
      url: `/api/v1/pages/${page.id}/layout-presets/data-entry/apply`,
      payload: appliedResponse.request,
    });
    expect(replay.statusCode, replay.body).toBe(201);
    expect(replay.json()).toEqual(applied);
    const database = new Database(current.databasePath, { readonly: true });
    expect(
      database
        .prepare(
          `SELECT
             (SELECT count(*) FROM element_commands WHERE command_type = 'PRESET_APPLY') AS commands,
             (SELECT count(*) FROM layout_preset_instances) AS instances,
             (SELECT count(*) FROM layout_preset_instance_elements) AS memberships,
             (SELECT count(*) FROM element_binding_placeholders) AS placeholders`,
        )
        .get(),
    ).toEqual({
      commands: 1,
      instances: 1,
      memberships: candidate.createdElementCount,
      placeholders: candidate.bindingPlaceholders.length,
    });
    database.close();

    const beforeRestart = await instances(app, page.id);
    expect(beforeRestart).toEqual([applied.instance]);
    await close(app);
    app = server(current);
    expect(await instances(app, page.id)).toEqual(beforeRestart);

    const trashed = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/trash`,
      payload: {
        expectedRevision: applied.projectRevision,
        expectedLifecycleRevision: project.lifecycleRevision,
        idempotencyKey: `trash-phase7-${randomUUID()}`,
      },
    });
    expect(trashed.statusCode, trashed.body).toBe(200);
    const replayAfterTrash = await app.inject({
      method: "POST",
      url: `/api/v1/pages/${page.id}/layout-presets/data-entry/apply`,
      payload: appliedResponse.request,
    });
    expect(replayAfterTrash.statusCode, replayAfterTrash.body).toBe(201);
    expect(replayAfterTrash.json()).toEqual(applied);
    const conflictAfterTrash = await app.inject({
      method: "POST",
      url: `/api/v1/pages/${page.id}/layout-presets/data-entry/apply`,
      payload: { ...appliedResponse.request, previewId: randomUUID() },
    });
    expect(conflictAfterTrash.statusCode, conflictAfterTrash.body).toBe(409);
    expect(conflictAfterTrash.json()).toMatchObject({
      error: { code: "IDEMPOTENCY_PAYLOAD_CONFLICT" },
    });
  });

  it("uses deterministic collision-free ADD translation and exact confirmed REPLACE impact while refusing locked replacement", async () => {
    const current = fixture();
    const app = server(current);
    const { page, projectRevision } = await createProjectAndPage(app);
    const firstPreview = await preview(
      app,
      page.id,
      "blank-grid",
      projectRevision,
    );
    const firstResponse = await apply(
      app,
      page.id,
      "blank-grid",
      firstPreview,
      `add-first-${randomUUID()}`,
    );
    expect(firstResponse.response.statusCode, firstResponse.response.body).toBe(
      201,
    );
    const first = firstResponse.response.json() as ApplyLayoutPresetDto;
    const firstBottom = Math.max(
      ...first.entries.map(({ layout }) => layout.y + layout.h),
    );
    const secondPreview = await preview(
      app,
      page.id,
      "blank-grid",
      first.projectRevision,
      first.layoutRevision,
    );
    expect(secondPreview.proposedElements[0]?.entry.layout.y).toBe(firstBottom);
    const secondResponse = await apply(
      app,
      page.id,
      "blank-grid",
      secondPreview,
      `add-second-${randomUUID()}`,
    );
    expect(
      secondResponse.response.statusCode,
      secondResponse.response.body,
    ).toBe(201);
    const second = secondResponse.response.json() as ApplyLayoutPresetDto;
    expect(second.entries).toHaveLength(2);
    const replacePreview = await preview(
      app,
      page.id,
      "data-table",
      second.projectRevision,
      second.layoutRevision,
      "REPLACE",
    );
    expect(replacePreview.deletedElementIds).toEqual(
      second.entries.map(({ element }) => element.id),
    );
    expect(replacePreview.warnings).toContainEqual(
      expect.objectContaining({ code: "REPLACE_EXISTING_ELEMENTS" }),
    );
    const replaceResponse = await apply(
      app,
      page.id,
      "data-table",
      replacePreview,
      `replace-confirmed-${randomUUID()}`,
    );
    expect(
      replaceResponse.response.statusCode,
      replaceResponse.response.body,
    ).toBe(201);
    const replaced = replaceResponse.response.json() as ApplyLayoutPresetDto;
    expect(replaced.entries).toHaveLength(1);
    expect(replaced.deletedElementIds).toEqual(
      replacePreview.deletedElementIds,
    );

    const lockedResponse = await app.inject({
      method: "PATCH",
      url: `/api/v1/elements/${replaced.entries[0]?.element.id}`,
      payload: {
        expectedRevision: replaced.entries[0]?.element.revision,
        expectedLayoutRevision: replaced.layoutRevision,
        expectedProjectRevision: replaced.projectRevision,
        idempotencyKey: `lock-replace-${randomUUID()}`,
        change: { kind: "LOCK", locked: true },
      },
    });
    expect(lockedResponse.statusCode, lockedResponse.body).toBe(200);
    const locked = lockedResponse.json() as {
      readonly layoutRevision: number;
      readonly projectRevision: number;
    };
    const refused = await app.inject({
      method: "POST",
      url: `/api/v1/pages/${page.id}/layout-presets/blank-grid/preview`,
      payload: {
        mode: "REPLACE",
        expectedLayoutRevision: locked.layoutRevision,
        expectedProjectRevision: locked.projectRevision,
      },
    });
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json()).toMatchObject({
      error: { code: "LAYOUT_PRESET_LOCKED_ELEMENTS" },
    });
  });

  it("rejects expired, stale, reused, and cross-scope preview snapshots", async () => {
    const current = fixture();
    let now = Date.parse("2026-08-16T00:00:00.000Z");
    const app = server(current, { clock: () => new Date(now) });
    const first = await createProjectAndPage(app);
    const second = await createProjectAndPage(app);
    const candidate = await preview(
      app,
      first.page.id,
      "blank-grid",
      first.projectRevision,
    );
    const crossScope = await app.inject({
      method: "POST",
      url: `/api/v1/pages/${second.page.id}/layout-presets/blank-grid/apply`,
      payload: {
        previewId: candidate.previewId,
        expectedLayoutRevision: candidate.layoutRevision,
        expectedProjectRevision: second.projectRevision,
        idempotencyKey: `cross-scope-${randomUUID()}`,
      },
    });
    expect(crossScope.statusCode, crossScope.body).toBe(409);
    expect(crossScope.json()).toMatchObject({
      error: { code: "LAYOUT_PRESET_PREVIEW_SCOPE_MISMATCH" },
    });
    const crossPreset = await app.inject({
      method: "POST",
      url: `/api/v1/pages/${first.page.id}/layout-presets/data-table/apply`,
      payload: {
        previewId: candidate.previewId,
        expectedLayoutRevision: candidate.layoutRevision,
        expectedProjectRevision: candidate.projectRevision,
        idempotencyKey: `cross-preset-${randomUUID()}`,
      },
    });
    expect(crossPreset.statusCode, crossPreset.body).toBe(409);
    expect(crossPreset.json()).toMatchObject({
      error: { code: "LAYOUT_PRESET_PREVIEW_SCOPE_MISMATCH" },
    });
    const committedResponse = await apply(
      app,
      first.page.id,
      "blank-grid",
      candidate,
      `consume-preview-${randomUUID()}`,
    );
    expect(
      committedResponse.response.statusCode,
      committedResponse.response.body,
    ).toBe(201);
    const committed = committedResponse.response.json() as ApplyLayoutPresetDto;
    const reused = await app.inject({
      method: "POST",
      url: `/api/v1/pages/${first.page.id}/layout-presets/blank-grid/apply`,
      payload: {
        ...committedResponse.request,
        idempotencyKey: `reuse-preview-${randomUUID()}`,
      },
    });
    expect(reused.statusCode, reused.body).toBe(409);
    expect(reused.json()).toMatchObject({
      error: { code: "LAYOUT_PRESET_PREVIEW_STALE" },
    });

    const expiring = await preview(
      app,
      first.page.id,
      "data-table",
      committed.projectRevision,
      committed.layoutRevision,
    );
    now += 5 * 60 * 1_000;
    const expired = await apply(
      app,
      first.page.id,
      "data-table",
      expiring,
      `expired-preview-${randomUUID()}`,
    );
    expect(expired.response.statusCode, expired.response.body).toBe(409);
    expect(expired.response.json()).toMatchObject({
      error: { code: "LAYOUT_PRESET_PREVIEW_EXPIRED" },
    });

    const staleCandidate = await preview(
      app,
      first.page.id,
      "data-table",
      committed.projectRevision,
      committed.layoutRevision,
    );
    const changed = await app.inject({
      method: "POST",
      url: `/api/v1/pages/${first.page.id}/elements`,
      payload: {
        elementType: "text",
        expectedLayoutRevision: committed.layoutRevision,
        expectedProjectRevision: committed.projectRevision,
        idempotencyKey: `stale-change-${randomUUID()}`,
      },
    });
    expect(changed.statusCode, changed.body).toBe(201);
    const stale = await apply(
      app,
      first.page.id,
      "data-table",
      staleCandidate,
      `stale-preview-${randomUUID()}`,
    );
    expect(stale.response.statusCode, stale.response.body).toBe(409);
    expect(stale.response.json()).toMatchObject({
      error: { code: "LAYOUT_REVISION_CONFLICT" },
    });
  });

  it("keeps PRESET_APPLY instance state synchronized through undo, redo, and branch discard", async () => {
    const current = fixture();
    const app = server(current);
    const { project, page, projectRevision } = await createProjectAndPage(app);
    const firstPreview = await preview(
      app,
      page.id,
      "blank-grid",
      projectRevision,
    );
    const firstResult = await apply(
      app,
      page.id,
      "blank-grid",
      firstPreview,
      `first-preset-${randomUUID()}`,
    );
    expect(firstResult.response.statusCode, firstResult.response.body).toBe(
      201,
    );
    const first = firstResult.response.json() as ApplyLayoutPresetDto;

    const undoResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/element-history/undo`,
      payload: {
        expectedProjectRevision: first.projectRevision,
        expectedCommandId: first.commandId,
        idempotencyKey: `undo-preset-${randomUUID()}`,
      },
    });
    expect(undoResponse.statusCode, undoResponse.body).toBe(200);
    const undo = undoResponse.json() as ElementHistoryMutationDto;
    expect((await instances(app, page.id))[0]?.state).toBe("UNDONE");

    const redoResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/element-history/redo`,
      payload: {
        expectedProjectRevision: undo.projectRevision,
        expectedCommandId: first.commandId,
        idempotencyKey: `redo-preset-${randomUUID()}`,
      },
    });
    expect(redoResponse.statusCode, redoResponse.body).toBe(200);
    const redo = redoResponse.json() as ElementHistoryMutationDto;
    expect((await instances(app, page.id))[0]?.state).toBe("APPLIED");

    const secondUndoResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/element-history/undo`,
      payload: {
        expectedProjectRevision: redo.projectRevision,
        expectedCommandId: first.commandId,
        idempotencyKey: `undo-preset-branch-${randomUUID()}`,
      },
    });
    expect(secondUndoResponse.statusCode, secondUndoResponse.body).toBe(200);
    const secondUndo = secondUndoResponse.json() as ElementHistoryMutationDto;
    const branchPreview = await preview(
      app,
      page.id,
      "data-table",
      secondUndo.projectRevision,
      secondUndo.layoutRevision,
    );
    const branchResult = await apply(
      app,
      page.id,
      "data-table",
      branchPreview,
      `branch-preset-${randomUUID()}`,
    );
    expect(branchResult.response.statusCode, branchResult.response.body).toBe(
      201,
    );
    expect((await instances(app, page.id)).map(({ state }) => state)).toEqual([
      "DISCARDED",
      "APPLIED",
    ]);
  });

  it("preserves immutable preset provenance through export, import, and clone with full ID remap", async () => {
    const current = fixture();
    const app = server(current);
    const { project, page, projectRevision } = await createProjectAndPage(app);
    const candidate = await preview(
      app,
      page.id,
      "distribution-analysis",
      projectRevision,
    );
    const result = await apply(
      app,
      page.id,
      "distribution-analysis",
      candidate,
      `export-preset-${randomUUID()}`,
    );
    expect(result.response.statusCode, result.response.body).toBe(201);
    const source = result.response.json() as ApplyLayoutPresetDto;
    const exportResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/export`,
    });
    expect(exportResponse.statusCode, exportResponse.body).toBe(200);
    const exportDto = (
      exportResponse.json() as { export: Record<string, unknown> }
    ).export as {
      manifest: {
        layoutPresetInstances: {
          schemaVersion: number;
          instances: LayoutPresetInstanceDto[];
        };
      };
    } & Record<string, unknown>;
    expect(exportDto.manifest.layoutPresetInstances).toMatchObject({
      schemaVersion: 1,
      instances: [{ id: source.instance.id }],
    });

    const importResponse = await app.inject({
      method: "POST",
      url: "/api/v1/projects/import",
      payload: {
        export: exportDto,
        name: "Imported Preset",
        slug: `imported-preset-${randomUUID().slice(0, 8)}`,
      },
    });
    expect(importResponse.statusCode, importResponse.body).toBe(201);
    const importedProject = (importResponse.json() as { project: Project })
      .project;
    const importedPagesResponse = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${importedProject.id}/pages`,
    });
    const importedPage = (
      importedPagesResponse.json() as { pages: readonly PageDto[] }
    ).pages[0] as PageDto;
    const imported = (
      await instances(app, importedPage.id)
    )[0] as LayoutPresetInstanceDto;
    expect(imported).toMatchObject({
      presetId: source.instance.presetId,
      presetVersion: source.instance.presetVersion,
      presetSnapshot: source.instance.presetSnapshot,
      registryChecksum: source.instance.registryChecksum,
      state: "APPLIED",
      origin: "IMPORT",
      commandId: null,
    });
    expect(imported.id).not.toBe(source.instance.id);
    expect(imported.projectId).toBe(importedProject.id);
    expect(imported.pageId).toBe(importedPage.id);
    expect(imported.coordinateChecksum).not.toBe(source.coordinateChecksum);
    expect(
      new Set(imported.elements.map(({ elementId }) => elementId)),
    ).not.toEqual(new Set(source.createdElementIds));
    expect(
      imported.bindingPlaceholders.map(({ templateId, portId, status }) => ({
        templateId,
        portId,
        status,
      })),
    ).toEqual(
      source.bindingPlaceholders.map(({ templateId, portId, status }) => ({
        templateId,
        portId,
        status,
      })),
    );

    const cloneResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/clone`,
      payload: {
        name: "Cloned Preset",
        slug: `cloned-preset-${randomUUID().slice(0, 8)}`,
      },
    });
    expect(cloneResponse.statusCode, cloneResponse.body).toBe(201);
    const cloneProject = (cloneResponse.json() as { project: Project }).project;
    const clonePages = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${cloneProject.id}/pages`,
    });
    const clonePage = (clonePages.json() as { pages: readonly PageDto[] })
      .pages[0] as PageDto;
    expect((await instances(app, clonePage.id))[0]).toMatchObject({
      presetSnapshot: source.instance.presetSnapshot,
      origin: "IMPORT",
      commandId: null,
    });

    for (const mutate of [
      (instance: LayoutPresetInstanceDto) => {
        (
          instance.bindingPlaceholders as LayoutPresetInstanceDto["bindingPlaceholders"] &
            unknown[]
        ).pop();
      },
      (instance: LayoutPresetInstanceDto) => {
        (instance as { coordinateChecksum: string }).coordinateChecksum =
          "0".repeat(64);
      },
      (instance: LayoutPresetInstanceDto) => {
        const schema = instance.presetSnapshot.suggestedSchema;
        if (schema === null) {
          (
            instance.presetSnapshot as { suggestedSchema: unknown }
          ).suggestedSchema = {
            id: "invalid",
            label: "Invalid",
            tables: [
              {
                templateId: "duplicate",
                displayName: "A",
                fields: [
                  {
                    templateId: "field",
                    displayName: "Field",
                    dataType: "TEXT",
                    nullable: false,
                  },
                ],
              },
              {
                templateId: "duplicate",
                displayName: "B",
                fields: [
                  {
                    templateId: "field",
                    displayName: "Field",
                    dataType: "TEXT",
                    nullable: false,
                  },
                ],
              },
            ],
          };
        }
      },
    ]) {
      const malformed = structuredClone(exportDto);
      mutate(
        malformed.manifest.layoutPresetInstances
          .instances[0] as LayoutPresetInstanceDto,
      );
      const rejected = await app.inject({
        method: "POST",
        url: "/api/v1/projects/import",
        payload: {
          export: malformed,
          name: "Rejected Preset",
          slug: `rejected-preset-${randomUUID().slice(0, 8)}`,
        },
      });
      expect(rejected.statusCode, rejected.body).toBe(400);
    }
  });

  it("keeps statistical Layout Preset edits in Draft and Published Runtime immutable until republish", async () => {
    const current = fixture();
    const app = server(current);
    const { project, page, projectRevision } = await createProjectAndPage(app);
    const candidate = await preview(
      app,
      page.id,
      "distribution-analysis",
      projectRevision,
    );
    const result = await apply(
      app,
      page.id,
      "distribution-analysis",
      candidate,
      `runtime-preset-${randomUUID()}`,
    );
    expect(result.response.statusCode, result.response.body).toBe(201);
    const draft = result.response.json() as ApplyLayoutPresetDto;
    const unpublishedRuntime = await app.inject({
      method: "GET",
      url: `/api/v1/runtime/${project.id}/pages/${page.id}`,
    });
    expect(unpublishedRuntime.statusCode).toBe(404);
    const publishedResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/publish`,
      payload: {
        expectedProjectRevision: draft.projectRevision,
        idempotencyKey: `publish-preset-${randomUUID()}`,
      },
    });
    expect(publishedResponse.statusCode, publishedResponse.body).toBe(200);
    const published = publishedResponse.json() as {
      readonly projectRevision: number;
      readonly versionId: string;
    };
    const runtimeResponse = await app.inject({
      method: "GET",
      url: `/api/v1/runtime/${project.id}/pages/${page.id}`,
    });
    expect(runtimeResponse.statusCode, runtimeResponse.body).toBe(200);
    const runtimeSnapshot = runtimeResponse.json();
    expect(runtimeSnapshot).toMatchObject({
      versionId: published.versionId,
      elements: expect.arrayContaining([
        expect.objectContaining({
          element: expect.objectContaining({ type: "histogram" }),
        }),
      ]),
    });
    const laterPreview = await preview(
      app,
      page.id,
      "blank-grid",
      published.projectRevision,
      draft.layoutRevision,
    );
    const later = await apply(
      app,
      page.id,
      "blank-grid",
      laterPreview,
      `later-draft-preset-${randomUUID()}`,
    );
    expect(later.response.statusCode, later.response.body).toBe(201);
    const laterDraft = later.response.json() as ApplyLayoutPresetDto;
    const runtimeAfterDraftChange = await app.inject({
      method: "GET",
      url: `/api/v1/runtime/${project.id}/pages/${page.id}`,
    });
    expect(runtimeAfterDraftChange.json()).toEqual(runtimeSnapshot);
    const republishResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/publish`,
      payload: {
        expectedProjectRevision: laterDraft.projectRevision,
        idempotencyKey: `republish-preset-${randomUUID()}`,
      },
    });
    expect(republishResponse.statusCode, republishResponse.body).toBe(200);
    const republished = republishResponse.json() as { versionId: string };
    expect(republished.versionId).not.toBe(published.versionId);
    const runtimeAfterRepublish = await app.inject({
      method: "GET",
      url: `/api/v1/runtime/${project.id}/pages/${page.id}`,
    });
    expect(runtimeAfterRepublish.json()).toMatchObject({
      versionId: republished.versionId,
      elements: expect.arrayContaining([
        expect.objectContaining({
          element: expect.objectContaining({ type: "histogram" }),
        }),
        expect.objectContaining({
          element: expect.objectContaining({ type: "data-table" }),
        }),
      ]),
    });
  });

  it("preserves preset ownership through trash and restore, then cascades every row on purge", async () => {
    const current = fixture();
    const app = server(current);
    const { project, page, projectRevision } = await createProjectAndPage(app);
    const candidate = await preview(
      app,
      page.id,
      "trend-analysis",
      projectRevision,
    );
    const result = await apply(
      app,
      page.id,
      "trend-analysis",
      candidate,
      `lifecycle-preset-${randomUUID()}`,
    );
    expect(result.response.statusCode, result.response.body).toBe(201);
    const applied = result.response.json() as ApplyLayoutPresetDto;
    const beforeTrash = await instances(app, page.id);
    const trashResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/trash`,
      payload: {
        expectedRevision: applied.projectRevision,
        expectedLifecycleRevision: project.lifecycleRevision,
        idempotencyKey: `trash-preset-${randomUUID()}`,
      },
    });
    expect(trashResponse.statusCode, trashResponse.body).toBe(200);
    const trashed = (trashResponse.json() as { project: Project }).project;
    const restoreResponse = await app.inject({
      method: "POST",
      url: `/api/v1/recycle-bin/projects/${project.id}/restore`,
      payload: {
        expectedLifecycleRevision: trashed.lifecycleRevision,
        idempotencyKey: `restore-preset-${randomUUID()}`,
        conflictResolution: "KEEP_ORIGINAL",
      },
    });
    expect(restoreResponse.statusCode, restoreResponse.body).toBe(200);
    const restored = (restoreResponse.json() as { project: Project }).project;
    expect(await instances(app, page.id)).toEqual(beforeTrash);

    const retrashResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/trash`,
      payload: {
        expectedRevision: restored.revision,
        expectedLifecycleRevision: restored.lifecycleRevision,
        idempotencyKey: `retrash-preset-${randomUUID()}`,
      },
    });
    expect(retrashResponse.statusCode, retrashResponse.body).toBe(200);
    const retrash = (retrashResponse.json() as { project: Project }).project;
    const planResponse = await app.inject({
      method: "POST",
      url: `/api/v1/recycle-bin/projects/${project.id}/purge-plan`,
      payload: { expectedLifecycleRevision: retrash.lifecycleRevision },
    });
    expect(planResponse.statusCode, planResponse.body).toBe(200);
    const plan = (
      planResponse.json() as {
        plan: { purgePlanId: string; typedConfirmation: string };
      }
    ).plan;
    const purgeResponse = await app.inject({
      method: "DELETE",
      url: `/api/v1/recycle-bin/projects/${project.id}`,
      payload: {
        purgePlanId: plan.purgePlanId,
        expectedLifecycleRevision: retrash.lifecycleRevision,
        typedConfirmation: plan.typedConfirmation,
        idempotencyKey: `purge-preset-${randomUUID()}`,
        backupBeforePurge: false,
      },
    });
    expect(purgeResponse.statusCode, purgeResponse.body).toBe(200);
    const database = new Database(current.databasePath, { readonly: true });
    expect(
      database
        .prepare(
          `SELECT
             (SELECT count(*) FROM layout_preset_instances WHERE project_id = ?) AS instances,
             (SELECT count(*) FROM layout_preset_instance_elements WHERE project_id = ?) AS memberships,
             (SELECT count(*) FROM element_binding_placeholders WHERE project_id = ?) AS placeholders`,
        )
        .get(project.id, project.id, project.id),
    ).toEqual({ instances: 0, memberships: 0, placeholders: 0 });
    database.close();
  });

  it("rolls back atomically and fails readiness on missing or extra placeholder topology", async () => {
    const current = fixture();
    let fail = true;
    const app = server(current, { failPreset: () => fail });
    const { page, projectRevision } = await createProjectAndPage(app);
    const candidate = await preview(
      app,
      page.id,
      "blank-grid",
      projectRevision,
    );
    const key = `rollback-preset-${randomUUID()}`;
    const failed = await apply(app, page.id, "blank-grid", candidate, key);
    expect(failed.response.statusCode, failed.response.body).toBe(500);
    let database = new Database(current.databasePath, { readonly: true });
    expect(
      database
        .prepare(
          `SELECT
             (SELECT count(*) FROM elements) AS elements,
             (SELECT count(*) FROM element_commands WHERE command_type = 'PRESET_APPLY') AS commands,
             (SELECT count(*) FROM layout_preset_instances) AS instances`,
        )
        .get(),
    ).toEqual({ elements: 0, commands: 0, instances: 0 });
    database.close();
    fail = false;
    const retried = await app.inject({
      method: "POST",
      url: `/api/v1/pages/${page.id}/layout-presets/blank-grid/apply`,
      payload: failed.request,
    });
    expect(retried.statusCode, retried.body).toBe(201);
    await close(app);

    database = new Database(current.databasePath);
    const placeholder = database
      .prepare("SELECT * FROM element_binding_placeholders LIMIT 1")
      .get() as Record<string, unknown>;
    database
      .prepare(
        "DELETE FROM element_binding_placeholders WHERE element_id = ? AND port_id = ?",
      )
      .run(placeholder.element_id, placeholder.port_id);
    database.close();
    expect(() =>
      buildServer({
        metadataDatabasePath: current.databasePath,
        storageRoot: current.storageRoot,
      }),
    ).toThrow("placeholder topology");

    database = new Database(current.databasePath);
    database
      .prepare(
        `INSERT INTO element_binding_placeholders (
           element_id, project_id, page_id, element_type_version, port_id,
           instance_id, template_id, status, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        placeholder.element_id,
        placeholder.project_id,
        placeholder.page_id,
        placeholder.element_type_version,
        placeholder.port_id,
        placeholder.instance_id,
        placeholder.template_id,
        placeholder.status,
        placeholder.created_at,
      );
    database
      .prepare(
        `INSERT INTO element_binding_placeholders (
           element_id, project_id, page_id, element_type_version, port_id,
           instance_id, template_id, status, created_at
         ) VALUES (?, ?, ?, ?, 'unexpected-port', ?, ?, 'UNCONNECTED', ?)`,
      )
      .run(
        placeholder.element_id,
        placeholder.project_id,
        placeholder.page_id,
        placeholder.element_type_version,
        placeholder.instance_id,
        placeholder.template_id,
        placeholder.created_at,
      );
    database.close();
    expect(() =>
      buildServer({
        metadataDatabasePath: current.databasePath,
        storageRoot: current.storageRoot,
      }),
    ).toThrow("placeholder topology");
  });
});
