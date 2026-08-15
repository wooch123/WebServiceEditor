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
    const app = buildServer({ metadataDatabasePath: databasePath });

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
        checks: { metadataDatabase: "ready" },
        schemaVersion: 1,
        status: "ready",
      });
    } finally {
      await app.close();
    }
    expect(existsSync(databasePath)).toBe(true);

    const database = new Database(databasePath);
    const migration = database
      .prepare("SELECT version, name FROM metadata_migrations")
      .get();
    expect(migration).toEqual({
      name: "initial-project-metadata",
      version: 1,
    });
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
