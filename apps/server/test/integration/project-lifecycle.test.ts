import { createHash, randomUUID } from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";

import Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { buildServer } from "../../src/app.js";
import type { LifecycleFailurePoint } from "../../src/projects/project-storage.js";

interface Fixture {
  readonly directory: string;
  readonly databasePath: string;
  readonly storageRoot: string;
}

interface ProjectResponse {
  readonly project: {
    readonly id: string;
    readonly name: string;
    readonly slug: string;
    readonly revision: number;
    readonly lifecycleRevision: number;
    readonly lifecycleStatus: string;
    readonly counts: { readonly assets: number };
  };
}

interface ProjectExportResponse {
  readonly export: {
    readonly format: string;
    readonly project: Record<string, unknown>;
    readonly manifest: Record<string, unknown>;
    readonly files: readonly {
      readonly path: string;
      readonly sha256: string;
      readonly contentBase64: string;
    }[];
  };
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
  const directory = mkdtempSync(join(tmpdir(), "webeditor-lifecycle-"));
  directories.push(directory);
  return {
    directory,
    databasePath: join(directory, "metadata", "webeditor.sqlite"),
    storageRoot: join(directory, "projects"),
  };
}

function server(
  current: Fixture,
  failure?: (point: LifecycleFailurePoint) => void,
): FastifyInstance {
  const app = buildServer({
    metadataDatabasePath: current.databasePath,
    storageRoot: current.storageRoot,
    ...(failure === undefined ? {} : { failureInjector: failure }),
  });
  openApps.push(app);
  return app;
}

async function close(app: FastifyInstance): Promise<void> {
  const index = openApps.indexOf(app);
  if (index >= 0) {
    openApps.splice(index, 1);
  }
  await app.close();
}

async function createProject(
  app: FastifyInstance,
  name = "Survey Analysis",
  slug = "survey-analysis",
): Promise<ProjectResponse["project"]> {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/projects",
    payload: {
      name,
      slug,
      description: "Phase 3 fixture",
      themeId: "light-clean-paper",
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  return (response.json() as ProjectResponse).project;
}

async function trashProject(
  app: FastifyInstance,
  project: ProjectResponse["project"],
  idempotencyKey = `trash-${project.id}`,
) {
  return app.inject({
    method: "POST",
    url: `/api/v1/projects/${project.id}/trash`,
    payload: {
      expectedRevision: project.revision,
      expectedLifecycleRevision: project.lifecycleRevision,
      idempotencyKey,
      reason: "integration-test",
    },
  });
}

function storageChecksum(root: string): string {
  const files: {
    readonly path: string;
    readonly hash: string;
    readonly size: number;
  }[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const stats = lstatSync(path);
      if (stats.isDirectory()) {
        visit(path);
      } else if (stats.isFile() && entry.name !== "trash-manifest.json") {
        const content = readFileSync(path);
        files.push({
          path: relative(root, path).replaceAll(sep, "/"),
          hash: createHash("sha256").update(content).digest("hex"),
          size: stats.size,
        });
      }
    }
  };
  visit(root);
  return createHash("sha256")
    .update(
      files
        .sort((left, right) => left.path.localeCompare(right.path))
        .map((file) => `${file.path}\0${file.hash}\0${file.size}\n`)
        .join(""),
    )
    .digest("hex");
}

