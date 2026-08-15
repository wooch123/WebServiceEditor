import { randomUUID } from "node:crypto";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { PageDto } from "@webeditor/domain";
import Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { buildServer } from "../../src/app.js";

interface Fixture {
  readonly directory: string;
  readonly databasePath: string;
  readonly storageRoot: string;
}

interface ProjectDto {
  readonly id: string;
  readonly name: string;
  readonly revision: number;
  readonly lifecycleRevision: number;
  readonly pageCount: number;
}

interface PageMutationResponse {
  readonly page: PageDto;
  readonly projectRevision: number;
}

const directories: string[] = [];
const openApps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(openApps.splice(0).map(async (app) => app.close()));
  for (const directory of directories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function fixture(): Fixture {
  const directory = mkdtempSync(join(tmpdir(), "webeditor-pages-"));
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
  openApps.push(app);
  return app;
}

async function close(app: FastifyInstance): Promise<void> {
  const index = openApps.indexOf(app);
  if (index >= 0) openApps.splice(index, 1);
  await app.close();
}

async function createProject(
  app: FastifyInstance,
  name = "Page Project",
  slug = `page-project-${randomUUID().slice(0, 8)}`,
): Promise<ProjectDto> {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/projects",
    payload: { name, slug },
  });
  expect(response.statusCode, response.body).toBe(201);
  return (response.json() as { project: ProjectDto }).project;
}

