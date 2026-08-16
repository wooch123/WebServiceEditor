import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  ProjectBackupDrillDto,
  ProjectBackupDto,
  ProjectBackupRestoreDto,
  ProjectDto,
} from "@webeditor/domain";
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
  const directory = root ?? mkdtempSync(join(tmpdir(), "webeditor-phase17-"));
  if (!directories.includes(directory)) directories.push(directory);
  const metadataDatabasePath = join(directory, "metadata", "webeditor.sqlite");
  const storageRoot = join(directory, "projects");
  const app = buildServer({ metadataDatabasePath, storageRoot });
  apps.push(app);
  return { app, directory, metadataDatabasePath, storageRoot };
}

async function close(app: FastifyInstance): Promise<void> {
  const index = apps.indexOf(app);
  if (index >= 0) apps.splice(index, 1);
  await app.close();
}

async function createPublishedProject(app: FastifyInstance) {
  const created = await app.inject({
    method: "POST",
    url: "/api/v1/projects",
    payload: {
      name: "Recovery Source",
      slug: `recovery-source-${randomUUID().slice(0, 8)}`,
      description: "Phase 17 backup fixture",
    },
  });
  expect(created.statusCode, created.body).toBe(201);
  const project = (created.json() as { project: ProjectDto }).project;
  const pageResponse = await app.inject({
    method: "POST",
    url: `/api/v1/projects/${project.id}/pages`,
    payload: {
      name: "Recovery Report",
      pageType: "blank",
      expectedProjectRevision: project.revision,
      idempotencyKey: `page:${randomUUID()}`,
    },
  });
  expect(pageResponse.statusCode, pageResponse.body).toBe(201);
  const page = pageResponse.json() as {
    page: { id: string; name: string; route: string };
    projectRevision: number;
  };
  const published = await app.inject({
    method: "POST",
    url: `/api/v1/projects/${project.id}/publish`,
    payload: {
      expectedProjectRevision: page.projectRevision,
      idempotencyKey: `publish:${randomUUID()}`,
    },
  });
  expect(published.statusCode, published.body).toBe(200);
  return {
    project: {
      ...project,
      revision: (published.json() as { projectRevision: number })
        .projectRevision,
    },
    page: page.page,
  };
}

function addRuntimeAndAssetFixture(storageRoot: string, projectId: string) {
  for (const environment of ["test", "production"] as const) {
    const database = new Database(
      join(storageRoot, "active", projectId, `${environment}.sqlite`),
    );
    try {
      database.exec(
        "CREATE TABLE recovery_measurements (id INTEGER PRIMARY KEY, value TEXT NOT NULL)",
      );
      database
        .prepare("INSERT INTO recovery_measurements (id, value) VALUES (1, ?)")
        .run(`${environment}-sentinel-value`);
    } finally {
      database.close();
    }
  }
  const assetDirectory = join(
    storageRoot,
    "active",
    projectId,
    "assets",
    "reports",
  );
  mkdirSync(assetDirectory, { recursive: true });
  writeFileSync(join(assetDirectory, "sentinel.txt"), "backup-asset-sentinel");
}

