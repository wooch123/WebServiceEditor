import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CANONICAL_LIFECYCLE_STATUSES,
  CANONICAL_PHASE3_ROUTES,
  PHASE3_EVIDENCE_PATH,
  REQUIRED_LIFECYCLE_TRANSITIONS,
  REQUIRED_METADATA_TABLES,
  REQUIRED_PHASE3_TEST_CAPABILITIES,
  extractRouteInventory,
  inspectCanonicalRouteContract,
  inspectDestructiveSafety,
  inspectFrontendPersistence,
  inspectLifecycleProtocol,
  inspectMetadataSchema,
  inspectStorageAndRecovery,
  inspectTestInventory,
  routeKey,
  validatePhase3,
} from "../../scripts/verify-phase3.mjs";

function sourceFile(path, source) {
  return { path, source };
}

describe("Phase 3 persistent lifecycle validation infrastructure", () => {
  it("validates the complete local Phase 3 implementation and evidence contract", async () => {
    const report = await validatePhase3();

    assert.equal(
      report.result,
      "PASS",
      JSON.stringify(report.failures, null, 2),
    );
    assert.equal(report.details.canonicalRouteCount, 15);
    assert.equal(report.details.registeredCanonicalRoutes, 15);
    assert.equal(report.details.lifecycleStatusCount, 7);
    assert.equal(
      report.details.lifecycleTransitionCount,
      REQUIRED_LIFECYCLE_TRANSITIONS.length,
    );
    assert.equal(
      report.details.metadataTableCount,
      Object.keys(REQUIRED_METADATA_TABLES).length,
    );
    assert.equal(report.details.requiredEvidencePath, PHASE3_EVIDENCE_PATH);
    assert.ok(report.details.serverSourceFiles.length > 0);
    assert.ok(report.details.domainSourceFiles.length > 0);
    assert.ok(report.details.webSourceFiles.length > 0);
    assert.ok(report.details.testFiles.length > 0);
    assert.ok(
      REQUIRED_PHASE3_TEST_CAPABILITIES.every(
        (capability) => report.details.testInventory.capabilities[capability],
      ),
    );
  });

  it("pins the canonical Section 22 route and lifecycle inventories", () => {
    assert.deepEqual(CANONICAL_LIFECYCLE_STATUSES, [
      "ACTIVE",
      "TRASHING",
      "TRASHED",
      "RESTORING",
      "PURGING",
      "PURGE_FAILED",
      "PURGED",
    ]);
    assert.equal(new Set(CANONICAL_LIFECYCLE_STATUSES).size, 7);
    assert.equal(CANONICAL_PHASE3_ROUTES.length, 15);
    assert.equal(
      new Set(CANONICAL_PHASE3_ROUTES.map(routeKey)).size,
      CANONICAL_PHASE3_ROUTES.length,
    );
    assert.ok(
      CANONICAL_PHASE3_ROUTES.every((route) =>
        route.path.startsWith("/api/v1/"),
      ),
    );
    assert.ok(
      CANONICAL_PHASE3_ROUTES.some(
        (route) =>
          route.method === "DELETE" && route.path.includes("recycle-bin"),
      ),
    );
    assert.ok(
      !CANONICAL_PHASE3_ROUTES.some(
        (route) =>
          route.method === "DELETE" &&
          /^\/api\/v1\/projects(?:\/|$)/u.test(route.path),
      ),
    );
  });

  it("extracts Fastify shorthand, generic, object, and inventory routes", () => {
    const routes = extractRouteInventory(`
      server.get("/api/v1/projects", handler);
      server.post<{ Body: CreateProject }>("/api/v1/projects", handler);
      server.route({
        method: "PATCH",
        url: "/api/v1/projects/:projectId",
        handler,
      });
      const inventory = [{
        method: "DELETE",
        path: "/api/v1/recycle-bin/projects/:projectId",
        handler,
      }];
    `);

    assert.deepEqual(routes.map(routeKey), [
      "DELETE /api/v1/recycle-bin/projects/:projectId",
      "GET /api/v1/projects",
      "PATCH /api/v1/projects/:projectId",
      "POST /api/v1/projects",
    ]);

    const prefixed = inspectCanonicalRouteContract([
      sourceFile(
        "apps/server/src/routes/projects.ts",
        `server.get("/projects", handler);
         server.post("/recycle-bin/projects/:projectId/restore", handler);`,
      ),
      sourceFile(
        "apps/server/src/app.ts",
        `server.register(projectRoutes, { prefix: "/api/v1" });`,
      ),
    ]);
    assert.ok(
      prefixed.actualRoutes.some(
        (route) => routeKey(route) === "GET /api/v1/projects",
      ),
    );
    assert.ok(
      prefixed.actualRoutes.some(
        (route) =>
          routeKey(route) ===
          "POST /api/v1/recycle-bin/projects/:projectId/restore",
      ),
    );
    assert.deepEqual(prefixed.unversionedLifecycleRoutes, []);
  });

  it("deterministically catches a missing canonical route", () => {
    const missing = CANONICAL_PHASE3_ROUTES.find((route) =>
      route.path.endsWith("/batch-purge"),
    );
    assert.ok(missing);
    const fixtureSource = CANONICAL_PHASE3_ROUTES.filter(
      (route) => route !== missing,
    )
      .map(
        ({ method, path }) =>
          `server.${method.toLowerCase()}("${path}", handler);`,
      )
      .join("\n");
    const inspection = inspectCanonicalRouteContract([
      sourceFile("apps/server/src/routes/projects.ts", fixtureSource),
    ]);

    assert.deepEqual(inspection.missingRoutes.map(routeKey), [
      routeKey(missing),
    ]);
  });

  it("deterministically catches physical deletion exposed from active Projects", () => {
    const files = [
      sourceFile(
        "apps/server/src/routes/projects.ts",
        `
          import { rm } from "node:fs/promises";
          server.delete("/api/v1/projects/:projectId", async (request) => {
            await rm(activeProjectPath(request.params.projectId), { recursive: true });
            database.prepare("DELETE FROM projects WHERE id = ?").run(request.params.projectId);
          });
        `,
      ),
    ];
    const inspection = inspectDestructiveSafety(files);

    assert.deepEqual(inspection.forbiddenActiveDeleteRoutes.map(routeKey), [
      "DELETE /api/v1/projects/:projectId",
    ]);
    assert.deepEqual(inspection.forbiddenProjectDeletes, [
      "apps/server/src/routes/projects.ts",
    ]);
    assert.deepEqual(inspection.unsafeFilesystemDeletes, [
      "apps/server/src/routes/projects.ts",
    ]);

    const guarded = inspectDestructiveSafety([
      sourceFile(
        "apps/server/src/projects/project-service.ts",
        `async function purge(project) {
          if (project.lifecycleStatus !== "TRASHED" && project.lifecycleStatus !== "PURGE_FAILED") {
            throw conflict("Purge is recycle-bin only");
          }
          return storage.purge(project.id);
        }`,
      ),
      sourceFile(
        "apps/server/src/projects/project-storage.ts",
        `function purge(stagingPath) {
          rmSync(stagingPath, { recursive: true });
        }`,
      ),
    ]);
    assert.equal(guarded.hasGlobalPurgeGuard, true);
    assert.deepEqual(guarded.unsafeFilesystemDeletes, []);
  });

  it("deterministically catches absent idempotency replay and journals", () => {
    const inspection = inspectLifecycleProtocol([
      sourceFile(
        "apps/server/src/lifecycle.ts",
        `
          const statuses = [
            "ACTIVE", "TRASHING", "TRASHED", "RESTORING",
            "PURGING", "PURGE_FAILED", "PURGED"
          ];
          export async function trash(projectId) { return move(projectId); }
          export async function restore(projectId) { return move(projectId); }
          export async function purge(projectId) { return remove(projectId); }
        `,
      ),
    ]);

    assert.equal(inspection.hasIdempotencyContract, false);
    assert.equal(inspection.hasRequestHash, false);
    assert.equal(inspection.persistsReplayResponse, false);
    assert.equal(inspection.readsIdempotencyRecord, false);
    assert.equal(inspection.writesOperationJournal, false);
    assert.equal(inspection.readsIncompleteJournal, false);
    assert.equal(inspection.writesOutbox, false);
    assert.equal(inspection.writesAudit, false);
    assert.equal(inspection.listsOnlyActiveProjects, false);
    assert.equal(inspection.listsOnlyRecycleBinProjects, false);
  });

  it("detects missing lifecycle tables and idempotency constraints", () => {
    const incomplete = inspectMetadataSchema(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        lifecycle_status TEXT NOT NULL
      );
    `);

    assert.equal(incomplete.tables.projects.present, true);
    assert.ok(incomplete.tables.projects.missingColumns.includes("revision"));
    assert.equal(incomplete.tables.project_lifecycle_operations.present, false);
    assert.equal(incomplete.idempotencyUniqueConstraint, false);
    assert.equal(incomplete.lifecycleStatusConstraint, false);
  });

  it("recognizes complete lifecycle tables without depending on column order", () => {
    const tableSql = Object.entries(REQUIRED_METADATA_TABLES)
      .map(([table, columns]) => {
        const declarations = columns.map((column) => {
          if (column === "id" || column === "project_id") {
            return `${column} TEXT`;
          }
          return `${column} TEXT`;
        });
        if (table === "projects") {
          declarations[0] = "id TEXT PRIMARY KEY";
          declarations.push(
            `CHECK (lifecycle_status IN (${CANONICAL_LIFECYCLE_STATUSES.map((status) => `'${status}'`).join(", ")}))`,
          );
        }
        if (table === "project_lifecycle_operations") {
          declarations.push("UNIQUE (project_id, idempotency_key)");
          declarations.push(
            "CHECK (operation_type IN ('TRASH', 'RESTORE', 'PURGE'))",
          );
        }
        return `CREATE TABLE ${table} (${declarations.reverse().join(",\n")});`;
      })
      .join("\n");
    const inspection = inspectMetadataSchema(`
      PRAGMA foreign_keys = ON;
      PRAGMA integrity_check;
      ${tableSql}
      CREATE INDEX projects_lifecycle_idx ON projects(lifecycle_status);
      CREATE INDEX projects_slug_idx ON projects(slug);
      CREATE INDEX projects_deleted_idx ON projects(deleted_at);
    `);

    assert.ok(
      Object.values(inspection.tables).every(
        (table) => table.present && table.missingColumns.length === 0,
      ),
    );
    assert.equal(inspection.lifecycleStatusConstraint, true);
    assert.equal(inspection.operationTypeConstraint, true);
    assert.equal(inspection.idempotencyUniqueConstraint, true);
    assert.equal(inspection.forbidsProjectRowDeletion, true);
  });

  it("computes the effective SQLite schema across migrations and pragma calls", () => {
    const projectColumns = REQUIRED_METADATA_TABLES.projects.filter(
      (column) => column !== "lifecycle_revision",
    );
    const inspection = inspectMetadataSchema(`
      const schema = \`
        CREATE TABLE projects (
          ${projectColumns.map((column) => `${column} TEXT`).join(",\n")},
          PRIMARY KEY (id),
          CHECK (lifecycle_status IN (${CANONICAL_LIFECYCLE_STATUSES.map((status) => `'${status}'`).join(", ")}))
        );
        ALTER TABLE projects ADD COLUMN lifecycle_revision INTEGER NOT NULL DEFAULT 0;
      \`;
      database.pragma("foreign_keys = ON");
      database.pragma("quick_check", { simple: true });
    `);

    assert.ok(
      !inspection.tables.projects.missingColumns.includes("lifecycle_revision"),
    );
    assert.equal(inspection.projectsPrimaryKey, true);
    assert.equal(inspection.lifecycleStatusConstraint, true);
    assert.equal(inspection.enablesForeignKeys, true);
    assert.equal(inspection.runsMetadataIntegrityCheck, true);
  });

  it("deterministically rejects mock-only frontend persistence", () => {
    const inspection = inspectFrontendPersistence([
      sourceFile(
        "apps/web/src/App.tsx",
        `
          const initialProjects = [{ id: "fixture", name: "Mock Project" }];
          function App() {
            const [projects, setProjects] = useState(initialProjects);
            const trash = (id) => setProjects(projects.filter((project) => project.id !== id));
            return <ProjectList projects={projects} onTrash={trash} />;
          }
        `,
      ),
    ]);

    assert.equal(inspection.hasNetworkClient, false);
    assert.deepEqual(inspection.hardcodedInitialProjects, ["initialProjects"]);
    assert.equal(inspection.mockOnlyPersistence, true);
    assert.equal(inspection.readsActiveProjects, false);
  });

  it("recognizes a real API lifecycle client and recycle-bin-only purge", () => {
    const inspection = inspectFrontendPersistence([
      sourceFile(
        "apps/web/src/api/projects.ts",
        `
          export const listProjects = () => fetch("/api/v1/projects");
          export const listTrash = () => fetch("/api/v1/recycle-bin/projects");
          export const trashProject = (id) => fetch(
            \`/api/v1/projects/\${id}/trash\`,
            { method: "POST" },
          );
          export const restoreProject = (id) => fetch(
            \`/api/v1/recycle-bin/projects/\${id}/restore\`,
            { method: "POST" },
          );
          export const createPurgePlan = (id) => fetch(
            \`/api/v1/recycle-bin/projects/\${id}/purge-plan\`,
            { method: "POST" },
          );
          export const purgeProject = (id, typedConfirmation) => fetch(
            \`/api/v1/recycle-bin/projects/\${id}\`,
            { method: "DELETE", body: JSON.stringify({ typedConfirmation }) },
          );
        `,
      ),
      sourceFile(
        "apps/web/src/ProjectHome.tsx",
        `
          function ProjectHome() {
            return <ImpactDialog title="휴지통 이동 영향 확인" />;
          }
          function RecycleBin() {
            const [confirmProjectName, setConfirmProjectName] = useState("");
            return <PurgeDialog title="영구 삭제" confirmationPhrase={confirmProjectName} />;
          }
        `,
      ),
    ]);

    assert.equal(inspection.hasNetworkClient, true);
    assert.equal(inspection.readsActiveProjects, true);
    assert.equal(inspection.readsRecycleBin, true);
    assert.equal(inspection.callsTrashEndpoint, true);
    assert.equal(inspection.callsRestoreEndpoint, true);
    assert.equal(inspection.callsPurgePlan, true);
    assert.equal(inspection.purgesThroughRecycleBinDelete, true);
    assert.equal(inspection.neverDeletesActiveEndpoint, true);
    assert.equal(inspection.hasImpactConfirmation, true);
    assert.equal(inspection.hasTypedPurgeConfirmation, true);
    assert.equal(inspection.distinguishesTrashAndPurge, true);
    assert.equal(inspection.mockOnlyPersistence, false);
  });

  it("requires real filesystem, checksum, manifest, and recovery primitives", () => {
    const absent = inspectStorageAndRecovery([
      sourceFile(
        "apps/server/src/lifecycle.ts",
        "export const trash = (project) => ({ ...project, status: 'TRASHED' });",
      ),
    ]);
    assert.ok(Object.values(absent).every((value) => value === false));

    const complete = inspectStorageAndRecovery([
      sourceFile(
        "apps/server/src/lifecycle-storage.ts",
        `
          import { lstatSync, renameSync } from "node:fs";
          import { createHash } from "node:crypto";
          const activeRoot = "data/active";
          const trashRoot = "data/trash";
          async function manifest(path) {
            if (lstatSync(path).isSymbolicLink()) throw new Error("symlink rejected");
            if (relative(activeRoot, path).startsWith("..")) throw new Error("path traversal invalid");
            return files.sort().map((file) => createHash("sha256").update(file).digest("hex"));
          }
          function moveToTrash(from, to) { renameSync(from, to); }
          async function restore() { verifyChecksum(); run("PRAGMA integrity_check"); }
          const testDb = "test.sqlite";
          const productionDb = "production.sqlite";
          function assertExclusive() {
            if (activeExists && trashExists) throw new Error("project cannot exist in both roots");
          }
          async function recoverLifecycleOperationsAtStartup() { await resumeOperationOrCompensate(); }
          async function buildApp() { await recoverLifecycleOperationsAtStartup(); }
          const faultInjection = simulateFailure;
        `,
      ),
    ]);
    assert.ok(
      Object.entries(complete).every(
        ([name, value]) =>
          assert.equal(value, true, `${name} should be recognized`) ===
          undefined,
      ),
    );
  });

  it("requires lifecycle evidence within a real server integration test", () => {
    const unrelatedFragments = inspectTestInventory([
      sourceFile(
        "apps/server/test/integration/system-routes.test.ts",
        `it("checks lifecycle health", () => inject("/api/v1/projects"));`,
      ),
      sourceFile(
        "apps/server/test/unit/checksum.test.ts",
        `it("reopens checksum storage", () => restartServer());`,
      ),
      sourceFile(
        "apps/web/src/App.test.tsx",
        `it("mocks trash restore purge", () => fetch("/api/v1/recycle-bin/projects"));`,
      ),
    ]);
    assert.equal(unrelatedFragments.hasServerLifecycleIntegrationTest, false);
    assert.equal(
      unrelatedFragments.capabilities["canonical-api-contract"],
      false,
    );
    assert.equal(
      unrelatedFragments.capabilities["restart-trash-restore-checksum"],
      false,
    );

    const realIntegration = inspectTestInventory([
      sourceFile(
        "apps/server/test/integration/project-lifecycle.test.ts",
        `
          it("covers idempotency replay conflict and active/trash mutual exclusion", async () => {
            await inject("/api/v1/projects");
            await inject("/api/v1/projects/id/trash");
            await inject("/api/v1/recycle-bin/projects");
            await inject("/api/v1/recycle-bin/projects/id/restore");
            await inject("/api/v1/recycle-bin/projects/id/purge-plan");
            await closeAndBuildServer(); // restart/reopen
            expect(restoredChecksum).toBe(originalChecksum);
            expect(sameIdempotencyKeyReplay.status).toBe(200);
            expect(payloadMismatch.status).toBe(409);
            injectFailureDuringPurge();
            expect(compensationRecovery).toBe("PURGE_FAILED");
            expect(projectNeverAppearsInBothActiveAndTrash).toBe(true);
          });
        `,
      ),
    ]);
    assert.equal(realIntegration.hasServerLifecycleIntegrationTest, true);
    for (const capability of [
      "canonical-api-contract",
      "idempotency-replay-and-conflict",
      "restart-trash-restore-checksum",
      "purge-failure-compensation",
      "active-trash-mutual-exclusion",
    ]) {
      assert.equal(
        realIntegration.capabilities[capability],
        true,
        `${capability} should be recognized in one integration file`,
      );
    }
  });
});
