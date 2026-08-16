import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { buildServer } from "../../src/app.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) => {
      await rm(directory, { force: true, recursive: true });
    }),
  );
});

describe("system routes", () => {
  it("initializes a durable metadata database and exposes health/readiness", async () => {
    const directory = await mkdtemp(join(tmpdir(), "webeditor-server-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "metadata", "webeditor.sqlite");
    const app = buildServer({
      metadataDatabasePath: databasePath,
      storageRoot: join(directory, "projects"),
    });

    try {
      const healthResponse = await app.inject({
        method: "GET",
        url: "/api/v1/health",
      });
      const readyResponse = await app.inject({
        method: "GET",
        url: "/api/v1/ready",
      });

      expect(healthResponse.statusCode).toBe(200);
      expect(healthResponse.json()).toEqual({
        service: "webeditor-server",
        status: "ok",
      });
      expect(readyResponse.statusCode).toBe(200);
      expect(readyResponse.json()).toEqual({
        checks: { metadataDatabase: "ready", projectStorage: "ready" },
        schemaVersion: 11,
        status: "ready",
      });
    } finally {
      await app.close();
    }
    expect(existsSync(databasePath)).toBe(true);

    const database = new Database(databasePath);
    const migrations = database
      .prepare("SELECT version, name FROM metadata_migrations ORDER BY version")
      .all();
    expect(migrations).toEqual([
      { name: "initial-project-metadata", version: 1 },
      { name: "project-lifecycle-foundation", version: 2 },
      { name: "page-management-and-published-navigation", version: 3 },
      { name: "canvas-element-layout-kernel", version: 4 },
      { name: "element-registry-properties-history", version: 5 },
      { name: "statistical-elements-layout-presets", version: 6 },
      { name: "database-designer-runtime-schema", version: 7 },
      { name: "data-relationship-canvas", version: 8 },
      { name: "relationship-layout-routing", version: 9 },
      { name: "safe-read-binding-engine", version: 10 },
      { name: "project-variable-navigation", version: 11 },
    ]);
    expect(database.pragma("quick_check", { simple: true })).toBe("ok");
    expect(() =>
      database
        .prepare(
          `INSERT INTO projects
            (id, name, slug, lifecycle_status, schema_version, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          "00000000-0000-4000-8000-000000000001",
          "Invalid lifecycle",
          "invalid-lifecycle",
          "DELETED",
          1,
          "2026-08-15T00:00:00.000Z",
          "2026-08-15T00:00:00.000Z",
        ),
    ).toThrow();
    database.close();
  });
});