describe("Phase 17 project backup, export/import, and recovery", () => {
  it("restores a verified backup as a new project with the same Runtime data, Asset, and Published navigation", async () => {
    const first = fixture();
    let app = first.app;
    const source = await createPublishedProject(app);
    addRuntimeAndAssetFixture(first.storageRoot, source.project.id);
    const payload = {
      expectedRevision: source.project.revision,
      idempotencyKey: `backup:${randomUUID()}`,
      label: "Release snapshot",
    };
    const created = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${source.project.id}/backups`,
      payload,
    });
    expect(created.statusCode, created.body).toBe(201);
    const backup = (created.json() as { backup: ProjectBackupDto }).backup;
    expect(backup).toMatchObject({
      sourceProjectId: source.project.id,
      sourceProjectRevision: source.project.revision,
      status: "VERIFIED",
      label: "Release snapshot",
      fileCount: 4,
    });
    expect(backup.payloadChecksum).toMatch(/^[0-9a-f]{64}$/u);
    expect(backup.contentChecksum).toMatch(/^[0-9a-f]{64}$/u);

    const replay = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${source.project.id}/backups`,
      payload,
    });
    expect(replay.statusCode, replay.body).toBe(201);
    expect(replay.json()).toEqual(created.json());
    const conflict = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${source.project.id}/backups`,
      payload: { ...payload, label: "Different" },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({
      error: { code: "IDEMPOTENCY_PAYLOAD_CONFLICT" },
    });

    const verifyPayload = { idempotencyKey: `verify:${randomUUID()}` };
    const verified = await app.inject({
      method: "POST",
      url: `/api/v1/backups/${backup.id}/verify`,
      payload: verifyPayload,
    });
    expect(verified.statusCode, verified.body).toBe(200);
    expect((verified.json() as { drill: ProjectBackupDrillDto }).drill).toEqual(
      expect.objectContaining({
        backupId: backup.id,
        status: "PASS",
        payloadChecksum: backup.payloadChecksum,
        contentChecksum: backup.contentChecksum,
        fileCount: backup.fileCount,
      }),
    );

    await close(app);
    app = fixture(first.directory).app;
    const afterRestart = await app.inject({
      method: "GET",
      url: "/api/v1/backups",
    });
    expect(afterRestart.statusCode, afterRestart.body).toBe(200);
    expect(afterRestart.json()).toMatchObject({
      backups: [{ id: backup.id, status: "VERIFIED" }],
    });
    const sourceAfterRestart = (
      await app.inject({
        method: "GET",
        url: `/api/v1/projects/${source.project.id}`,
      })
    ).json() as { project: ProjectDto };
    const trashed = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${source.project.id}/trash`,
      payload: {
        expectedRevision: sourceAfterRestart.project.revision,
        expectedLifecycleRevision: sourceAfterRestart.project.lifecycleRevision,
        idempotencyKey: `trash:${randomUUID()}`,
        reason: "backup-policy-independence",
      },
    });
    expect(trashed.statusCode, trashed.body).toBe(200);

    const restorePayload = {
      name: "Recovered Copy",
      slug: `recovered-copy-${randomUUID().slice(0, 8)}`,
      idempotencyKey: `restore:${randomUUID()}`,
    };
    const restoredResponse = await app.inject({
      method: "POST",
      url: `/api/v1/backups/${backup.id}/restore`,
      payload: restorePayload,
    });
    expect(restoredResponse.statusCode, restoredResponse.body).toBe(201);
    const restored = (
      restoredResponse.json() as { restored: ProjectBackupRestoreDto }
    ).restored;
    expect(restored).toMatchObject({
      backup: { id: backup.id },
      project: { name: "Recovered Copy", lifecycleStatus: "ACTIVE" },
      sourcePayloadChecksum: backup.payloadChecksum,
      restoredFileCount: backup.fileCount,
    });
    expect(restored.project.id).not.toBe(source.project.id);
    const restoreReplay = await app.inject({
      method: "POST",
      url: `/api/v1/backups/${backup.id}/restore`,
      payload: restorePayload,
    });
    expect(restoreReplay.statusCode, restoreReplay.body).toBe(201);
    expect(restoreReplay.json()).toEqual(restoredResponse.json());

    for (const environment of ["test", "production"] as const) {
      const database = new Database(
        join(
          first.storageRoot,
          "active",
          restored.project.id,
          `${environment}.sqlite`,
        ),
        { readonly: true },
      );
      try {
        expect(
          database
            .prepare("SELECT value FROM recovery_measurements WHERE id = 1")
            .get(),
        ).toEqual({ value: `${environment}-sentinel-value` });
        expect(
          database
            .prepare(
              "SELECT project_id, sentinel FROM webeditor_runtime_metadata",
            )
            .get(),
        ).toEqual({
          project_id: restored.project.id,
          sentinel: `${restored.project.id}:${environment}:v1`,
        });
      } finally {
        database.close();
      }
    }
    expect(
      readFileSync(
        join(
          first.storageRoot,
          "active",
          restored.project.id,
          "assets",
          "reports",
          "sentinel.txt",
        ),
        "utf8",
      ),
    ).toBe("backup-asset-sentinel");

    const sourceRuntime = await app.inject({
      method: "GET",
      url: `/api/v1/runtime/${source.project.id}/navigation`,
    });
    expect(sourceRuntime.statusCode).toBe(409);
    expect(sourceRuntime.json()).toMatchObject({
      error: { code: "PROJECT_NOT_ACTIVE" },
    });
    const restoredRuntime = await app.inject({
      method: "GET",
      url: `/api/v1/runtime/${restored.project.id}/navigation`,
    });
    expect(restoredRuntime.statusCode, restoredRuntime.body).toBe(200);
    expect(restoredRuntime.json()).toMatchObject({
      projectId: restored.project.id,
      pages: [{ name: source.page.name, route: source.page.route }],
    });
    const recycle = await app.inject({
      method: "GET",
      url: "/api/v1/recycle-bin/projects",
    });
    expect(recycle.json()).toMatchObject({
      projects: [{ id: source.project.id, lifecycleStatus: "TRASHED" }],
    });
    const trashedProject = (recycle.json() as { projects: ProjectDto[] })
      .projects[0];
    const purgePlan = await app.inject({
      method: "POST",
      url: `/api/v1/recycle-bin/projects/${source.project.id}/purge-plan`,
      payload: {
        expectedLifecycleRevision: trashedProject?.lifecycleRevision,
      },
    });
    expect(purgePlan.statusCode, purgePlan.body).toBe(200);
    expect(purgePlan.json()).toMatchObject({
      plan: { impact: { hasBackup: true } },
    });
    const ready = await app.inject({ method: "GET", url: "/api/v1/ready" });
    expect(ready.statusCode, ready.body).toBe(200);
    expect(ready.json()).toMatchObject({
      checks: { backupStorage: "ready" },
    });
  });

  it("recovers a pending durable backup command with its audit evidence after restart", async () => {
    const first = fixture();
    const source = await createPublishedProject(first.app);
    const created = await first.app.inject({
      method: "POST",
      url: `/api/v1/projects/${source.project.id}/backups`,
      payload: {
        expectedRevision: source.project.revision,
        idempotencyKey: `backup:${randomUUID()}`,
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const backup = (created.json() as { backup: ProjectBackupDto }).backup;
    await close(first.app);

    const metadata = new Database(first.metadataDatabasePath);
    try {
      metadata.exec("PRAGMA foreign_keys = ON");
      metadata
        .prepare(
          `UPDATE backup_commands
           SET status = 'PENDING', response_status = NULL,
               response_json = NULL, completed_at = NULL
           WHERE backup_id = ? AND operation_type = 'CREATE'`,
        )
        .run(backup.id);
      metadata
        .prepare(
          "DELETE FROM audit_logs WHERE action = 'PROJECT_BACKUP_CREATED' AND object_id = ?",
        )
        .run(backup.id);
      metadata
        .prepare("DELETE FROM project_backups WHERE id = ?")
        .run(backup.id);
    } finally {
      metadata.close();
    }

    const recovered = fixture(first.directory);
    const listed = await recovered.app.inject({
      method: "GET",
      url: "/api/v1/backups",
    });
    expect(listed.statusCode, listed.body).toBe(200);
    expect(listed.json()).toMatchObject({
      backups: [{ id: backup.id, status: "VERIFIED" }],
    });

    const evidence = new Database(first.metadataDatabasePath, {
      readonly: true,
    });
    try {
      expect(
        evidence
          .prepare(
            `SELECT status, response_status
             FROM backup_commands
             WHERE backup_id = ? AND operation_type = 'CREATE'`,
          )
          .get(backup.id),
      ).toEqual({ status: "COMPLETED", response_status: 201 });
      expect(
        evidence
          .prepare(
            `SELECT count(*) AS count
             FROM audit_logs
             WHERE action = 'PROJECT_BACKUP_CREATED' AND object_id = ?`,
          )
          .get(backup.id),
      ).toEqual({ count: 1 });
    } finally {
      evidence.close();
    }
  });

  it("fails closed when a stored backup payload is tampered and replays the same verification failure", async () => {
    const current = fixture();
    const source = await createPublishedProject(current.app);
    const created = await current.app.inject({
      method: "POST",
      url: `/api/v1/projects/${source.project.id}/backups`,
      payload: {
        expectedRevision: source.project.revision,
        idempotencyKey: `backup:${randomUUID()}`,
      },
    });
    const backup = (created.json() as { backup: ProjectBackupDto }).backup;
    const payloadPath = join(
      current.storageRoot,
      "backups",
      "project-backups",
      source.project.id,
      backup.id,
      "project-export.json",
    );
    writeFileSync(payloadPath, `${readFileSync(payloadPath, "utf8")} `);
    const verifyPayload = { idempotencyKey: `verify:${randomUUID()}` };
    const invalid = await current.app.inject({
      method: "POST",
      url: `/api/v1/backups/${backup.id}/verify`,
      payload: verifyPayload,
    });
    expect(invalid.statusCode).toBe(409);
    expect(invalid.json()).toMatchObject({
      error: { code: "BACKUP_PAYLOAD_CHECKSUM_MISMATCH" },
    });
    const replay = await current.app.inject({
      method: "POST",
      url: `/api/v1/backups/${backup.id}/verify`,
      payload: verifyPayload,
    });
    expect(replay.statusCode).toBe(409);
    expect(replay.json()).toEqual(invalid.json());
    const list = await current.app.inject({
      method: "GET",
      url: "/api/v1/backups",
    });
    expect(list.json()).toMatchObject({
      backups: [{ id: backup.id, status: "INVALID" }],
    });
    const restore = await current.app.inject({
      method: "POST",
      url: `/api/v1/backups/${backup.id}/restore`,
      payload: { idempotencyKey: `restore:${randomUUID()}` },
    });
    expect(restore.statusCode).toBe(409);
    expect(restore.json()).toMatchObject({
      error: { code: "BACKUP_NOT_VERIFIED" },
    });
  });
});