async function createPage(
  app: FastifyInstance,
  projectId: string,
  expectedProjectRevision: number,
  name: string,
  idempotencyKey = `page-create-${randomUUID()}`,
): Promise<PageMutationResponse> {
  const response = await app.inject({
    method: "POST",
    url: `/api/v1/projects/${projectId}/pages`,
    payload: {
      name,
      pageType: "blank",
      expectedProjectRevision,
      idempotencyKey,
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json() as PageMutationResponse;
}

async function listPages(app: FastifyInstance, projectId: string) {
  const response = await app.inject({
    method: "GET",
    url: `/api/v1/projects/${projectId}/pages`,
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json() as {
    readonly pages: readonly PageDto[];
    readonly projectRevision: number;
    readonly publishedVersionId: string | null;
  };
}

describe("page management and published navigation", () => {
  it("validates page metadata, persists optimistic edits and exposes the complete icon catalog", async () => {
    const current = fixture();
    let app = server(current);
    const project = await createProject(app);

    for (const name of ["", "x".repeat(100)]) {
      const invalid = await app.inject({
        method: "POST",
        url: `/api/v1/projects/${project.id}/pages`,
        payload: {
          name,
          pageType: "blank",
          expectedProjectRevision: 1,
          idempotencyKey: `invalid-${name.length}-${randomUUID()}`,
        },
      });
      expect(invalid.statusCode).toBe(400);
      expect(invalid.json()).toMatchObject({
        error: { code: "INVALID_PAGE_NAME" },
      });
    }

    const key = `page-create-${randomUUID()}`;
    const created = await createPage(app, project.id, 1, "x".repeat(99), key);
    expect(created).toMatchObject({
      page: {
        projectId: project.id,
        revision: 1,
        pageType: "blank",
        iconName: "File",
        iconCatalogVersion: "1.31.0",
        navigationVisible: true,
        navigationGroup: null,
        sortOrder: 0,
        deletedAt: null,
      },
      projectRevision: 2,
    });

    const replay = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/pages`,
      payload: {
        name: "x".repeat(99),
        pageType: "blank",
        expectedProjectRevision: 1,
        idempotencyKey: key,
      },
    });
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toEqual(created);

    const payloadConflict = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/pages`,
      payload: {
        name: "Different",
        pageType: "blank",
        expectedProjectRevision: 1,
        idempotencyKey: key,
      },
    });
    expect(payloadConflict.statusCode).toBe(409);
    expect(payloadConflict.json()).toMatchObject({
      error: { code: "IDEMPOTENCY_PAYLOAD_CONFLICT" },
    });

    const patched = await app.inject({
      method: "PATCH",
      url: `/api/v1/pages/${created.page.id}`,
      payload: {
        expectedRevision: 1,
        expectedProjectRevision: 2,
        name: "Daily Report",
        route: "/reports/2026/daily",
        navigationVisible: false,
        navigationGroup: "Reports",
      },
    });
    expect(patched.statusCode, patched.body).toBe(200);
    const patchedBody = patched.json() as PageMutationResponse;
    expect(patchedBody).toMatchObject({
      page: {
        revision: 2,
        name: "Daily Report",
        route: "/reports/2026/daily",
        navigationVisible: false,
        navigationGroup: "Reports",
      },
      projectRevision: 3,
    });

    const stale = await app.inject({
      method: "PATCH",
      url: `/api/v1/pages/${created.page.id}`,
      payload: {
        expectedRevision: 1,
        expectedProjectRevision: 3,
        name: "Stale",
      },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({
      error: {
        code: "PAGE_REVISION_CONFLICT",
        details: { latest: { revision: 2 }, projectRevision: 3 },
      },
    });

    const catalog = await app.inject({
      method: "GET",
      url: "/api/v1/ui/icons?query=layout%20dashboard",
    });
    expect(catalog.statusCode).toBe(200);
    const catalogBody = catalog.json() as {
      readonly items: readonly {
        readonly name: string;
        readonly dynamicName: string;
        readonly categories: readonly string[];
        readonly keywords: readonly string[];
      }[];
      readonly categories: readonly string[];
      readonly nextCursor: string | null;
    };
    expect(catalogBody.items).toContainEqual(
      expect.objectContaining({
        name: "LayoutDashboard",
        dynamicName: "layout-dashboard",
      }),
    );
    expect(catalogBody.categories).toEqual(
      expect.arrayContaining(["arrows", "charts", "files", "layout"]),
    );
    const iconDetail = await app.inject({
      method: "GET",
      url: "/api/v1/ui/icons/LayoutDashboard",
    });
    expect(iconDetail.statusCode).toBe(200);
    expect(iconDetail.json()).toMatchObject({
      item: { name: "LayoutDashboard", dynamicName: "layout-dashboard" },
    });
    const allIconNames = new Set<string>();
    let cursor: string | null = null;
    for (let page = 0; page < 40; page += 1) {
      const pageResponse = await app.inject({
        method: "GET",
        url: `/api/v1/ui/icons${cursor === null ? "" : `?cursor=${encodeURIComponent(cursor)}`}`,
      });
      expect(pageResponse.statusCode, pageResponse.body).toBe(200);
      const pageBody = pageResponse.json() as {
        readonly items: readonly { readonly name: string }[];
        readonly nextCursor: string | null;
      };
      for (const item of pageBody.items) allIconNames.add(item.name);
      cursor = pageBody.nextCursor;
      if (cursor === null) break;
    }
    expect(cursor).toBeNull();
    expect(allIconNames.size).toBe(1_767);

    const invalidIcon = await app.inject({
      method: "PATCH",
      url: `/api/v1/pages/${created.page.id}/icon`,
      payload: {
        iconName: "NotARealLucideIcon",
        iconCatalogVersion: "1.31.0",
        expectedRevision: 2,
        expectedProjectRevision: 3,
      },
    });
    expect(invalidIcon.statusCode).toBe(404);
    expect(invalidIcon.json()).toMatchObject({
      error: { code: "ICON_NOT_FOUND" },
    });
    const iconPatched = await app.inject({
      method: "PATCH",
      url: `/api/v1/pages/${created.page.id}/icon`,
      payload: {
        iconName: "LayoutDashboard",
        iconCatalogVersion: "1.31.0",
        expectedRevision: 2,
        expectedProjectRevision: 3,
      },
    });
    expect(iconPatched.statusCode, iconPatched.body).toBe(200);
    expect(iconPatched.json()).toMatchObject({
      page: { iconName: "LayoutDashboard", revision: 3 },
      projectRevision: 4,
    });

    await close(app);
    app = server(current);
    const afterRestart = await listPages(app, project.id);
    expect(afterRestart).toMatchObject({
      projectRevision: 4,
      pages: [
        {
          id: created.page.id,
          route: "/reports/2026/daily",
          iconName: "LayoutDashboard",
        },
      ],
    });
    const projectAfterRestart = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${project.id}`,
    });
    expect(projectAfterRestart.json()).toMatchObject({
      project: { pageCount: 1, counts: { pages: 1 } },
    });
  });

  it("reorders one exact active-ID permutation atomically under unique constraints", async () => {
    const current = fixture();
    const app = server(current);
    const project = await createProject(app);
    const first = await createPage(app, project.id, 1, "First");
    const second = await createPage(
      app,
      project.id,
      first.projectRevision,
      "Second",
    );
    const third = await createPage(
      app,
      project.id,
      second.projectRevision,
      "Third",
    );
    const ids = [first.page.id, second.page.id, third.page.id];

    for (const pageIds of [
      [ids[0], ids[0], ids[2]],
      [ids[0], ids[1]],
      [ids[0], ids[1], randomUUID()],
    ]) {
      const invalid = await app.inject({
        method: "POST",
        url: `/api/v1/projects/${project.id}/pages/reorder`,
        payload: {
          pageIds,
          expectedProjectRevision: third.projectRevision,
          idempotencyKey: `bad-order-${randomUUID()}`,
        },
      });
      expect(invalid.statusCode).toBe(400);
      expect(invalid.json()).toMatchObject({
        error: { code: "INVALID_PAGE_REORDER" },
      });
      expect(
        (await listPages(app, project.id)).pages.map((page) => page.id),
      ).toEqual(ids);
    }

    const key = `reorder-${randomUUID()}`;
    const order = [third.page.id, first.page.id, second.page.id];
    const reordered = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/pages/reorder`,
      payload: {
        pageIds: order,
        expectedProjectRevision: third.projectRevision,
        idempotencyKey: key,
      },
    });
    expect(reordered.statusCode, reordered.body).toBe(200);
    const reorderedBody = reordered.json() as {
      readonly pages: readonly PageDto[];
      readonly projectRevision: number;
    };
    expect(reorderedBody.pages.map((page) => page.id)).toEqual(order);
    expect(reorderedBody.pages.map((page) => page.sortOrder)).toEqual([
      0, 1, 2,
    ]);

    const replay = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/pages/reorder`,
      payload: {
        pageIds: order,
        expectedProjectRevision: third.projectRevision,
        idempotencyKey: key,
      },
    });
    expect(replay.json()).toEqual(reorderedBody);
    const conflict = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/pages/reorder`,
      payload: {
        pageIds: [...order].reverse(),
        expectedProjectRevision: third.projectRevision,
        idempotencyKey: key,
      },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({
      error: { code: "IDEMPOTENCY_PAYLOAD_CONFLICT" },
    });

    const stale = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/pages/reorder`,
      payload: {
        pageIds: [...order].reverse(),
        expectedProjectRevision: third.projectRevision,
        idempotencyKey: `stale-order-${randomUUID()}`,
      },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({
      error: { code: "PROJECT_REVISION_CONFLICT" },
    });
    expect(
      (await listPages(app, project.id)).pages.map((page) => page.id),
    ).toEqual(order);

    const database = new Database(current.databasePath);
    try {
      expect(
        database
          .prepare(
            `SELECT name FROM sqlite_master
             WHERE type = 'index' AND name IN (
               'pages_active_route_unique_idx',
               'pages_active_sort_order_unique_idx'
             ) ORDER BY name`,
          )
          .all(),
      ).toEqual([
        { name: "pages_active_route_unique_idx" },
        { name: "pages_active_sort_order_unique_idx" },
      ]);
      expect(() =>
        database
          .prepare(
            `INSERT INTO pages (
              id, project_id, name, route, page_type, icon_name,
              icon_catalog_version, sort_order, created_at, updated_at
            ) VALUES (?, ?, ?, ?, 'blank', 'File', '1.31.0', ?, ?, ?)`,
          )
          .run(
            randomUUID(),
            project.id,
            "Duplicate route",
            reorderedBody.pages[0]?.route,
            50,
            "2026-08-15T00:00:00.000Z",
            "2026-08-15T00:00:00.000Z",
          ),
      ).toThrow();
      expect(() =>
        database
          .prepare(
            `INSERT INTO pages (
              id, project_id, name, route, page_type, icon_name,
              icon_catalog_version, sort_order, created_at, updated_at
            ) VALUES (?, ?, ?, ?, 'blank', 'File', '1.31.0', 0, ?, ?)`,
          )
          .run(
            randomUUID(),
            project.id,
            "Duplicate order",
            "/unique-route",
            "2026-08-15T00:00:00.000Z",
            "2026-08-15T00:00:00.000Z",
          ),
      ).toThrow();
    } finally {
      database.close();
    }
  });

  it("plans deletion without mutation and restores the same page identity and order through Undo", async () => {
    const current = fixture();
    const app = server(current);
    const project = await createProject(app);
    const first = await createPage(app, project.id, 1, "First");
    const second = await createPage(
      app,
      project.id,
      first.projectRevision,
      "Second",
    );
    const third = await createPage(
      app,
      project.id,
      second.projectRevision,
      "Third",
    );
    const iconResponse = await app.inject({
      method: "PATCH",
      url: `/api/v1/pages/${second.page.id}/icon`,
      payload: {
        iconName: "Activity",
        iconCatalogVersion: "1.31.0",
        expectedRevision: second.page.revision,
        expectedProjectRevision: third.projectRevision,
      },
    });
    const icon = iconResponse.json() as PageMutationResponse;

    const stalePlan = await app.inject({
      method: "POST",
      url: `/api/v1/pages/${second.page.id}/delete-plan`,
      payload: {
        expectedRevision: second.page.revision,
        expectedProjectRevision: icon.projectRevision,
      },
    });
    expect(stalePlan.statusCode).toBe(409);
    expect(stalePlan.json()).toMatchObject({
      error: { code: "PAGE_REVISION_CONFLICT" },
    });
    const databaseBeforePlan = new Database(current.databasePath);
    const commandsBefore = (
      databaseBeforePlan
        .prepare("SELECT count(*) AS count FROM page_commands")
        .get() as { readonly count: number }
    ).count;
    databaseBeforePlan.close();

    const plan = await app.inject({
      method: "POST",
      url: `/api/v1/pages/${second.page.id}/delete-plan`,
      payload: {
        expectedRevision: icon.page.revision,
        expectedProjectRevision: icon.projectRevision,
      },
    });
    expect(plan.statusCode).toBe(200);
    expect(plan.json()).toEqual({
      impact: {
        elementCount: 0,
        bindingCount: 0,
        navigationReferenceCount: 0,
        validationScenarioCount: 0,
        reassignNavigationToPageId: null,
      },
      allowedResolutions: ["DELETE_DEPENDENCIES"],
    });
    const databaseAfterPlan = new Database(current.databasePath);
    expect(
      (
        databaseAfterPlan
          .prepare("SELECT count(*) AS count FROM page_commands")
          .get() as { readonly count: number }
      ).count,
    ).toBe(commandsBefore);
    databaseAfterPlan.close();

    const deleteKey = `delete-page-${randomUUID()}`;
    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/v1/pages/${second.page.id}`,
      payload: {
        expectedRevision: icon.page.revision,
        expectedProjectRevision: icon.projectRevision,
        idempotencyKey: deleteKey,
        resolution: "DELETE_DEPENDENCIES",
      },
    });
    expect(deleted.statusCode, deleted.body).toBe(200);
    const deletedBody = deleted.json() as {
      readonly commandId: string;
      readonly impact: Record<string, unknown>;
      readonly projectRevision: number;
    };
    expect(deletedBody.impact).toEqual(
      (plan.json() as { impact: unknown }).impact,
    );
    expect(
      (await listPages(app, project.id)).pages.map((page) => page.id),
    ).toEqual([first.page.id, third.page.id]);
    const deleteReplay = await app.inject({
      method: "DELETE",
      url: `/api/v1/pages/${second.page.id}`,
      payload: {
        expectedRevision: icon.page.revision,
        expectedProjectRevision: icon.projectRevision,
        idempotencyKey: deleteKey,
        resolution: "DELETE_DEPENDENCIES",
      },
    });
    expect(deleteReplay.json()).toEqual(deletedBody);

    const collidingRoute = await app.inject({
      method: "PATCH",
      url: `/api/v1/pages/${third.page.id}`,
      payload: {
        expectedRevision: third.page.revision,
        expectedProjectRevision: deletedBody.projectRevision,
        route: second.page.route,
      },
    });
    expect(collidingRoute.statusCode, collidingRoute.body).toBe(200);
    const collidingRouteBody = collidingRoute.json() as PageMutationResponse;
    const undoConflict = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/pages/commands/${deletedBody.commandId}/undo`,
      payload: {
        expectedProjectRevision: collidingRouteBody.projectRevision,
        idempotencyKey: `undo-conflict-${randomUUID()}`,
      },
    });
    expect(undoConflict.statusCode).toBe(409);
    expect(undoConflict.json()).toMatchObject({
      error: { code: "PAGE_RESTORE_CONFLICT" },
    });
    const afterUndoConflict = await listPages(app, project.id);
    expect(afterUndoConflict.projectRevision).toBe(
      collidingRouteBody.projectRevision,
    );
    expect(afterUndoConflict.pages.map((page) => page.id)).toEqual([
      first.page.id,
      third.page.id,
    ]);

    const routeReleased = await app.inject({
      method: "PATCH",
      url: `/api/v1/pages/${third.page.id}`,
      payload: {
        expectedRevision: collidingRouteBody.page.revision,
        expectedProjectRevision: collidingRouteBody.projectRevision,
        route: "/third-restored",
      },
    });
    expect(routeReleased.statusCode, routeReleased.body).toBe(200);
    const routeReleasedBody = routeReleased.json() as PageMutationResponse;

    const undone = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/pages/commands/${deletedBody.commandId}/undo`,
      payload: {
        expectedProjectRevision: routeReleasedBody.projectRevision,
        idempotencyKey: `undo-page-${randomUUID()}`,
      },
    });
    expect(undone.statusCode, undone.body).toBe(200);
    const undoneBody = undone.json() as PageMutationResponse;
    expect(undoneBody.page).toMatchObject({
      id: second.page.id,
      iconName: "Activity",
      sortOrder: 1,
      deletedAt: null,
    });
    const restored = await listPages(app, project.id);
    expect(restored.pages.map((page) => page.id)).toEqual([
      first.page.id,
      second.page.id,
      third.page.id,
    ]);
    expect(restored.pages.map((page) => page.sortOrder)).toEqual([0, 1, 2]);
  });

  it("publishes immutable navigation snapshots without leaking later Draft edits", async () => {
    const current = fixture();
    let app = server(current);
    const project = await createProject(app);
    const first = await createPage(app, project.id, 1, "Overview");
    const second = await createPage(
      app,
      project.id,
      first.projectRevision,
      "Detail",
    );
    const routePatch = await app.inject({
      method: "PATCH",
      url: `/api/v1/pages/${second.page.id}`,
      payload: {
        expectedRevision: second.page.revision,
        expectedProjectRevision: second.projectRevision,
        route: "/reports/deep/detail",
        navigationVisible: false,
      },
    });
    const routePatched = routePatch.json() as PageMutationResponse;

    const hideFirst = await app.inject({
      method: "PATCH",
      url: `/api/v1/pages/${first.page.id}`,
      payload: {
        expectedRevision: first.page.revision,
        expectedProjectRevision: routePatched.projectRevision,
        navigationVisible: false,
      },
    });
    expect(hideFirst.statusCode, hideFirst.body).toBe(200);
    const hiddenFirst = hideFirst.json() as PageMutationResponse;

    const blockedPlan = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/publish/plan`,
      payload: { expectedProjectRevision: hiddenFirst.projectRevision },
    });
    expect(blockedPlan.statusCode).toBe(200);
    expect(blockedPlan.json()).toMatchObject({
      plan: {
        projectRevision: hiddenFirst.projectRevision,
        errors: ["ALL_NAVIGATION_HIDDEN"],
        warnings: [],
      },
    });
    const blockedPublish = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/publish`,
      payload: {
        expectedProjectRevision: hiddenFirst.projectRevision,
        idempotencyKey: `blocked-publish-${randomUUID()}`,
      },
    });
    expect(blockedPublish.statusCode).toBe(422);
    expect(blockedPublish.json()).toMatchObject({
      error: {
        code: "PUBLISH_ALL_NAVIGATION_HIDDEN",
        details: { errors: ["ALL_NAVIGATION_HIDDEN"] },
      },
    });
    const blockedDatabase = new Database(current.databasePath);
    expect(
      blockedDatabase
        .prepare("SELECT revision, status FROM projects WHERE id = ?")
        .get(project.id),
    ).toEqual({ revision: hiddenFirst.projectRevision, status: "DRAFT" });
    expect(
      (
        blockedDatabase
          .prepare(
            "SELECT count(*) AS count FROM project_versions WHERE project_id = ?",
          )
          .get(project.id) as { readonly count: number }
      ).count,
    ).toBe(0);
    blockedDatabase.close();

    const showFirst = await app.inject({
      method: "PATCH",
      url: `/api/v1/pages/${first.page.id}`,
      payload: {
        expectedRevision: hiddenFirst.page.revision,
        expectedProjectRevision: hiddenFirst.projectRevision,
        navigationVisible: true,
      },
    });
    expect(showFirst.statusCode, showFirst.body).toBe(200);
    const visibleFirst = showFirst.json() as PageMutationResponse;

    const plan = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/publish/plan`,
      payload: { expectedProjectRevision: visibleFirst.projectRevision },
    });
    expect(plan.statusCode).toBe(200);
    expect(plan.json()).toMatchObject({
      plan: {
        projectId: project.id,
        pages: [
          {
            id: first.page.id,
            name: "Overview",
            sortOrder: 0,
            navigationVisible: true,
          },
          {
            id: second.page.id,
            name: "Detail",
            route: "/reports/deep/detail",
            sortOrder: 1,
            navigationVisible: false,
          },
        ],
        errors: [],
      },
    });
    const published = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/publish`,
      payload: {
        expectedProjectRevision: visibleFirst.projectRevision,
        idempotencyKey: `publish-${randomUUID()}`,
      },
    });
    expect(published.statusCode, published.body).toBe(200);
    const publishedBody = published.json() as {
      readonly versionId: string;
      readonly publishedAt: string;
      readonly projectRevision: number;
    };
    const runtime = await app.inject({
      method: "GET",
      url: `/api/v1/runtime/${project.id}/navigation`,
    });
    expect(runtime.json()).toMatchObject({
      projectId: project.id,
      versionId: publishedBody.versionId,
      pages: [
        { id: first.page.id, name: "Overview" },
        { id: second.page.id, name: "Detail", route: "/reports/deep/detail" },
      ],
    });

    const database = new Database(current.databasePath);
    expect(() =>
      database
        .prepare(
          "UPDATE project_versions SET snapshot_json = '{}' WHERE id = ?",
        )
        .run(publishedBody.versionId),
    ).toThrow("project_versions are immutable");
    database.close();

    const renamed = await app.inject({
      method: "PATCH",
      url: `/api/v1/pages/${first.page.id}`,
      payload: {
        expectedRevision: visibleFirst.page.revision,
        expectedProjectRevision: publishedBody.projectRevision,
        name: "Draft Overview",
      },
    });
    const renamedBody = renamed.json() as PageMutationResponse;
    const deletedDraft = await app.inject({
      method: "DELETE",
      url: `/api/v1/pages/${second.page.id}`,
      payload: {
        expectedRevision: routePatched.page.revision,
        expectedProjectRevision: renamedBody.projectRevision,
        idempotencyKey: `draft-delete-${randomUUID()}`,
        resolution: "DELETE_DEPENDENCIES",
      },
    });
    expect(deletedDraft.statusCode, deletedDraft.body).toBe(200);
    const deletedDraftBody = deletedDraft.json() as {
      readonly projectRevision: number;
    };
    const runtimeBeforeRepublish = await app.inject({
      method: "GET",
      url: `/api/v1/runtime/${project.id}/navigation`,
    });
    expect(runtimeBeforeRepublish.json()).toMatchObject({
      versionId: publishedBody.versionId,
      pages: [{ name: "Overview" }, { name: "Detail" }],
    });

    await close(app);
    app = server(current);
    const runtimeAfterRestart = await app.inject({
      method: "GET",
      url: `/api/v1/runtime/${project.id}/navigation`,
    });
    expect(runtimeAfterRestart.json()).toEqual(runtimeBeforeRepublish.json());

    const republished = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/publish`,
      payload: {
        expectedProjectRevision: deletedDraftBody.projectRevision,
        idempotencyKey: `republish-${randomUUID()}`,
      },
    });
    const republishedBody = republished.json() as {
      readonly versionId: string;
      readonly projectRevision: number;
    };
    expect(republishedBody.versionId).not.toBe(publishedBody.versionId);
    const latestRuntime = await app.inject({
      method: "GET",
      url: `/api/v1/runtime/${project.id}/navigation`,
    });
    expect(latestRuntime.json()).toMatchObject({
      versionId: republishedBody.versionId,
      pages: [{ name: "Draft Overview" }],
    });
  });

  it("rejects imported all-hidden published snapshots without partial metadata or storage", async () => {
    const current = fixture();
    const app = server(current);
    const project = await createProject(
      app,
      "Import Navigation",
      "import-navigation",
    );
    const first = await createPage(app, project.id, 1, "Visible");
    const second = await createPage(
      app,
      project.id,
      first.projectRevision,
      "Also Visible",
    );
    const published = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/publish`,
      payload: {
        expectedProjectRevision: second.projectRevision,
        idempotencyKey: `publish-import-policy-${randomUUID()}`,
      },
    });
    expect(published.statusCode, published.body).toBe(200);
    const exported = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/export`,
    });
    expect(exported.statusCode, exported.body).toBe(200);
    const exportPayload = (
      exported.json() as {
        readonly export: {
          manifest: {
            publishedVersions: {
              pages: { navigationVisible: boolean }[];
            }[];
          };
        };
      }
    ).export;

    const inspectState = () => {
      const database = new Database(current.databasePath);
      try {
        const counts = Object.fromEntries(
          ["projects", "pages", "project_versions", "audit_logs"].map(
            (table) => [
              table,
              (
                database
                  .prepare(`SELECT count(*) AS count FROM ${table}`)
                  .get() as { readonly count: number }
              ).count,
            ],
          ),
        );
        return {
          counts,
          activeProjectIds: readdirSync(
            join(current.storageRoot, "active"),
          ).sort(),
        };
      } finally {
        database.close();
      }
    };

    const beforeInvalidImport = inspectState();
    const allHiddenExport = structuredClone(exportPayload);
    const importedSnapshot = allHiddenExport.manifest.publishedVersions[0];
    expect(importedSnapshot).toBeDefined();
    if (importedSnapshot !== undefined) {
      importedSnapshot.pages = importedSnapshot.pages.map((page) => ({
        ...page,
        navigationVisible: false,
      }));
    }
    const rejected = await app.inject({
      method: "POST",
      url: "/api/v1/projects/import",
      payload: {
        export: allHiddenExport,
        name: "Rejected Hidden Import",
        slug: "rejected-hidden-import",
      },
    });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json()).toMatchObject({
      error: {
        code: "INVALID_PROJECT_VERSION_NAVIGATION",
        details: { errors: ["ALL_NAVIGATION_HIDDEN"] },
      },
    });
    expect(inspectState()).toEqual(beforeInvalidImport);

    const emptySnapshotExport = structuredClone(exportPayload);
    const emptySnapshot = emptySnapshotExport.manifest.publishedVersions[0];
    expect(emptySnapshot).toBeDefined();
    if (emptySnapshot !== undefined) emptySnapshot.pages = [];
    const allowedEmpty = await app.inject({
      method: "POST",
      url: "/api/v1/projects/import",
      payload: {
        export: emptySnapshotExport,
        name: "Allowed Empty Snapshot",
        slug: "allowed-empty-snapshot",
      },
    });
    expect(allowedEmpty.statusCode, allowedEmpty.body).toBe(201);
    const allowedProject = (allowedEmpty.json() as { project: ProjectDto })
      .project;
    const emptyRuntime = await app.inject({
      method: "GET",
      url: `/api/v1/runtime/${allowedProject.id}/navigation`,
    });
    expect(emptyRuntime.statusCode, emptyRuntime.body).toBe(200);
    expect(emptyRuntime.json()).toMatchObject({ pages: [] });
  });

  it("remaps pages through clone/export/import and preserves them through trash/restore before purge", async () => {
    const current = fixture();
    const app = server(current);
    const project = await createProject(
      app,
      "Lifecycle Pages",
      "lifecycle-pages",
    );
    const first = await createPage(app, project.id, 1, "One");
    const second = await createPage(
      app,
      project.id,
      first.projectRevision,
      "Two",
    );
    const published = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/publish`,
      payload: {
        expectedProjectRevision: second.projectRevision,
        idempotencyKey: `publish-export-${randomUUID()}`,
      },
    });
    const publishedBody = published.json() as {
      readonly projectRevision: number;
    };

    const exported = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/export`,
    });
    expect(exported.statusCode).toBe(200);
    const exportBody = exported.json() as {
      readonly export: {
        readonly manifest: { readonly pages: readonly PageDto[] };
      };
    };
    expect(exportBody.export.manifest.pages.map((page) => page.id)).toEqual([
      first.page.id,
      second.page.id,
    ]);

    const cloned = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/clone`,
      payload: { name: "Lifecycle Clone", slug: "lifecycle-clone" },
    });
    expect(cloned.statusCode, cloned.body).toBe(201);
    const cloneProject = (cloned.json() as { project: ProjectDto }).project;
    const clonePages = await listPages(app, cloneProject.id);
    expect(clonePages.pages.map((page) => page.id)).not.toEqual([
      first.page.id,
      second.page.id,
    ]);
    expect(
      clonePages.pages.map(({ name, route, iconName, sortOrder }) => ({
        name,
        route,
        iconName,
        sortOrder,
      })),
    ).toEqual(
      exportBody.export.manifest.pages.map(
        ({ name, route, iconName, sortOrder }) => ({
          name,
          route,
          iconName,
          sortOrder,
        }),
      ),
    );
    const cloneRuntime = await app.inject({
      method: "GET",
      url: `/api/v1/runtime/${cloneProject.id}/navigation`,
    });
    expect(cloneRuntime.statusCode, cloneRuntime.body).toBe(200);
    const cloneRuntimeBody = cloneRuntime.json() as {
      readonly pages: readonly { readonly id: string; readonly name: string }[];
    };
    expect(cloneRuntimeBody.pages.map((page) => page.id)).toEqual(
      clonePages.pages.map((page) => page.id),
    );

    const imported = await app.inject({
      method: "POST",
      url: "/api/v1/projects/import",
      payload: {
        export: exported.json().export,
        name: "Lifecycle Import",
        slug: "lifecycle-import",
      },
    });
    expect(imported.statusCode, imported.body).toBe(201);
    const importedProject = (imported.json() as { project: ProjectDto })
      .project;
    const importedPages = await listPages(app, importedProject.id);
    expect(importedPages.pages).toHaveLength(2);
    expect(new Set(importedPages.pages.map((page) => page.id))).not.toEqual(
      new Set([first.page.id, second.page.id]),
    );
    const importedRuntime = await app.inject({
      method: "GET",
      url: `/api/v1/runtime/${importedProject.id}/navigation`,
    });
    expect(importedRuntime.statusCode, importedRuntime.body).toBe(200);
    expect(
      (
        importedRuntime.json() as { pages: readonly { id: string }[] }
      ).pages.map((page) => page.id),
    ).toEqual(importedPages.pages.map((page) => page.id));

    const trashed = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/trash`,
      payload: {
        expectedRevision: publishedBody.projectRevision,
        expectedLifecycleRevision: 0,
        idempotencyKey: `trash-pages-${randomUUID()}`,
        reason: "page lifecycle test",
      },
    });
    expect(trashed.statusCode, trashed.body).toBe(200);
    const trashedProject = (trashed.json() as { project: ProjectDto }).project;
    const blockedRuntime = await app.inject({
      method: "GET",
      url: `/api/v1/runtime/${project.id}/navigation`,
    });
    expect(blockedRuntime.statusCode).toBe(409);
    expect(blockedRuntime.json()).toMatchObject({
      error: { code: "PROJECT_NOT_ACTIVE" },
    });

    const tamperDatabase = new Database(current.databasePath);
    tamperDatabase
      .prepare("UPDATE pages SET name = 'Tampered' WHERE id = ?")
      .run(first.page.id);
    tamperDatabase.close();
    const checksumBlockedRestore = await app.inject({
      method: "POST",
      url: `/api/v1/recycle-bin/projects/${project.id}/restore`,
      payload: {
        expectedLifecycleRevision: trashedProject.lifecycleRevision,
        idempotencyKey: `restore-tampered-${randomUUID()}`,
        conflictResolution: "KEEP_ORIGINAL",
      },
    });
    expect(checksumBlockedRestore.statusCode).toBe(409);
    expect(checksumBlockedRestore.json()).toMatchObject({
      error: { code: "TRASH_PAGE_DEFINITION_CHECKSUM_MISMATCH" },
    });
    const repairedDatabase = new Database(current.databasePath);
    repairedDatabase
      .prepare("UPDATE pages SET name = 'One' WHERE id = ?")
      .run(first.page.id);
    repairedDatabase.close();

    const restored = await app.inject({
      method: "POST",
      url: `/api/v1/recycle-bin/projects/${project.id}/restore`,
      payload: {
        expectedLifecycleRevision: trashedProject.lifecycleRevision,
        idempotencyKey: `restore-pages-${randomUUID()}`,
        conflictResolution: "KEEP_ORIGINAL",
      },
    });
    expect(restored.statusCode, restored.body).toBe(200);
    const restoredProject = (restored.json() as { project: ProjectDto })
      .project;
    expect(
      (await listPages(app, project.id)).pages.map((page) => page.id),
    ).toEqual([first.page.id, second.page.id]);
    const restoredRuntime = await app.inject({
      method: "GET",
      url: `/api/v1/runtime/${project.id}/navigation`,
    });
    expect(restoredRuntime.statusCode).toBe(200);

    const trashedAgain = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/trash`,
      payload: {
        expectedRevision: restoredProject.revision,
        expectedLifecycleRevision: restoredProject.lifecycleRevision,
        idempotencyKey: `trash-again-${randomUUID()}`,
        reason: "purge pages",
      },
    });
    const trashedAgainProject = (trashedAgain.json() as { project: ProjectDto })
      .project;
    const purgePlan = await app.inject({
      method: "POST",
      url: `/api/v1/recycle-bin/projects/${project.id}/purge-plan`,
      payload: {
        expectedLifecycleRevision: trashedAgainProject.lifecycleRevision,
      },
    });
    const plan = (
      purgePlan.json() as {
        readonly plan: {
          readonly id: string;
          readonly typedConfirmation: string;
        };
      }
    ).plan;
    const purged = await app.inject({
      method: "DELETE",
      url: `/api/v1/recycle-bin/projects/${project.id}`,
      payload: {
        purgePlanId: plan.id,
        expectedLifecycleRevision: trashedAgainProject.lifecycleRevision,
        typedConfirmation: plan.typedConfirmation,
        idempotencyKey: `purge-pages-${randomUUID()}`,
        backupBeforePurge: false,
      },
    });
    expect(purged.statusCode, purged.body).toBe(200);
    const database = new Database(current.databasePath);
    try {
      for (const table of [
        "pages",
        "page_commands",
        "project_definition_operations",
        "project_versions",
      ]) {
        expect(
          (
            database
              .prepare(
                `SELECT count(*) AS count FROM ${table} WHERE project_id = ?`,
              )
              .get(project.id) as { readonly count: number }
          ).count,
        ).toBe(0);
      }
    } finally {
      database.close();
    }
  });
});
