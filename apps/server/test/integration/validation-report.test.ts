import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BINDING_TYPES, type ValidationRunDto } from "@webeditor/domain";
import Database from "better-sqlite3";
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

function fixture(root?: string) {
  const directory = root ?? mkdtempSync(join(tmpdir(), "webeditor-phase16-"));
  if (!directories.includes(directory)) directories.push(directory);
  const metadataDatabasePath = join(directory, "metadata", "webeditor.sqlite");
  const storageRoot = join(directory, "projects");
  const app = buildServer({ metadataDatabasePath, storageRoot });
  apps.push(app);
  return { app, directory, metadataDatabasePath, storageRoot };
}

async function createProject(app: FastifyInstance) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/projects",
    payload: {
      name: "Validation",
      slug: `validation-${randomUUID().slice(0, 8)}`,
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  return (
    response.json() as {
      readonly project: { readonly id: string; readonly revision: number };
    }
  ).project;
}

describe("Phase 16 validation inventory and report", () => {
  it("persists evidence-backed PASS runs, lists them, and replays exactly across restart", async () => {
    const { app, directory } = fixture();
    const project = await createProject(app);
    const payload = {
      expectedProjectRevision: project.revision,
      idempotencyKey: `validate:${randomUUID()}`,
    };
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/validate`,
      payload,
    });
    expect(response.statusCode, response.body).toBe(200);
    const run = response.json() as ValidationRunDto;
    expect(run.status).toBe("PASS");
    expect(run.issues).toEqual([]);
    expect(run.inventoryRequired).toBeGreaterThan(200);
    expect(run.inventoryVerified).toBe(run.inventoryRequired);
    expect(
      run.inventory.every(
        (item) => item.requiredTests.length > 0 && item.evidence.length > 0,
      ),
    ).toBe(true);
    expect(
      run.inventory.some(
        (item) =>
          item.category === "API_ROUTE" &&
          item.itemId === "POST /api/v1/projects/:projectId/validate",
      ),
    ).toBe(true);
    const bindingInventory = run.inventory.filter(
      (item) => item.category === "BINDING",
    );
    expect(bindingInventory.map((item) => item.itemId).sort()).toEqual(
      [...BINDING_TYPES].sort(),
    );
    for (const item of bindingInventory) {
      const expectedTest = ["create", "update", "delete"].includes(item.itemId)
        ? "apps/server/test/integration/crud-binding-runtime.test.ts"
        : ["parameter", "navigation"].includes(item.itemId)
          ? "apps/server/test/integration/project-variable-navigation.test.ts"
          : "apps/server/test/integration/safe-read-binding-engine.test.ts";
      expect(item.requiredTests).toEqual([expectedTest]);
    }

    const replay = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/validate`,
      payload,
    });
    expect(replay.statusCode, replay.body).toBe(200);
    expect(replay.json()).toEqual(run);
    const conflict = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/validate`,
      payload: { ...payload, expectedProjectRevision: project.revision + 1 },
    });
    expect(conflict.statusCode, conflict.body).toBe(409);
    expect(conflict.json()).toMatchObject({
      error: { code: "IDEMPOTENCY_PAYLOAD_CONFLICT" },
    });

    await app.close();
    apps.splice(apps.indexOf(app), 1);
    const restarted = fixture(directory).app;
    const list = await restarted.inject({
      method: "GET",
      url: `/api/v1/projects/${project.id}/validation-runs`,
    });
    expect(list.statusCode, list.body).toBe(200);
    expect(list.json()).toMatchObject({
      projectId: project.id,
      runs: [{ id: run.id, status: "PASS" }],
    });
    const detail = await restarted.inject({
      method: "GET",
      url: `/api/v1/projects/${project.id}/validation-runs/${run.id}`,
    });
    expect(detail.statusCode, detail.body).toBe(200);
    expect(detail.json()).toEqual(run);
  });

  it("detects broken Page routes, Binding references, and Test DB physical schema with deep links", async () => {
    const { app, metadataDatabasePath, storageRoot } = fixture();
    const project = await createProject(app);
    const pageResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/pages`,
      payload: {
        pageType: "blank",
        expectedProjectRevision: project.revision,
        idempotencyKey: `page:${randomUUID()}`,
      },
    });
    expect(pageResponse.statusCode, pageResponse.body).toBe(201);
    const pageMutation = pageResponse.json() as {
      readonly page: { readonly id: string };
      readonly projectRevision: number;
    };
    const brokenTargetId = randomUUID();
    const tableId = randomUUID();
    const now = new Date().toISOString();
    const metadata = new Database(metadataDatabasePath);
    try {
      metadata.pragma("ignore_check_constraints = ON");
      metadata
        .prepare("UPDATE pages SET route = ? WHERE id = ?")
        .run("broken-route", pageMutation.page.id);
      metadata
        .prepare(
          `INSERT INTO bindings (
             id, project_id, binding_type,
             source_node_type, source_object_id, source_node_id, source_port_id,
             source_port_role, source_side, source_direction, source_value_type,
             target_node_type, target_object_id, target_node_id, target_port_id,
             target_port_role, target_side, target_direction, target_value_type,
             query_json, mapping_json, status, revision, created_at, updated_at
           ) VALUES (?, ?, 'READ', 'page', ?, ?, ?, 'navigation', 'right',
             'output', 'route', 'page', ?, ?, ?, 'navigation', 'left', 'input',
             'route', '{}', '{}', 'READY', 1, ?, ?)`,
        )
        .run(
          randomUUID(),
          project.id,
          pageMutation.page.id,
          `page:${pageMutation.page.id}`,
          `page:${pageMutation.page.id}:navigation:output`,
          brokenTargetId,
          `page:${brokenTargetId}`,
          `page:${brokenTargetId}:navigation:input`,
          now,
          now,
        );
      metadata
        .prepare(
          `INSERT INTO data_tables (
             id, project_id, display_name, physical_name, revision,
             created_at, updated_at
           ) VALUES (?, ?, 'Missing table', ?, 1, ?, ?)`,
        )
        .run(tableId, project.id, `t_${tableId.replaceAll("-", "")}`, now, now);
    } finally {
      metadata.close();
    }
    const runtime = new Database(
      join(storageRoot, "active", project.id, "test.sqlite"),
      { readonly: true },
    );
    expect(runtime.prepare("SELECT 1").get()).toEqual({ 1: 1 });
    runtime.close();

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/validate`,
      payload: {
        expectedProjectRevision: pageMutation.projectRevision,
        idempotencyKey: `validate:${randomUUID()}`,
      },
    });
    expect(response.statusCode, response.body).toBe(200);
    const run = response.json() as ValidationRunDto;
    expect(run.status).toBe("FAIL");
    expect(run.issues.map((issue) => issue.ruleId)).toEqual(
      expect.arrayContaining([
        "PAGE_ROUTE_INVALID",
        "BINDING_REFERENCE_BROKEN",
        "PHYSICAL_TABLE_MISSING",
      ]),
    );
    expect(run.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: "PAGE_ROUTE_INVALID",
          target: expect.objectContaining({
            kind: "PAGE",
            pageId: pageMutation.page.id,
          }),
        }),
        expect.objectContaining({
          ruleId: "BINDING_REFERENCE_BROKEN",
          target: expect.objectContaining({ kind: "BINDING" }),
        }),
        expect.objectContaining({
          ruleId: "PHYSICAL_TABLE_MISSING",
          target: expect.objectContaining({ kind: "TABLE", tableId }),
        }),
      ]),
    );
  });
});
