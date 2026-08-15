import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  ApplySchemaMigrationDto,
  DataSchemaDto,
  SchemaMigrationPlanDto,
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
  const directory = mkdtempSync(join(tmpdir(), "webeditor-phase8-"));
  directories.push(directory);
  return {
    directory,
    databasePath: join(directory, "metadata", "webeditor.sqlite"),
    storageRoot: join(directory, "projects"),
  };
}

function server(
  current: Fixture,
  schemaFailureInjector?: (point: string) => void,
): FastifyInstance {
  const app = buildServer({
    metadataDatabasePath: current.databasePath,
    storageRoot: current.storageRoot,
    ...(schemaFailureInjector === undefined ? {} : { schemaFailureInjector }),
  });
  apps.push(app);
  return app;
}

async function close(app: FastifyInstance): Promise<void> {
  const index = apps.indexOf(app);
  if (index >= 0) apps.splice(index, 1);
  await app.close();
}

async function createProject(app: FastifyInstance) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/projects",
    payload: {
      name: `Schema ${randomUUID().slice(0, 8)}`,
      slug: `schema-${randomUUID().slice(0, 8)}`,
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  return (response.json() as { project: { id: string; revision: number } })
    .project;
}

async function schema(app: FastifyInstance, projectId: string) {
  const response = await app.inject({
    method: "GET",
    url: `/api/v1/projects/${projectId}/schema`,
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json() as DataSchemaDto;
}

async function createTable(
  app: FastifyInstance,
  current: DataSchemaDto,
  template: "BLANK" | "ENTITY" | "TIME_SERIES",
  displayName: string,
) {
  const response = await app.inject({
    method: "POST",
    url: `/api/v1/projects/${current.projectId}/tables`,
    payload: {
      displayName,
      template,
      expectedSchemaRevision: current.schemaRevision,
      expectedProjectRevision: current.projectRevision,
      idempotencyKey: `table-${randomUUID()}`,
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json() as DataSchemaDto;
}

async function plan(app: FastifyInstance, current: DataSchemaDto) {
  const response = await app.inject({
    method: "POST",
    url: `/api/v1/projects/${current.projectId}/schema/plan`,
    payload: {
      expectedSchemaRevision: current.schemaRevision,
      expectedProjectRevision: current.projectRevision,
    },
  });
  expect(response.statusCode, response.body).toBe(200);
  return (response.json() as { plan: SchemaMigrationPlanDto }).plan;
}

async function apply(
  app: FastifyInstance,
  current: DataSchemaDto,
  migration: SchemaMigrationPlanDto,
  confirmDestructive = false,
) {
  const response = await app.inject({
    method: "POST",
    url: `/api/v1/projects/${current.projectId}/schema/apply`,
    payload: {
      planId: migration.id,
      expectedSchemaRevision: current.schemaRevision,
      expectedProjectRevision: current.projectRevision,
      confirmDestructive,
      idempotencyKey: `apply-${randomUUID()}`,
    },
  });
  return response;
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

describe("Phase 8 Database Designer", () => {
  it("creates server-owned physical Tables and Fields with optimistic idempotent metadata revisions", async () => {
    const current = fixture();
    const app = server(current);
    const project = await createProject(app);
    const empty = await schema(app, project.id);
    expect(empty).toMatchObject({
      schemaRevision: 0,
      projectRevision: 1,
      tables: [],
      relations: [],
      runtime: {
        test: { appliedRevision: 0, drift: false, integrity: "ok" },
        production: { appliedRevision: 0, drift: false, integrity: "ok" },
      },
    });

    const key = `entity-${randomUUID()}`;
    const request = {
      displayName: "환자",
      description: "분석 대상",
      template: "ENTITY",
      expectedSchemaRevision: 0,
      expectedProjectRevision: 1,
      idempotencyKey: key,
    };
    const created = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/tables`,
      payload: request,
    });
    expect(created.statusCode, created.body).toBe(201);
    const body = created.json() as DataSchemaDto;
    expect(body.schemaRevision).toBe(1);
    expect(body.projectRevision).toBe(2);
    expect(body.tables).toHaveLength(1);
    expect(body.tables[0]?.physicalName).toMatch(/^t_[0-9a-f]{32}$/);
    expect(body.tables[0]?.fields.map((field) => field.displayName)).toEqual([
      "ID",
      "생성일",
      "수정일",
    ]);
    expect(
      body.tables[0]?.fields.every((field) =>
        /^c_[0-9a-f]{32}$/.test(field.physicalName),
      ),
    ).toBe(true);

    const replay = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/tables`,
      payload: request,
    });
    expect(replay.statusCode, replay.body).toBe(201);
    expect(replay.json()).toEqual(body);
    const conflict = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/tables`,
      payload: { ...request, displayName: "다른 이름" },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({
      error: { code: "IDEMPOTENCY_PAYLOAD_CONFLICT" },
    });

    const unknownPhysicalName = await app.inject({
      method: "PATCH",
      url: `/api/v1/tables/${body.tables[0]?.id}`,
      payload: {
        physicalName: "patients",
        expectedRevision: 1,
        expectedSchemaRevision: 1,
        expectedProjectRevision: 2,
        idempotencyKey: `physical-${randomUUID()}`,
      },
    });
    expect(unknownPhysicalName.statusCode).toBe(400);
    expect(unknownPhysicalName.json()).toMatchObject({
      error: { code: "UNKNOWN_REQUEST_FIELD" },
    });
  });

  it("plans and applies a real isolated Test SQLite schema while preserving Production and retained rows", async () => {
    const current = fixture();
    const app = server(current);
    const project = await createProject(app);
    let desired = await schema(app, project.id);
    desired = await createTable(app, desired, "TIME_SERIES", "측정값");
    const table = desired.tables[0]!;
    const firstPlan = await plan(app, desired);
    expect(firstPlan.steps.some((step) => step.kind === "CREATE_TABLE")).toBe(
      true,
    );
    expect(firstPlan.impact.destructive).toBe(false);
    const productionPath = join(
      current.storageRoot,
      "active",
      project.id,
      "production.sqlite",
    );
    const productionBefore = sha256(productionPath);
    const appliedResponse = await apply(app, desired, firstPlan);
    expect(appliedResponse.statusCode, appliedResponse.body).toBe(200);
    const applied = appliedResponse.json() as ApplySchemaMigrationDto;
    expect(applied).toMatchObject({
      integrity: "ok",
      rowCountBefore: 0,
      rowCountAfter: 0,
      schema: {
        runtime: {
          test: { appliedRevision: desired.schemaRevision, drift: false },
          production: { appliedRevision: 0, drift: true },
        },
      },
    });
    expect(applied.backupChecksum).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256(productionPath)).toBe(productionBefore);

    const testPath = join(
      current.storageRoot,
      "active",
      project.id,
      "test.sqlite",
    );
    const runtime = new Database(testPath);
    runtime
      .prepare(
        `INSERT INTO "${table.physicalName}" (
          "${table.fields[0]!.physicalName}",
          "${table.fields[1]!.physicalName}",
          "${table.fields[2]!.physicalName}"
        ) VALUES (?, ?, ?)`,
      )
      .run("row-1", "2026-08-16T00:00:00.000Z", 42.5);
    runtime.close();

    const fieldResponse = await app.inject({
      method: "POST",
      url: `/api/v1/tables/${table.id}/fields`,
      payload: {
        displayName: "단위",
        type: "TEXT",
        nullable: true,
        expectedSchemaRevision: desired.schemaRevision,
        expectedProjectRevision: desired.projectRevision,
        idempotencyKey: `field-${randomUUID()}`,
      },
    });
    expect(fieldResponse.statusCode, fieldResponse.body).toBe(201);
    desired = fieldResponse.json() as DataSchemaDto;
    const secondPlan = await plan(app, desired);
    const secondApply = await apply(app, desired, secondPlan);
    expect(secondApply.statusCode, secondApply.body).toBe(200);
    const reopened = new Database(testPath, { readonly: true });
    expect(
      (
        reopened
          .prepare(`SELECT COUNT(*) AS count FROM "${table.physicalName}"`)
          .get() as { count: number }
      ).count,
    ).toBe(1);
    expect(reopened.pragma("quick_check", { simple: true })).toBe("ok");
    reopened.close();
    expect(sha256(productionPath)).toBe(productionBefore);
  });

  it("reports destructive impact, requires confirmation, and restores the verified backup after an injected apply failure", async () => {
    const current = fixture();
    let failAfterSwap = false;
    const app = server(current, (point) => {
      if (point === "schema:after-runtime-swap" && failAfterSwap) {
        throw new Error("injected schema failure");
      }
    });
    const project = await createProject(app);
    let desired = await schema(app, project.id);
    desired = await createTable(app, desired, "ENTITY", "삭제 예정");
    const initialPlan = await plan(app, desired);
    expect((await apply(app, desired, initialPlan)).statusCode).toBe(200);
    const table = desired.tables[0]!;
    const testPath = join(
      current.storageRoot,
      "active",
      project.id,
      "test.sqlite",
    );
    const beforeDelete = sha256(testPath);

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/v1/tables/${table.id}`,
      payload: {
        expectedRevision: table.revision,
        expectedSchemaRevision: desired.schemaRevision,
        expectedProjectRevision: desired.projectRevision,
        idempotencyKey: `delete-${randomUUID()}`,
      },
    });
    expect(deleted.statusCode, deleted.body).toBe(200);
    desired = deleted.json() as DataSchemaDto;
    const destructive = await plan(app, desired);
    expect(destructive.impact).toMatchObject({
      destructive: true,
      droppedTableCount: 1,
    });
    const blocked = await apply(app, desired, destructive, false);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json()).toMatchObject({
      error: { code: "DESTRUCTIVE_SCHEMA_CONFIRMATION_REQUIRED" },
    });

    failAfterSwap = true;
    const failed = await apply(app, desired, destructive, true);
    expect(failed.statusCode).toBe(500);
    expect(sha256(testPath)).toBe(beforeDelete);
    const runtime = new Database(testPath, { readonly: true });
    expect(
      runtime
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
        )
        .get(table.physicalName),
    ).toEqual({ name: table.physicalName });
    expect(runtime.pragma("quick_check", { simple: true })).toBe("ok");
    runtime.close();
    expect((await schema(app, project.id)).runtime.test.appliedRevision).toBe(
      1,
    );
  });

  it("persists compatible Relations and rolls back interrupted APPLYING journals on restart", async () => {
    const current = fixture();
    let app = server(current);
    const project = await createProject(app);
    let desired = await schema(app, project.id);
    desired = await createTable(app, desired, "ENTITY", "부모");
    desired = await createTable(app, desired, "BLANK", "자식");
    const parent = desired.tables.find(
      (table) => table.displayName === "부모",
    )!;
    const child = desired.tables.find((table) => table.displayName === "자식")!;
    const childFieldResponse = await app.inject({
      method: "POST",
      url: `/api/v1/tables/${child.id}/fields`,
      payload: {
        displayName: "부모 ID",
        type: "TEXT",
        nullable: true,
        indexed: true,
        expectedSchemaRevision: desired.schemaRevision,
        expectedProjectRevision: desired.projectRevision,
        idempotencyKey: `relation-field-${randomUUID()}`,
      },
    });
    expect(childFieldResponse.statusCode, childFieldResponse.body).toBe(201);
    desired = childFieldResponse.json() as DataSchemaDto;
    const childForeignKey = desired.tables
      .find((table) => table.id === child.id)!
      .fields.find((field) => field.displayName === "부모 ID")!;
    const relationResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/relations`,
      payload: {
        displayName: "부모-자식",
        type: "ONE_TO_MANY",
        sourceTableId: child.id,
        sourceFieldId: childForeignKey.id,
        targetTableId: parent.id,
        targetFieldId: parent.fields[0]!.id,
        onDelete: "SET_NULL",
        expectedSchemaRevision: desired.schemaRevision,
        expectedProjectRevision: desired.projectRevision,
        idempotencyKey: `relation-${randomUUID()}`,
      },
    });
    expect(relationResponse.statusCode, relationResponse.body).toBe(201);
    desired = relationResponse.json() as DataSchemaDto;
    expect(desired.relations).toHaveLength(1);
    const migration = await plan(app, desired);
    expect((await apply(app, desired, migration)).statusCode).toBe(200);
    const testPath = join(
      current.storageRoot,
      "active",
      project.id,
      "test.sqlite",
    );
    const database = new Database(testPath, { readonly: true });
    expect(
      database
        .prepare(`PRAGMA foreign_key_list("${child.physicalName}")`)
        .all(),
    ).toHaveLength(1);
    database.close();

    const metadata = new Database(current.databasePath);
    const backup = metadata
      .prepare(
        "SELECT b.relative_path, b.checksum, p.id AS plan_id FROM schema_backups b JOIN schema_migration_plans p ON p.id = b.plan_id WHERE b.project_id = ? ORDER BY b.created_at DESC LIMIT 1",
      )
      .get(project.id) as {
      readonly relative_path: string;
      readonly checksum: string;
      readonly plan_id: string;
    };
    metadata
      .prepare(
        "UPDATE schema_migration_plans SET status = 'APPLYING', completed_at = NULL WHERE id = ?",
      )
      .run(backup.plan_id);
    metadata.close();
    await close(app);
    app = server(current);
    const recovered = new Database(current.databasePath, { readonly: true });
    expect(
      recovered
        .prepare("SELECT status FROM schema_migration_plans WHERE id = ?")
        .get(backup.plan_id),
    ).toEqual({ status: "FAILED" });
    recovered.close();
    expect(sha256(join(current.storageRoot, backup.relative_path))).toBe(
      backup.checksum,
    );
    expect((await schema(app, project.id)).runtime.test.integrity).toBe("ok");
  });

  it("remaps schema identity across clone and import while preserving runtime rows through trash, restart, restore, and purge", async () => {
    const current = fixture();
    let app = server(current);
    const project = await createProject(app);
    let desired = await schema(app, project.id);
    desired = await createTable(app, desired, "TIME_SERIES", "수명주기 측정값");
    const sourceTable = desired.tables[0]!;
    const migration = await plan(app, desired);
    expect((await apply(app, desired, migration)).statusCode).toBe(200);

    const sourceRuntimePath = join(
      current.storageRoot,
      "active",
      project.id,
      "test.sqlite",
    );
    const sourceRuntime = new Database(sourceRuntimePath);
    sourceRuntime
      .prepare(
        `INSERT INTO "${sourceTable.physicalName}" (
          "${sourceTable.fields[0]!.physicalName}",
          "${sourceTable.fields[1]!.physicalName}",
          "${sourceTable.fields[2]!.physicalName}"
        ) VALUES (?, ?, ?)`,
      )
      .run("lifecycle-row", "2026-08-16T00:00:00.000Z", 18.25);
    sourceRuntime.close();

    const cloneResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/clone`,
      payload: {
        name: "Schema Clone",
        slug: `schema-clone-${randomUUID().slice(0, 8)}`,
      },
    });
    expect(cloneResponse.statusCode, cloneResponse.body).toBe(201);
    const clone = (
      cloneResponse.json() as {
        project: {
          id: string;
          name: string;
          revision: number;
          lifecycleRevision: number;
        };
      }
    ).project;
    const clonedSchema = await schema(app, clone.id);
    expect(clonedSchema.tables).toHaveLength(1);
    expect(clonedSchema.tables[0]?.id).not.toBe(sourceTable.id);
    expect(clonedSchema.tables[0]?.physicalName).toBe(sourceTable.physicalName);
    expect(clonedSchema.tables[0]?.fields.map((field) => field.id)).not.toEqual(
      sourceTable.fields.map((field) => field.id),
    );
    const cloneRuntime = new Database(
      join(current.storageRoot, "active", clone.id, "test.sqlite"),
      { readonly: true },
    );
    expect(
      (
        cloneRuntime
          .prepare(
            `SELECT COUNT(*) AS count FROM "${sourceTable.physicalName}"`,
          )
          .get() as { count: number }
      ).count,
    ).toBe(1);
    cloneRuntime.close();

    const exportResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/export`,
    });
    expect(exportResponse.statusCode, exportResponse.body).toBe(200);
    const exported = (
      exportResponse.json() as { export: Record<string, unknown> }
    ).export;
    const importResponse = await app.inject({
      method: "POST",
      url: "/api/v1/projects/import",
      payload: {
        export: exported,
        name: "Schema Import",
        slug: `schema-import-${randomUUID().slice(0, 8)}`,
      },
    });
    expect(importResponse.statusCode, importResponse.body).toBe(201);
    const imported = (
      importResponse.json() as {
        project: {
          id: string;
          revision: number;
          lifecycleRevision: number;
        };
      }
    ).project;
    const importedSchema = await schema(app, imported.id);
    expect(importedSchema.tables[0]?.id).not.toBe(sourceTable.id);
    expect(importedSchema.tables[0]?.physicalName).toBe(
      sourceTable.physicalName,
    );
    const importedRuntime = new Database(
      join(current.storageRoot, "active", imported.id, "test.sqlite"),
      { readonly: true },
    );
    expect(
      (
        importedRuntime
          .prepare(
            `SELECT COUNT(*) AS count FROM "${sourceTable.physicalName}"`,
          )
          .get() as { count: number }
      ).count,
    ).toBe(1);
    importedRuntime.close();

    const sourceProjectResponse = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${project.id}`,
    });
    const sourceProject = (
      sourceProjectResponse.json() as {
        project: { revision: number; lifecycleRevision: number };
      }
    ).project;
    const trashResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/trash`,
      payload: {
        expectedRevision: sourceProject.revision,
        expectedLifecycleRevision: sourceProject.lifecycleRevision,
        idempotencyKey: `schema-trash-${randomUUID()}`,
        reason: "schema lifecycle",
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
      url: `/api/v1/recycle-bin/projects/${project.id}/restore`,
      payload: {
        expectedLifecycleRevision: trashed.lifecycleRevision,
        conflictResolution: "KEEP_ORIGINAL",
        idempotencyKey: `schema-restore-${randomUUID()}`,
      },
    });
    expect(restoreResponse.statusCode, restoreResponse.body).toBe(200);
    expect((await schema(app, project.id)).tables[0]?.id).toBe(sourceTable.id);
    const restoredRuntime = new Database(sourceRuntimePath, { readonly: true });
    expect(
      (
        restoredRuntime
          .prepare(
            `SELECT COUNT(*) AS count FROM "${sourceTable.physicalName}"`,
          )
          .get() as { count: number }
      ).count,
    ).toBe(1);
    restoredRuntime.close();

    const cloneTrashResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${clone.id}/trash`,
      payload: {
        expectedRevision: clone.revision,
        expectedLifecycleRevision: clone.lifecycleRevision,
        idempotencyKey: `schema-clone-trash-${randomUUID()}`,
      },
    });
    expect(cloneTrashResponse.statusCode, cloneTrashResponse.body).toBe(200);
    const cloneTrashed = (
      cloneTrashResponse.json() as {
        project: { lifecycleRevision: number };
      }
    ).project;
    const purgePlanResponse = await app.inject({
      method: "POST",
      url: `/api/v1/recycle-bin/projects/${clone.id}/purge-plan`,
      payload: { expectedLifecycleRevision: cloneTrashed.lifecycleRevision },
    });
    expect(purgePlanResponse.statusCode, purgePlanResponse.body).toBe(200);
    const purgePlan = (
      purgePlanResponse.json() as { plan: { purgePlanId: string } }
    ).plan;
    const purgeResponse = await app.inject({
      method: "DELETE",
      url: `/api/v1/recycle-bin/projects/${clone.id}`,
      payload: {
        purgePlanId: purgePlan.purgePlanId,
        expectedLifecycleRevision: cloneTrashed.lifecycleRevision,
        typedConfirmation: clone.name,
        idempotencyKey: `schema-clone-purge-${randomUUID()}`,
        backupBeforePurge: false,
      },
    });
    expect(purgeResponse.statusCode, purgeResponse.body).toBe(200);
    const metadata = new Database(current.databasePath, { readonly: true });
    expect(
      (
        metadata
          .prepare(
            "SELECT COUNT(*) AS count FROM data_tables WHERE project_id = ?",
          )
          .get(clone.id) as { count: number }
      ).count,
    ).toBe(0);
    expect(
      (
        metadata
          .prepare(
            "SELECT COUNT(*) AS count FROM project_schema_states WHERE project_id = ?",
          )
          .get(clone.id) as { count: number }
      ).count,
    ).toBe(0);
    metadata.close();
  });
});