describe("project lifecycle API", () => {
  it("implements CRUD, active-only listing, clone, export, import, and revision conflicts", async () => {
    const current = fixture();
    const app = server(current);
    const created = await createProject(app);

    expect(created).toMatchObject({
      lifecycleStatus: "ACTIVE",
      lifecycleRevision: 0,
      revision: 1,
      counts: { assets: 0 },
    });
    expect(created).not.toHaveProperty("currentStoragePath");
    expect(
      existsSync(
        join(
          current.storageRoot,
          "active",
          created.id,
          "project-manifest.json",
        ),
      ),
    ).toBe(true);
    expect(
      existsSync(
        join(current.storageRoot, "active", created.id, "test.sqlite"),
      ),
    ).toBe(true);
    expect(
      existsSync(
        join(current.storageRoot, "active", created.id, "production.sqlite"),
      ),
    ).toBe(true);

    const listed = await app.inject({
      method: "GET",
      url: "/api/v1/projects?q=survey",
    });
    expect(listed.statusCode).toBe(200);
    expect((listed.json() as { projects: unknown[] }).projects).toHaveLength(1);

    const patched = await app.inject({
      method: "PATCH",
      url: `/api/v1/projects/${created.id}`,
      payload: {
        expectedRevision: 1,
        name: "Survey Analysis 2026",
        favorite: true,
      },
    });
    expect(patched.statusCode, patched.body).toBe(200);
    expect((patched.json() as ProjectResponse).project).toMatchObject({
      name: "Survey Analysis 2026",
      revision: 2,
      lifecycleRevision: 0,
    });

    const stale = await app.inject({
      method: "PATCH",
      url: `/api/v1/projects/${created.id}`,
      payload: { expectedRevision: 1, name: "Stale update" },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({
      error: {
        code: "REVISION_CONFLICT",
        details: { latest: { revision: 2 } },
      },
    });

    const exported = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${created.id}/export`,
    });
    expect(exported.statusCode).toBe(200);
    const exportPayload = exported.json() as ProjectExportResponse;
    expect(exportPayload.export.files).toHaveLength(3);

    const cloned = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${created.id}/clone`,
      payload: { name: "Cloned Survey", slug: "cloned-survey" },
    });
    expect(cloned.statusCode, cloned.body).toBe(201);
    expect((cloned.json() as ProjectResponse).project.id).not.toBe(created.id);

    const importedFiles = exportPayload.export.files.map((file) => {
      if (file.path !== "project-manifest.json") {
        return file;
      }
      const compromisedManifest = {
        ...(JSON.parse(
          Buffer.from(file.contentBase64, "base64").toString("utf8"),
        ) as Record<string, unknown>),
        manifestVersion: 99,
        runtimeDatabases: ["attacker.sqlite"],
        assetDirectory: "../../outside",
      };
      const content = Buffer.from(
        `${JSON.stringify(compromisedManifest, null, 2)}\n`,
      );
      return {
        ...file,
        sha256: createHash("sha256").update(content).digest("hex"),
        contentBase64: content.toString("base64"),
      };
    });
    const imported = await app.inject({
      method: "POST",
      url: "/api/v1/projects/import",
      payload: {
        export: { ...exportPayload.export, files: importedFiles },
        name: "Imported Survey",
        slug: "imported-survey",
      },
    });
    expect(imported.statusCode, imported.body).toBe(201);
    const importedProject = (imported.json() as ProjectResponse).project;
    expect(importedProject).toMatchObject({
      name: "Imported Survey",
      slug: "imported-survey",
    });
    expect(
      JSON.parse(
        readFileSync(
          join(
            current.storageRoot,
            "active",
            importedProject.id,
            "project-manifest.json",
          ),
          "utf8",
        ),
      ),
    ).toMatchObject({
      manifestVersion: 1,
      runtimeDatabases: ["test.sqlite", "production.sqlite"],
      assetDirectory: "assets",
    });
  });

  it("atomically regenerates active and trash manifests from authoritative metadata", async () => {
    const current = fixture();
    let app = server(current);
    const project = await createProject(
      app,
      "Manifest Source",
      "manifest-source",
    );
    const projectManifestPath = join(
      current.storageRoot,
      "active",
      project.id,
      "project-manifest.json",
    );
    const compromisedManifest = {
      ...(JSON.parse(readFileSync(projectManifestPath, "utf8")) as Record<
        string,
        unknown
      >),
      name: "filesystem-ahead",
      manifestVersion: 99,
      runtimeDatabases: ["attacker.sqlite"],
      assetDirectory: "../../outside",
    };
    writeFileSync(
      projectManifestPath,
      `${JSON.stringify(compromisedManifest, null, 2)}\n`,
      "utf8",
    );
    await close(app);

    app = server(current);
    expect(JSON.parse(readFileSync(projectManifestPath, "utf8"))).toMatchObject(
      {
        projectId: project.id,
        name: "Manifest Source",
        slug: "manifest-source",
        manifestVersion: 1,
        runtimeDatabases: ["test.sqlite", "production.sqlite"],
        assetDirectory: "assets",
      },
    );
    const trashedResponse = await trashProject(app, project);
    expect(trashedResponse.statusCode).toBe(200);
    const trashManifestPath = join(
      current.storageRoot,
      "trash",
      project.id,
      "trash-manifest.json",
    );
    writeFileSync(trashManifestPath, "{truncated", "utf8");
    await close(app);

    server(current);
    expect(JSON.parse(readFileSync(trashManifestPath, "utf8"))).toMatchObject({
      manifestVersion: 1,
      projectId: project.id,
      originalSlug: "manifest-source",
    });
  });

  it("replays identical lifecycle requests, rejects payload changes, and restores byte-identically after restart", async () => {
    const current = fixture();
    let app = server(current);
    const project = await createProject(app);
    const activePath = join(current.storageRoot, "active", project.id);
    const originalChecksum = storageChecksum(activePath);
    const idempotencyKey = `trash-roundtrip-${project.id}`;

    const trashedResponse = await trashProject(app, project, idempotencyKey);
    expect(trashedResponse.statusCode, trashedResponse.body).toBe(200);
    const trashed = (trashedResponse.json() as ProjectResponse).project;
    expect(trashed).toMatchObject({
      lifecycleStatus: "TRASHED",
      lifecycleRevision: 2,
    });
    expect(existsSync(activePath)).toBe(false);
    expect(existsSync(join(current.storageRoot, "trash", project.id))).toBe(
      true,
    );

    const replay = await trashProject(app, project, idempotencyKey);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(trashedResponse.json());
    const payloadConflict = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/trash`,
      payload: {
        expectedRevision: project.revision,
        expectedLifecycleRevision: project.lifecycleRevision,
        idempotencyKey,
        reason: "different-reason",
      },
    });
    expect(payloadConflict.statusCode).toBe(409);
    expect(payloadConflict.json()).toMatchObject({
      error: { code: "IDEMPOTENCY_PAYLOAD_CONFLICT" },
    });

    await close(app);
    app = server(current);
    const recycle = await app.inject({
      method: "GET",
      url: "/api/v1/recycle-bin/projects",
    });
    expect((recycle.json() as { projects: unknown[] }).projects).toHaveLength(
      1,
    );
    expect(
      (await app.inject({ method: "GET", url: "/api/v1/projects" })).json(),
    ).toEqual({
      projects: [],
    });

    const restoredResponse = await app.inject({
      method: "POST",
      url: `/api/v1/recycle-bin/projects/${project.id}/restore`,
      payload: {
        expectedLifecycleRevision: trashed.lifecycleRevision,
        idempotencyKey: `restore-roundtrip-${project.id}`,
        conflictResolution: "KEEP_ORIGINAL",
      },
    });
    expect(restoredResponse.statusCode, restoredResponse.body).toBe(200);
    expect((restoredResponse.json() as ProjectResponse).project).toMatchObject({
      id: project.id,
      lifecycleStatus: "ACTIVE",
      lifecycleRevision: 4,
    });
    expect(storageChecksum(activePath)).toBe(originalChecksum);
    expect(existsSync(join(current.storageRoot, "trash", project.id))).toBe(
      false,
    );

    const database = new Database(current.databasePath, { readonly: true });
    expect(
      database
        .prepare(
          "SELECT operation_type, status FROM project_lifecycle_operations ORDER BY started_at",
        )
        .all(),
    ).toEqual([
      { operation_type: "TRASH", status: "COMPLETED" },
      { operation_type: "RESTORE", status: "COMPLETED" },
    ]);
    expect(
      (
        database.prepare("SELECT count(*) AS count FROM audit_logs").get() as {
          count: number;
        }
      ).count,
    ).toBeGreaterThanOrEqual(3);
    database.close();
  });

  it("resolves restore name and slug conflicts explicitly without overwriting active data", async () => {
    const current = fixture();
    const app = server(current);
    const original = await createProject(app, "Original", "original");
    const trashedResponse = await trashProject(app, original);
    const trashed = (trashedResponse.json() as ProjectResponse).project;
    const replacement = await createProject(app, "Original", "original");

    const keepOriginal = await app.inject({
      method: "POST",
      url: `/api/v1/recycle-bin/projects/${original.id}/restore`,
      payload: {
        expectedLifecycleRevision: trashed.lifecycleRevision,
        idempotencyKey: `restore-keep-${original.id}`,
        conflictResolution: "KEEP_ORIGINAL",
      },
    });
    expect(keepOriginal.statusCode).toBe(409);
    expect(keepOriginal.json()).toMatchObject({
      error: { code: "PROJECT_IDENTITY_CONFLICT" },
    });

    const restored = await app.inject({
      method: "POST",
      url: `/api/v1/recycle-bin/projects/${original.id}/restore`,
      payload: {
        expectedLifecycleRevision: trashed.lifecycleRevision,
        idempotencyKey: `restore-new-identity-${original.id}`,
        conflictResolution: "NEW_SLUG",
        name: "Restored Original",
        slug: "restored-original",
      },
    });
    expect(restored.statusCode, restored.body).toBe(200);
    expect((restored.json() as ProjectResponse).project).toMatchObject({
      id: original.id,
      name: "Restored Original",
      slug: "restored-original",
    });
    const replacementResponse = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${replacement.id}`,
    });
    expect(
      (replacementResponse.json() as ProjectResponse).project,
    ).toMatchObject({
      name: "Original",
      slug: "original",
    });
  });

  it("compensates interrupted trash and restore operations on startup without partial identity changes", async () => {
    const current = fixture();
    let failurePoint: LifecycleFailurePoint | undefined;
    const failure = (point: LifecycleFailurePoint): void => {
      if (point === failurePoint) {
        failurePoint = undefined;
        throw new Error(`injected:${point}`);
      }
    };
    let app = server(current, failure);
    const project = await createProject(app, "Recovery", "recovery");
    failurePoint = "trash:after-move";
    const interruptedTrash = await trashProject(
      app,
      project,
      `trash-failure-${project.id}`,
    );
    expect(interruptedTrash.statusCode, interruptedTrash.body).toBe(200);
    expect(
      (interruptedTrash.json() as ProjectResponse).project.lifecycleStatus,
    ).toBe("TRASHED");
    const interruptedTrashReplay = await trashProject(
      app,
      project,
      `trash-failure-${project.id}`,
    );
    expect(interruptedTrashReplay.statusCode).toBe(200);
    expect(interruptedTrashReplay.json()).toEqual(interruptedTrash.json());
    await close(app);

    app = server(current);
    const recoveredTrash = await app.inject({
      method: "GET",
      url: `/api/v1/recycle-bin/projects/${project.id}`,
    });
    expect((recoveredTrash.json() as ProjectResponse).project).toMatchObject({
      lifecycleStatus: "TRASHED",
      name: "Recovery",
      slug: "recovery",
    });
    const trashed = (recoveredTrash.json() as ProjectResponse).project;
    await close(app);

    app = server(current, failure);
    failurePoint = "restore:before-move";
    const interruptedRestore = await app.inject({
      method: "POST",
      url: `/api/v1/recycle-bin/projects/${project.id}/restore`,
      payload: {
        expectedLifecycleRevision: trashed.lifecycleRevision,
        idempotencyKey: `restore-failure-${project.id}`,
        conflictResolution: "NEW_SLUG",
        name: "Should Not Persist",
        slug: "should-not-persist",
      },
    });
    expect(interruptedRestore.statusCode).toBe(500);
    await close(app);

    app = server(current);
    const compensated = await app.inject({
      method: "GET",
      url: `/api/v1/recycle-bin/projects/${project.id}`,
    });
    expect((compensated.json() as ProjectResponse).project).toMatchObject({
      lifecycleStatus: "TRASHED",
      name: "Recovery",
      slug: "recovery",
      revision: project.revision,
    });
    const compensatedProject = (compensated.json() as ProjectResponse).project;
    await close(app);

    app = server(current, failure);
    failurePoint = "restore:after-move";
    const interruptedAfterMove = await app.inject({
      method: "POST",
      url: `/api/v1/recycle-bin/projects/${project.id}/restore`,
      payload: {
        expectedLifecycleRevision: compensatedProject.lifecycleRevision,
        idempotencyKey: `restore-after-move-${project.id}`,
        conflictResolution: "NEW_SLUG",
        name: "Recovered Identity",
        slug: "recovered-identity",
      },
    });
    expect(interruptedAfterMove.statusCode, interruptedAfterMove.body).toBe(
      200,
    );
    expect(
      (interruptedAfterMove.json() as ProjectResponse).project.lifecycleStatus,
    ).toBe("ACTIVE");
    const interruptedAfterMoveReplay = await app.inject({
      method: "POST",
      url: `/api/v1/recycle-bin/projects/${project.id}/restore`,
      payload: {
        expectedLifecycleRevision: compensatedProject.lifecycleRevision,
        idempotencyKey: `restore-after-move-${project.id}`,
        conflictResolution: "NEW_SLUG",
        name: "Recovered Identity",
        slug: "recovered-identity",
      },
    });
    expect(interruptedAfterMoveReplay.statusCode).toBe(200);
    expect(interruptedAfterMoveReplay.json()).toEqual(
      interruptedAfterMove.json(),
    );
    await close(app);

    app = server(current);
    const finalizedAfterMove = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${project.id}`,
    });
    expect(
      (finalizedAfterMove.json() as ProjectResponse).project,
    ).toMatchObject({
      lifecycleStatus: "ACTIVE",
      name: "Recovered Identity",
      slug: "recovered-identity",
    });
    expect(
      JSON.parse(
        readFileSync(
          join(
            current.storageRoot,
            "active",
            project.id,
            "project-manifest.json",
          ),
          "utf8",
        ),
      ),
    ).toMatchObject({
      name: "Recovered Identity",
      slug: "recovered-identity",
    });
  });

  it("immediately compensates a pre-move trash failure without hiding the project", async () => {
    const current = fixture();
    let failBeforeMove = false;
    const app = server(current, (point) => {
      if (point === "trash:before-move" && failBeforeMove) {
        failBeforeMove = false;
        throw new Error("injected pre-move trash failure");
      }
    });
    const project = await createProject(
      app,
      "Visible Recovery",
      "visible-recovery",
    );
    failBeforeMove = true;
    const failed = await trashProject(
      app,
      project,
      `trash-visible-${project.id}`,
    );
    expect(failed.statusCode).toBe(500);
    const failedReplay = await trashProject(
      app,
      project,
      `trash-visible-${project.id}`,
    );
    expect(failedReplay.statusCode).toBe(failed.statusCode);
    expect(failedReplay.json()).toEqual(failed.json());
    const changedReplay = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/trash`,
      payload: {
        expectedRevision: project.revision,
        expectedLifecycleRevision: project.lifecycleRevision,
        idempotencyKey: `trash-visible-${project.id}`,
        reason: "changed-payload",
      },
    });
    expect(changedReplay.statusCode).toBe(409);
    expect(changedReplay.json()).toMatchObject({
      error: { code: "IDEMPOTENCY_PAYLOAD_CONFLICT" },
    });

    const active = await app.inject({ method: "GET", url: "/api/v1/projects" });
    expect(
      (active.json() as { projects: ProjectResponse["project"][] }).projects,
    ).toHaveLength(1);
    expect(
      (active.json() as { projects: ProjectResponse["project"][] }).projects[0],
    ).toMatchObject({ id: project.id, lifecycleStatus: "ACTIVE" });
    const recycle = await app.inject({
      method: "GET",
      url: "/api/v1/recycle-bin/projects",
    });
    expect(recycle.json()).toEqual({ projects: [] });
    const ready = await app.inject({ method: "GET", url: "/api/v1/ready" });
    expect(ready.statusCode, ready.body).toBe(200);
  });

  it("gates purge with a short plan and exact name, compensates failure, and retries safely", async () => {
    const current = fixture();
    let failurePoint: LifecycleFailurePoint | undefined;
    const failure = (point: LifecycleFailurePoint): void => {
      if (point === failurePoint) {
        failurePoint = undefined;
        throw new Error(`injected:${point}`);
      }
    };
    const app = server(current, failure);
    const project = await createProject(app, "Purge Fixture", "purge-fixture");
    const trashedResponse = await trashProject(app, project);
    const trashed = (trashedResponse.json() as ProjectResponse).project;
    const trashPath = join(current.storageRoot, "trash", project.id);
    const checksumBeforePurge = storageChecksum(trashPath);

    const planResponse = await app.inject({
      method: "POST",
      url: `/api/v1/recycle-bin/projects/${project.id}/purge-plan`,
      payload: { expectedLifecycleRevision: trashed.lifecycleRevision },
    });
    expect(planResponse.statusCode, planResponse.body).toBe(200);
    const plan = (planResponse.json() as { plan: Record<string, unknown> })
      .plan;
    expect(plan).toMatchObject({
      purgePlanId: expect.any(String),
      typedConfirmation: "Purge Fixture",
      metadataRecordCount: expect.any(Number),
      fileCount: expect.any(Number),
      blockers: [],
    });

    const wrongConfirmation = await app.inject({
      method: "DELETE",
      url: `/api/v1/recycle-bin/projects/${project.id}`,
      payload: {
        purgePlanId: plan.purgePlanId,
        expectedLifecycleRevision: trashed.lifecycleRevision,
        typedConfirmation: "purge fixture",
        idempotencyKey: `purge-wrong-${project.id}`,
        backupBeforePurge: false,
      },
    });
    expect(wrongConfirmation.statusCode).toBe(400);

    failurePoint = "purge:after-runtime-databases";
    const failedPurge = await app.inject({
      method: "DELETE",
      url: `/api/v1/recycle-bin/projects/${project.id}`,
      payload: {
        purgePlanId: plan.purgePlanId,
        expectedLifecycleRevision: trashed.lifecycleRevision,
        typedConfirmation: "Purge Fixture",
        idempotencyKey: `purge-failure-${project.id}`,
        backupBeforePurge: false,
      },
    });
    expect(failedPurge.statusCode).toBe(500);
    expect(existsSync(trashPath)).toBe(true);
    expect(storageChecksum(trashPath)).toBe(checksumBeforePurge);
    const afterFailure = await app.inject({
      method: "GET",
      url: `/api/v1/recycle-bin/projects/${project.id}`,
    });
    const failedProject = (afterFailure.json() as ProjectResponse).project;
    expect(failedProject.lifecycleStatus).toBe("PURGE_FAILED");

    const retryPlanResponse = await app.inject({
      method: "POST",
      url: `/api/v1/recycle-bin/projects/${project.id}/purge-plan`,
      payload: { expectedLifecycleRevision: failedProject.lifecycleRevision },
    });
    const retryPlan = (
      retryPlanResponse.json() as { plan: Record<string, unknown> }
    ).plan;
    const retryPayload = {
      purgePlanId: retryPlan.purgePlanId,
      expectedLifecycleRevision: failedProject.lifecycleRevision,
      typedConfirmation: "Purge Fixture",
      idempotencyKey: `purge-retry-${project.id}`,
      backupBeforePurge: false,
    };
    const purged = await app.inject({
      method: "DELETE",
      url: `/api/v1/recycle-bin/projects/${project.id}`,
      payload: retryPayload,
    });
    expect(purged.statusCode, purged.body).toBe(200);
    expect(purged.json()).toMatchObject({
      tombstone: { projectId: project.id, backupRetained: false },
    });
    expect(existsSync(trashPath)).toBe(false);
    expect(
      (
        await app.inject({ method: "GET", url: "/api/v1/recycle-bin/projects" })
      ).json(),
    ).toEqual({ projects: [] });

    const purgeReplay = await app.inject({
      method: "DELETE",
      url: `/api/v1/recycle-bin/projects/${project.id}`,
      payload: retryPayload,
    });
    expect(purgeReplay.statusCode).toBe(200);
    expect(purgeReplay.json()).toEqual(purged.json());
  });

  it("never replaces intact trash with an unverified partial purge recovery copy", async () => {
    const current = fixture();
    let failurePoint: LifecycleFailurePoint | undefined;
    const failure = (point: LifecycleFailurePoint): void => {
      if (point !== failurePoint) {
        return;
      }
      failurePoint = undefined;
      const recoveryRoot = join(current.storageRoot, ".lifecycle-recovery");
      const recoveryDirectory = readdirSync(recoveryRoot, {
        withFileTypes: true,
      }).find((entry) => entry.isDirectory());
      if (recoveryDirectory !== undefined) {
        rmSync(
          join(recoveryRoot, recoveryDirectory.name, "production.sqlite"),
          {
            force: true,
          },
        );
      }
      throw new Error(`injected:${point}`);
    };
    const app = server(current, failure);
    const project = await createProject(app, "Partial Purge", "partial-purge");
    const trashedResponse = await trashProject(app, project);
    const trashed = (trashedResponse.json() as ProjectResponse).project;
    const trashPath = join(current.storageRoot, "trash", project.id);
    const intactChecksum = storageChecksum(trashPath);
    const planResponse = await app.inject({
      method: "POST",
      url: `/api/v1/recycle-bin/projects/${project.id}/purge-plan`,
      payload: { expectedLifecycleRevision: trashed.lifecycleRevision },
    });
    const plan = (planResponse.json() as { plan: { purgePlanId: string } })
      .plan;

    failurePoint = "purge:before-recovery-verification";
    const response = await app.inject({
      method: "DELETE",
      url: `/api/v1/recycle-bin/projects/${project.id}`,
      payload: {
        purgePlanId: plan.purgePlanId,
        expectedLifecycleRevision: trashed.lifecycleRevision,
        typedConfirmation: "Partial Purge",
        idempotencyKey: `partial-purge-${project.id}`,
        backupBeforePurge: false,
      },
    });
    expect(response.statusCode).toBe(500);
    expect(existsSync(trashPath)).toBe(true);
    expect(storageChecksum(trashPath)).toBe(intactChecksum);
    expect(
      readdirSync(join(current.storageRoot, ".lifecycle-recovery")),
    ).toEqual([]);
    const recycleDetail = await app.inject({
      method: "GET",
      url: `/api/v1/recycle-bin/projects/${project.id}`,
    });
    expect(
      (recycleDetail.json() as ProjectResponse).project.lifecycleStatus,
    ).toBe("PURGE_FAILED");
  });

  it("audits a crash-interrupted purge during startup compensation", async () => {
    const current = fixture();
    let app = server(current);
    const project = await createProject(app, "Startup Purge", "startup-purge");
    const trashedResponse = await trashProject(app, project);
    const trashed = (trashedResponse.json() as ProjectResponse).project;
    await close(app);

    const operationId = randomUUID();
    const metadata = new Database(current.databasePath);
    metadata.transaction(() => {
      metadata
        .prepare(
          `UPDATE projects SET lifecycle_status = 'PURGING',
             lifecycle_revision = lifecycle_revision + 1 WHERE id = ?`,
        )
        .run(project.id);
      metadata
        .prepare(
          `INSERT INTO project_lifecycle_operations (
            id, project_id, operation_type, from_status, to_status,
            idempotency_key, request_hash, storage_from, storage_to,
            status, started_at
          ) VALUES (?, ?, 'PURGE', 'TRASHED', 'PURGED', ?, ?, ?, NULL,
            'PENDING', ?)`,
        )
        .run(
          operationId,
          project.id,
          `startup-purge-${project.id}`,
          "0".repeat(64),
          `trash/${project.id}`,
          new Date().toISOString(),
        );
    })();
    metadata.close();

    app = server(current);
    const recovered = await app.inject({
      method: "GET",
      url: `/api/v1/recycle-bin/projects/${project.id}`,
    });
    expect((recovered.json() as ProjectResponse).project).toMatchObject({
      lifecycleStatus: "PURGE_FAILED",
      lifecycleRevision: trashed.lifecycleRevision + 2,
    });
    const auditDatabase = new Database(current.databasePath, {
      readonly: true,
    });
    expect(
      auditDatabase
        .prepare(
          "SELECT action, correlation_id FROM audit_logs WHERE correlation_id = ?",
        )
        .get(operationId),
    ).toEqual({
      action: "PROJECT_PURGE_COMPENSATED",
      correlation_id: operationId,
    });
    auditDatabase.close();
  });

  it("removes a partial cross-volume destination and recovers the intact source", async () => {
    const current = fixture();
    const projectReference: { id?: string } = {};
    let forceCrossVolume = false;
    let failCopy = false;
    const failure = (point: LifecycleFailurePoint): void => {
      if (point === "storage:before-rename" && forceCrossVolume) {
        forceCrossVolume = false;
        throw Object.assign(new Error("simulated cross-volume move"), {
          code: "EXDEV",
        });
      }
      const copyingProjectId = projectReference.id;
      if (
        point === "storage:during-cross-volume-copy" &&
        failCopy &&
        copyingProjectId !== undefined
      ) {
        failCopy = false;
        const trashRoot = join(current.storageRoot, "trash");
        const incoming = readdirSync(trashRoot, {
          withFileTypes: true,
        }).find(
          (entry) =>
            entry.isDirectory() &&
            entry.name.startsWith(`.incoming-${copyingProjectId}-`),
        );
        if (incoming === undefined) {
          throw new Error("cross-volume staging directory was not created");
        }
        rmSync(join(trashRoot, incoming.name, "production.sqlite"), {
          force: true,
        });
        throw new Error("simulated copy failure");
      }
    };
    let app = server(current, failure);
    const project = await createProject(app, "Cross Volume", "cross-volume");
    projectReference.id = project.id;
    const activePath = join(current.storageRoot, "active", project.id);
    const sourceChecksum = storageChecksum(activePath);
    forceCrossVolume = true;
    failCopy = true;

    const response = await trashProject(
      app,
      project,
      `trash-cross-volume-${project.id}`,
    );
    expect(response.statusCode).toBe(500);
    expect(storageChecksum(activePath)).toBe(sourceChecksum);
    expect(existsSync(join(current.storageRoot, "trash", project.id))).toBe(
      false,
    );
    await close(app);

    app = server(current);
    const recovered = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${project.id}`,
    });
    expect(recovered.statusCode, recovered.body).toBe(200);
    expect((recovered.json() as ProjectResponse).project.lifecycleStatus).toBe(
      "ACTIVE",
    );
    expect(storageChecksum(activePath)).toBe(sourceChecksum);
  });

  it("finalizes a verified cross-volume trash destination after partial source cleanup and restart", async () => {
    const current = fixture();
    const projectReference: { id?: string } = {};
    const savedProductionDatabase = join(
      current.directory,
      "saved-production.sqlite",
    );
    let forceCrossVolume = false;
    let interruptSourceCleanup = false;
    const failure = (point: LifecycleFailurePoint): void => {
      if (point === "storage:before-rename" && forceCrossVolume) {
        forceCrossVolume = false;
        throw Object.assign(new Error("simulated cross-volume move"), {
          code: "EXDEV",
        });
      }
      const projectId = projectReference.id;
      if (
        point === "storage:after-cross-volume-promote" &&
        interruptSourceCleanup &&
        projectId !== undefined
      ) {
        interruptSourceCleanup = false;
        const activePath = join(current.storageRoot, "active", projectId);
        const trashPath = join(current.storageRoot, "trash", projectId);
        cpSync(join(trashPath, "production.sqlite"), savedProductionDatabase);
        rmSync(join(activePath, "test.sqlite"), { force: true });
        rmSync(join(trashPath, "production.sqlite"), { force: true });
        throw new Error("simulated process stop during source cleanup");
      }
    };
    let app = server(current, failure);
    const project = await createProject(
      app,
      "Cleanup Recovery",
      "cleanup-recovery",
    );
    projectReference.id = project.id;
    const activePath = join(current.storageRoot, "active", project.id);
    const trashPath = join(current.storageRoot, "trash", project.id);
    writeFileSync(
      join(activePath, "assets", "survey.csv"),
      "region,total\nSeoul,42\n",
      "utf8",
    );
    for (const environment of ["test", "production"] as const) {
      const runtime = new Database(join(activePath, `${environment}.sqlite`));
      runtime.exec(
        "CREATE TABLE fixture_rows (label TEXT PRIMARY KEY, value INTEGER NOT NULL)",
      );
      runtime
        .prepare("INSERT INTO fixture_rows (label, value) VALUES (?, ?)")
        .run(`${environment}-row`, 42);
      runtime.close();
    }
    const expectedChecksum = storageChecksum(activePath);
    forceCrossVolume = true;
    interruptSourceCleanup = true;

    const interrupted = await trashProject(
      app,
      project,
      `trash-cleanup-${project.id}`,
    );
    expect(interrupted.statusCode).toBe(500);
    expect(
      (await app.inject({ method: "GET", url: "/api/v1/ready" })).statusCode,
    ).toBe(503);

    cpSync(savedProductionDatabase, join(trashPath, "production.sqlite"));
    await close(app);
    app = server(current);

    expect(existsSync(activePath)).toBe(false);
    expect(existsSync(trashPath)).toBe(true);
    expect(storageChecksum(trashPath)).toBe(expectedChecksum);
    const recycle = await app.inject({
      method: "GET",
      url: "/api/v1/recycle-bin/projects",
    });
    expect(recycle.statusCode, recycle.body).toBe(200);
    expect(
      (recycle.json() as { projects: ProjectResponse["project"][] }).projects,
    ).toMatchObject([
      { id: project.id, lifecycleStatus: "TRASHED", counts: { assets: 1 } },
    ]);
    expect(
      (await app.inject({ method: "GET", url: "/api/v1/projects" })).json(),
    ).toEqual({ projects: [] });
    expect(
      (await app.inject({ method: "GET", url: "/api/v1/ready" })).statusCode,
    ).toBe(200);
    for (const environment of ["test", "production"] as const) {
      const runtime = new Database(join(trashPath, `${environment}.sqlite`), {
        readonly: true,
      });
      expect(
        runtime.prepare("SELECT label, value FROM fixture_rows").get(),
      ).toEqual({ label: `${environment}-row`, value: 42 });
      runtime.close();
    }
  });

  it("keeps atomic files destination-local and falls back across EXDEV for create, import, lifecycle, and purge", async () => {
    const current = fixture();
    let forceNextDirectoryRename = false;
    const atomicParents: string[] = [];
    const recordAtomicParents = (directory: string): void => {
      if (!existsSync(directory)) {
        return;
      }
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
          recordAtomicParents(path);
        } else if (entry.name.startsWith(".webeditor-atomic-")) {
          atomicParents.push(
            relative(current.storageRoot, directory).replaceAll(sep, "/"),
          );
        }
      }
    };
    const failure = (point: LifecycleFailurePoint): void => {
      if (point === "storage:before-atomic-file-rename") {
        recordAtomicParents(current.storageRoot);
      }
      if (point === "storage:before-rename" && forceNextDirectoryRename) {
        forceNextDirectoryRename = false;
        throw Object.assign(new Error("simulated EXDEV topology"), {
          code: "EXDEV",
        });
      }
    };
    let app = server(current, failure);

    forceNextDirectoryRename = true;
    const created = await createProject(
      app,
      "Topology Source",
      "topology-source",
    );
    expect(forceNextDirectoryRename).toBe(false);
    expect(atomicParents).toContain(`.project-creation-staging/${created.id}`);
    expect(atomicParents).toContain(".project-creation-staging");

    const exportedResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${created.id}/export`,
    });
    const exported = (exportedResponse.json() as ProjectExportResponse).export;
    forceNextDirectoryRename = true;
    const importedResponse = await app.inject({
      method: "POST",
      url: "/api/v1/projects/import",
      payload: {
        export: exported,
        name: "Topology Import",
        slug: "topology-import",
      },
    });
    expect(importedResponse.statusCode, importedResponse.body).toBe(201);
    const imported = (importedResponse.json() as ProjectResponse).project;
    expect(forceNextDirectoryRename).toBe(false);
    expect(atomicParents).toContain(`.project-creation-staging/${imported.id}`);

    forceNextDirectoryRename = true;
    const trashedResponse = await trashProject(
      app,
      created,
      `topology-trash-${created.id}`,
    );
    expect(trashedResponse.statusCode, trashedResponse.body).toBe(200);
    const trashed = (trashedResponse.json() as ProjectResponse).project;
    expect(forceNextDirectoryRename).toBe(false);
    expect(atomicParents).toContain(`trash/${created.id}`);

    forceNextDirectoryRename = true;
    const restoredResponse = await app.inject({
      method: "POST",
      url: `/api/v1/recycle-bin/projects/${created.id}/restore`,
      payload: {
        expectedLifecycleRevision: trashed.lifecycleRevision,
        conflictResolution: "RENAME",
        name: "Topology Restored",
        idempotencyKey: `topology-restore-${created.id}`,
      },
    });
    expect(restoredResponse.statusCode, restoredResponse.body).toBe(200);
    expect(forceNextDirectoryRename).toBe(false);
    expect(atomicParents).toContain(`active/${created.id}`);

    const importedTrashResponse = await trashProject(
      app,
      imported,
      `topology-import-trash-${imported.id}`,
    );
    const importedTrashed = (importedTrashResponse.json() as ProjectResponse)
      .project;
    const planResponse = await app.inject({
      method: "POST",
      url: `/api/v1/recycle-bin/projects/${imported.id}/purge-plan`,
      payload: {
        expectedLifecycleRevision: importedTrashed.lifecycleRevision,
      },
    });
    const plan = (planResponse.json() as { plan: { purgePlanId: string } })
      .plan;
    forceNextDirectoryRename = true;
    const purgeResponse = await app.inject({
      method: "DELETE",
      url: `/api/v1/recycle-bin/projects/${imported.id}`,
      payload: {
        purgePlanId: plan.purgePlanId,
        expectedLifecycleRevision: importedTrashed.lifecycleRevision,
        typedConfirmation: "Topology Import",
        idempotencyKey: `topology-purge-${imported.id}`,
        backupBeforePurge: false,
      },
    });
    expect(purgeResponse.statusCode, purgeResponse.body).toBe(200);
    expect(forceNextDirectoryRename).toBe(false);
    expect(atomicParents).toContain(".lifecycle-recovery");

    await close(app);
    app = server(current);
    expect(
      (await app.inject({ method: "GET", url: "/api/v1/ready" })).statusCode,
    ).toBe(200);
    const active = await app.inject({ method: "GET", url: "/api/v1/projects" });
    expect(
      (active.json() as { projects: ProjectResponse["project"][] }).projects,
    ).toMatchObject([{ id: created.id, lifecycleStatus: "ACTIVE" }]);
    expect(existsSync(join(current.storageRoot, "active", imported.id))).toBe(
      false,
    );
    expect(existsSync(join(current.storageRoot, "trash", imported.id))).toBe(
      false,
    );
  });

  it("removes an interrupted cross-volume purge incoming copy on restart", async () => {
    const current = fixture();
    let forcePurgeCrossVolume = false;
    let leaveInterruptedIncoming = false;
    const failure = (point: LifecycleFailurePoint): void => {
      if (point === "storage:before-rename" && forcePurgeCrossVolume) {
        forcePurgeCrossVolume = false;
        throw Object.assign(new Error("simulated purge EXDEV"), {
          code: "EXDEV",
        });
      }
      if (
        point === "storage:during-cross-volume-copy" &&
        leaveInterruptedIncoming
      ) {
        leaveInterruptedIncoming = false;
        const purgeStagingRoot = join(current.storageRoot, ".purge-staging");
        const incoming = readdirSync(purgeStagingRoot, {
          withFileTypes: true,
        }).find(
          (entry) => entry.isDirectory() && entry.name.startsWith(".incoming-"),
        );
        if (incoming === undefined) {
          throw new Error("purge incoming copy was not created");
        }
        const operationId = incoming.name.slice(
          ".incoming-".length,
          ".incoming-".length + 36,
        );
        const interruptedPath = join(
          purgeStagingRoot,
          `.incoming-${operationId}-${randomUUID()}`,
        );
        cpSync(join(purgeStagingRoot, incoming.name), interruptedPath, {
          recursive: true,
        });
        rmSync(join(interruptedPath, "production.sqlite"), { force: true });
        throw new Error("simulated process stop during purge copy");
      }
    };
    let app = server(current, failure);
    const project = await createProject(
      app,
      "Purge Incoming",
      "purge-incoming",
    );
    const trashResponse = await trashProject(app, project);
    const trashed = (trashResponse.json() as ProjectResponse).project;
    const trashPath = join(current.storageRoot, "trash", project.id);
    const expectedChecksum = storageChecksum(trashPath);
    const planResponse = await app.inject({
      method: "POST",
      url: `/api/v1/recycle-bin/projects/${project.id}/purge-plan`,
      payload: { expectedLifecycleRevision: trashed.lifecycleRevision },
    });
    const plan = (planResponse.json() as { plan: { purgePlanId: string } })
      .plan;
    forcePurgeCrossVolume = true;
    leaveInterruptedIncoming = true;
    const failedPurge = await app.inject({
      method: "DELETE",
      url: `/api/v1/recycle-bin/projects/${project.id}`,
      payload: {
        purgePlanId: plan.purgePlanId,
        expectedLifecycleRevision: trashed.lifecycleRevision,
        typedConfirmation: "Purge Incoming",
        idempotencyKey: `purge-incoming-${project.id}`,
        backupBeforePurge: false,
      },
    });
    expect(failedPurge.statusCode).toBe(500);
    const purgeStagingRoot = join(current.storageRoot, ".purge-staging");
    expect(
      readdirSync(purgeStagingRoot).some((name) =>
        name.startsWith(".incoming-"),
      ),
    ).toBe(true);
    expect(storageChecksum(trashPath)).toBe(expectedChecksum);

    await close(app);
    app = server(current);
    expect(
      readdirSync(purgeStagingRoot).filter((name) =>
        name.startsWith(".incoming-"),
      ),
    ).toEqual([]);
    const recovered = await app.inject({
      method: "GET",
      url: `/api/v1/recycle-bin/projects/${project.id}`,
    });
    expect(recovered.statusCode, recovered.body).toBe(200);
    expect((recovered.json() as ProjectResponse).project.lifecycleStatus).toBe(
      "PURGE_FAILED",
    );
    expect(storageChecksum(trashPath)).toBe(expectedChecksum);
    expect(
      (await app.inject({ method: "GET", url: "/api/v1/ready" })).statusCode,
    ).toBe(200);
  });

  it("finishes a retained purge backup on restart after post-commit cleanup failure", async () => {
    const current = fixture();
    let failurePoint: LifecycleFailurePoint | undefined;
    const failure = (point: LifecycleFailurePoint): void => {
      if (point === failurePoint) {
        failurePoint = undefined;
        throw new Error(`injected:${point}`);
      }
    };
    const app = server(current, failure);
    const project = await createProject(app, "Backup Purge", "backup-purge");
    const trashedResponse = await trashProject(app, project);
    const trashed = (trashedResponse.json() as ProjectResponse).project;
    const planResponse = await app.inject({
      method: "POST",
      url: `/api/v1/recycle-bin/projects/${project.id}/purge-plan`,
      payload: { expectedLifecycleRevision: trashed.lifecycleRevision },
    });
    const plan = (planResponse.json() as { plan: { purgePlanId: string } })
      .plan;
    failurePoint = "purge:commit-recovery";
    const purged = await app.inject({
      method: "DELETE",
      url: `/api/v1/recycle-bin/projects/${project.id}`,
      payload: {
        purgePlanId: plan.purgePlanId,
        expectedLifecycleRevision: trashed.lifecycleRevision,
        typedConfirmation: "Backup Purge",
        idempotencyKey: `purge-backup-${project.id}`,
        backupBeforePurge: true,
      },
    });
    expect(purged.statusCode, purged.body).toBe(200);
    expect(
      existsSync(
        join(current.storageRoot, "backups", project.id, plan.purgePlanId),
      ),
    ).toBe(true);
    expect(existsSync(join(current.storageRoot, ".lifecycle-recovery"))).toBe(
      true,
    );
    await close(app);

    server(current);
    expect(existsSync(join(current.storageRoot, "trash", project.id))).toBe(
      false,
    );
    expect(
      existsSync(
        join(current.storageRoot, "backups", project.id, plan.purgePlanId),
      ),
    ).toBe(true);
    const metadata = new Database(current.databasePath, { readonly: true });
    expect(
      metadata
        .prepare(
          "SELECT lifecycle_status, tombstone_checksum FROM projects WHERE id = ?",
        )
        .get(project.id),
    ).toMatchObject({
      lifecycle_status: "PURGED",
      tombstone_checksum: expect.any(String),
    });
    metadata.close();
  });

  it("rejects malformed imports, traversal paths, duplicate paths, and checksum changes as 4xx", async () => {
    const current = fixture();
    const app = server(current);
    const project = await createProject(app);
    const exportedResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/export`,
    });
    const exported = (
      exportedResponse.json() as { export: Record<string, unknown> }
    ).export;
    const files = exported.files as Record<string, unknown>[];
    const invalidReason = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/trash`,
      payload: {
        expectedRevision: project.revision,
        expectedLifecycleRevision: project.lifecycleRevision,
        idempotencyKey: `invalid-reason-${project.id}`,
        reason: null,
      },
    });
    expect(invalidReason.statusCode).toBe(400);
    expect(invalidReason.json()).toMatchObject({
      error: { code: "INVALID_TRASH_REASON" },
    });
    const largeAsset = Buffer.alloc(1_200_000, 0x5a);
    const largeAssetFile = {
      path: "assets/large-import-fixture.bin",
      sha256: createHash("sha256").update(largeAsset).digest("hex"),
      contentBase64: largeAsset.toString("base64"),
    };
    const largeImport = await app.inject({
      method: "POST",
      url: "/api/v1/projects/import",
      payload: {
        export: { ...exported, files: [...files, largeAssetFile] },
        name: "Large Import",
        slug: "large-import",
      },
    });
    expect(largeImport.statusCode, largeImport.body).toBe(201);
    expect((largeImport.json() as ProjectResponse).project.counts.assets).toBe(
      1,
    );

    const invalidLargeImport = await app.inject({
      method: "POST",
      url: "/api/v1/projects/import",
      payload: {
        export: {
          ...exported,
          files: [...files, { ...largeAssetFile, sha256: "0".repeat(64) }],
        },
        name: "Invalid Large Import",
        slug: "invalid-large-import",
      },
    });
    expect(invalidLargeImport.statusCode).toBe(400);

    const traversalResponse = await app.inject({
      method: "POST",
      url: "/api/v1/projects/import",
      payload: {
        export: {
          ...exported,
          files: [
            ...files,
            {
              path: "../escape",
              sha256: createHash("sha256").update("").digest("hex"),
              contentBase64: "",
            },
          ],
        },
        name: "Traversal Import",
        slug: "traversal-import",
      },
    });
    expect(traversalResponse.statusCode).toBe(400);
    expect(traversalResponse.json()).toMatchObject({
      error: { code: "UNSAFE_STORAGE_PATH" },
    });
    expect(existsSync(join(current.storageRoot, "escape"))).toBe(false);

    const portableContent = Buffer.from("portable-path");
    const portableFile = {
      sha256: createHash("sha256").update(portableContent).digest("hex"),
      contentBase64: portableContent.toString("base64"),
    };
    for (const [paths, errorCode] of [
      [
        ["assets/report.txt", "assets/REPORT.txt"],
        "PORTABLE_PROJECT_EXPORT_PATH_COLLISION",
      ],
      [
        ["assets/caf\u00e9.txt", "assets/cafe\u0301.txt"],
        "PORTABLE_PROJECT_EXPORT_PATH_COLLISION",
      ],
      [
        ["assets/folder", "assets/folder/child.txt"],
        "PROJECT_EXPORT_FILE_DIRECTORY_CONFLICT",
      ],
    ] as const) {
      const collision = await app.inject({
        method: "POST",
        url: "/api/v1/projects/import",
        payload: {
          export: {
            ...exported,
            files: [
              ...files,
              ...paths.map((path) => ({ path, ...portableFile })),
            ],
          },
          name: `Portable ${randomSuffix(paths.length)}`,
          slug: `portable-${randomSuffix(paths.length)}`,
        },
      });
      expect(collision.statusCode, collision.body).toBe(400);
      expect(collision.json()).toMatchObject({ error: { code: errorCode } });
    }

    for (const mutatedFiles of [
      [...files, { ...files[0] }],
      files.map((file, index) =>
        index === 0 ? { ...file, sha256: "0".repeat(64) } : file,
      ),
      files.filter((file) => file.path !== "production.sqlite"),
    ]) {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/projects/import",
        payload: {
          export: { ...exported, files: mutatedFiles },
          name: `Import ${randomSuffix(mutatedFiles.length)}`,
          slug: `import-${randomSuffix(mutatedFiles.length)}`,
        },
      });
      expect(response.statusCode, response.body).toBeGreaterThanOrEqual(400);
      expect(response.statusCode, response.body).toBeLessThan(500);
    }
  });

  it("promotes committed create staging and discards uncommitted staging during recovery", async () => {
    const current = fixture();
    let failPromotion = true;
    let app = server(current, (point) => {
      if (point === "create:before-promote" && failPromotion) {
        failPromotion = false;
        throw new Error("injected create promotion failure");
      }
    });
    const project = await createProject(app, "Staged Create", "staged-create");
    expect(failPromotion).toBe(false);
    await close(app);

    const activePath = join(current.storageRoot, "active", project.id);
    const creationRoot = join(current.storageRoot, ".project-creation-staging");
    const committedStagingPath = join(creationRoot, project.id);
    renameSync(activePath, committedStagingPath);
    writeFileSync(
      join(creationRoot, `${project.id}.verified`),
      storageChecksum(committedStagingPath),
      "utf8",
    );

    app = server(current);
    const recovered = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${project.id}`,
    });
    expect(recovered.statusCode, recovered.body).toBe(200);
    expect(existsSync(activePath)).toBe(true);
    expect(existsSync(committedStagingPath)).toBe(false);
    await close(app);

    const uncommittedId = randomUUID();
    const uncommittedStagingPath = join(creationRoot, uncommittedId);
    cpSync(activePath, uncommittedStagingPath, { recursive: true });
    app = server(current);
    expect(existsSync(uncommittedStagingPath)).toBe(false);
    const ready = await app.inject({ method: "GET", url: "/api/v1/ready" });
    expect(ready.statusCode, ready.body).toBe(200);
  });

  it("detects symlinks, dual residence, and orphan project directories before readiness", async () => {
    const namespaceFixture = fixture();
    const outsideDirectory = join(namespaceFixture.directory, "outside-active");
    mkdirSync(namespaceFixture.storageRoot, { recursive: true });
    mkdirSync(outsideDirectory, { recursive: true });
    symlinkSync(
      outsideDirectory,
      join(namespaceFixture.storageRoot, "active"),
      "dir",
    );
    expect(() => server(namespaceFixture)).toThrow(
      /storage namespaces must be real directories/,
    );
    expect(readdirSync(outsideDirectory)).toEqual([]);

    const manifestSymlinkFixture = fixture();
    let app = server(manifestSymlinkFixture);
    const manifestProject = await createProject(
      app,
      "Manifest Symlink",
      "manifest-symlink",
    );
    await close(app);
    const manifestPath = join(
      manifestSymlinkFixture.storageRoot,
      "active",
      manifestProject.id,
      "project-manifest.json",
    );
    const outsideManifest = join(
      manifestSymlinkFixture.directory,
      "outside-manifest.json",
    );
    writeFileSync(outsideManifest, '{"secret":"must-not-be-read"}', "utf8");
    rmSync(manifestPath, { force: true });
    symlinkSync(outsideManifest, manifestPath);
    expect(() => server(manifestSymlinkFixture)).toThrow(/Symbolic links/);

    const symlinkFixture = fixture();
    app = server(symlinkFixture);
    const project = await createProject(app);
    await close(app);
    symlinkSync(
      join(symlinkFixture.directory, "outside"),
      join(
        symlinkFixture.storageRoot,
        "active",
        project.id,
        "assets",
        "unsafe-link",
      ),
    );
    expect(() => server(symlinkFixture)).toThrow(/Symbolic links/);

    const dualFixture = fixture();
    app = server(dualFixture);
    const dualProject = await createProject(app, "Dual", "dual");
    await close(app);
    cpSync(
      join(dualFixture.storageRoot, "active", dualProject.id),
      join(dualFixture.storageRoot, "trash", dualProject.id),
      { recursive: true },
    );
    expect(() => server(dualFixture)).toThrow(/dual-location or orphan/);

    const orphanFixture = fixture();
    app = server(orphanFixture);
    await close(app);
    cpSync(
      join(dualFixture.storageRoot, "active", dualProject.id),
      join(orphanFixture.storageRoot, "active", dualProject.id),
      { recursive: true },
    );
    expect(() => server(orphanFixture)).toThrow(/dual-location or orphan/);
  });
});

let suffixCounter = 0;
function randomSuffix(length: number): string {
  suffixCounter += 1;
  return `${length}-${suffixCounter}`;
}
