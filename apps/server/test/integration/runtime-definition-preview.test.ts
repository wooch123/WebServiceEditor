import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  DraftPreviewDto,
  DraftRuntimeNavigationDto,
  PageDto,
  ProjectDefinitionSnapshotDto,
  RuntimeNavigationDto,
} from "@webeditor/domain";
import Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { buildServer } from "../../src/app.js";

const applications: FastifyInstance[] = [];
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(applications.splice(0).map(async (app) => app.close()));
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("Phase 12 Project Definition Runtime and Draft Preview", () => {
  it("keeps Published navigation immutable while Draft Preview is bounded, expiring, and write-free", async () => {
    let now = Date.parse("2026-08-16T00:00:00.000Z");
    const directory = mkdtempSync(join(tmpdir(), "webeditor-phase12-"));
    directories.push(directory);
    const databasePath = join(directory, "metadata", "webeditor.sqlite");
    const app = buildServer({
      metadataDatabasePath: databasePath,
      storageRoot: join(directory, "projects"),
      clock: () => new Date(now),
    });
    applications.push(app);

    const projectResponse = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      payload: {
        name: "Runtime Snapshot",
        slug: `runtime-snapshot-${randomUUID().slice(0, 8)}`,
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
        name: "게시 이름",
        pageType: "blank",
        expectedProjectRevision: project.revision,
        idempotencyKey: `page-${randomUUID()}`,
      },
    });
    expect(pageResponse.statusCode, pageResponse.body).toBe(201);
    const created = pageResponse.json() as {
      page: PageDto;
      projectRevision: number;
    };
    const elementResponse = await app.inject({
      method: "POST",
      url: `/api/v1/pages/${created.page.id}/elements`,
      payload: {
        elementType: "text",
        expectedLayoutRevision: 0,
        expectedProjectRevision: created.projectRevision,
        idempotencyKey: `element-${randomUUID()}`,
      },
    });
    expect(elementResponse.statusCode, elementResponse.body).toBe(201);
    const elementProjectRevision = (
      elementResponse.json() as { projectRevision: number }
    ).projectRevision;
    const publishResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/publish`,
      payload: {
        expectedProjectRevision: elementProjectRevision,
        idempotencyKey: `publish-${randomUUID()}`,
      },
    });
    expect(publishResponse.statusCode, publishResponse.body).toBe(200);
    const publishedRevision = (
      publishResponse.json() as { projectRevision: number }
    ).projectRevision;

    const database = new Database(databasePath);
    const version = database
      .prepare(
        "SELECT id, snapshot_json FROM project_versions WHERE project_id = ? ORDER BY sequence DESC LIMIT 1",
      )
      .get(project.id) as { id: string; snapshot_json: string };
    const snapshot = JSON.parse(
      version.snapshot_json,
    ) as ProjectDefinitionSnapshotDto;
    expect(snapshot).toMatchObject({
      definitionSchemaVersion: 1,
      projectId: project.id,
      sourceProjectRevision: publishedRevision,
      themeId: "light-clean-paper",
    });
    expect(snapshot.registryChecksum).toMatch(/^[0-9a-f]{64}$/u);
    expect(snapshot.pages).toHaveLength(1);
    expect(snapshot.elements).toHaveLength(1);
    expect(snapshot.bindings).toEqual([]);
    expect(snapshot.dataSchema).toMatchObject({
      schemaVersion: 1,
      tables: [],
      relations: [],
    });

    const patchResponse = await app.inject({
      method: "PATCH",
      url: `/api/v1/pages/${created.page.id}`,
      payload: {
        expectedRevision: created.page.revision,
        expectedProjectRevision: publishedRevision,
        name: "초안 이름",
        route: created.page.route,
        navigationVisible: true,
        navigationGroup: null,
      },
    });
    expect(patchResponse.statusCode, patchResponse.body).toBe(200);
    const draftRevision = (patchResponse.json() as { projectRevision: number })
      .projectRevision;
    const beforePreview = database
      .prepare("SELECT revision, updated_at FROM projects WHERE id = ?")
      .get(project.id);
    const beforeCounts = database
      .prepare(
        `SELECT
           (SELECT count(*) FROM project_versions WHERE project_id = ?) versions,
           (SELECT count(*) FROM audit_logs WHERE project_id = ?) audits`,
      )
      .get(project.id, project.id);

    const previewResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/draft-previews`,
      payload: { expectedProjectRevision: draftRevision },
    });
    expect(previewResponse.statusCode, previewResponse.body).toBe(201);
    const preview = previewResponse.json() as DraftPreviewDto;
    expect(preview.definitionChecksum).toMatch(/^[0-9a-f]{64}$/u);
    expect(preview.defaultRoute).toBe(created.page.route);

    const publishedNavigationResponse = await app.inject({
      method: "GET",
      url: `/api/v1/runtime/${project.id}/navigation`,
    });
    expect(
      (publishedNavigationResponse.json() as RuntimeNavigationDto).pages[0]
        ?.name,
    ).toBe("게시 이름");
    const draftNavigationResponse = await app.inject({
      method: "GET",
      url: `/api/v1/draft-previews/${preview.previewId}/navigation`,
    });
    expect(
      draftNavigationResponse.statusCode,
      draftNavigationResponse.body,
    ).toBe(200);
    const draftNavigation =
      draftNavigationResponse.json() as DraftRuntimeNavigationDto;
    expect(draftNavigation.pages[0]?.name).toBe("초안 이름");
    expect(draftNavigation.snapshotId).toBe(preview.previewId);
    expect(draftNavigation.definitionChecksum).toBe(preview.definitionChecksum);
    expect(
      database
        .prepare("SELECT revision, updated_at FROM projects WHERE id = ?")
        .get(project.id),
    ).toEqual(beforePreview);
    expect(
      database
        .prepare(
          `SELECT
             (SELECT count(*) FROM project_versions WHERE project_id = ?) versions,
             (SELECT count(*) FROM audit_logs WHERE project_id = ?) audits`,
        )
        .get(project.id, project.id),
    ).toEqual(beforeCounts);

    const exportResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/export`,
    });
    expect(exportResponse.statusCode, exportResponse.body).toBe(200);
    const exported = exportResponse.json() as {
      export: {
        manifest: {
          publishedVersions: readonly {
            definitionSchemaVersion: number;
            themeId: string;
            registryChecksum: string;
            bindings: readonly unknown[];
            dataSchema: { schemaVersion: number };
          }[];
        };
      };
    };
    expect(exported.export.manifest.publishedVersions[0]).toMatchObject({
      definitionSchemaVersion: 1,
      themeId: "light-clean-paper",
      registryChecksum: snapshot.registryChecksum,
      bindings: [],
      dataSchema: { schemaVersion: 1 },
    });
    const importResponse = await app.inject({
      method: "POST",
      url: "/api/v1/projects/import",
      payload: {
        export: exportResponse.json().export,
        name: "Runtime Snapshot Import",
        slug: `runtime-snapshot-import-${randomUUID().slice(0, 8)}`,
      },
    });
    expect(importResponse.statusCode, importResponse.body).toBe(201);
    const importedProjectId = (
      importResponse.json() as { project: { id: string } }
    ).project.id;
    const importedNavigation = await app.inject({
      method: "GET",
      url: `/api/v1/runtime/${importedProjectId}/navigation`,
    });
    expect(importedNavigation.statusCode, importedNavigation.body).toBe(200);
    const importedNavigationBody =
      importedNavigation.json() as RuntimeNavigationDto;
    expect(importedNavigationBody.projectId).toBe(importedProjectId);
    expect(importedNavigationBody.pages[0]?.name).toBe("게시 이름");

    now += 5 * 60 * 1000;
    const expired = await app.inject({
      method: "GET",
      url: `/api/v1/draft-previews/${preview.previewId}/navigation`,
    });
    expect(expired.statusCode, expired.body).toBe(404);
    expect(expired.json()).toMatchObject({
      error: { code: "DRAFT_PREVIEW_NOT_FOUND" },
    });
    database.close();
  });
});
