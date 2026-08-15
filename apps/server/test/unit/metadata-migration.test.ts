import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import {
  INITIAL_METADATA_SCHEMA_CHECKSUM,
  MetadataDatabase,
} from "../../src/metadata/database.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("metadata migration", () => {
  it("upgrades a populated version-1 database without changing its project", () => {
    const directory = mkdtempSync(join(tmpdir(), "webeditor-v1-migration-"));
    directories.push(directory);
    const path = join(directory, "metadata.sqlite");
    const legacy = new Database(path);
    legacy.pragma("application_id = 1464156741");
    legacy.exec(`
      CREATE TABLE metadata_migrations (
        version INTEGER PRIMARY KEY NOT NULL,
        name TEXT NOT NULL UNIQUE,
        checksum TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
      CREATE TABLE projects (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL CHECK (length(trim(name)) > 0),
        slug TEXT NOT NULL CHECK (length(trim(slug)) > 0),
        description TEXT,
        lifecycle_status TEXT NOT NULL CHECK (lifecycle_status IN ('ACTIVE', 'TRASHING', 'TRASHED', 'RESTORING', 'PURGING', 'PURGE_FAILED', 'PURGED')),
        status TEXT NOT NULL DEFAULT 'DRAFT',
        schema_version INTEGER NOT NULL CHECK (schema_version > 0),
        revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
        created_by TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        deleted_by TEXT,
        deleted_reason TEXT,
        original_storage_path TEXT,
        current_storage_path TEXT,
        purge_eligible_at TEXT,
        tombstone_checksum TEXT
      );
      CREATE INDEX projects_lifecycle_status_idx ON projects(lifecycle_status);
      CREATE INDEX projects_slug_idx ON projects(slug);
      CREATE INDEX projects_deleted_at_idx ON projects(deleted_at);
    `);
    legacy
      .prepare(
        `INSERT INTO metadata_migrations
          (version, name, checksum, applied_at) VALUES (1, ?, ?, ?)`,
      )
      .run(
        "initial-project-metadata",
        INITIAL_METADATA_SCHEMA_CHECKSUM,
        "2026-08-15T00:00:00.000Z",
      );
    legacy
      .prepare(
        `INSERT INTO projects
          (id, name, slug, lifecycle_status, schema_version, revision, created_at, updated_at)
         VALUES (?, ?, ?, 'ACTIVE', 1, 7, ?, ?)`,
      )
      .run(
        "00000000-0000-4000-8000-000000000001",
        "Legacy project",
        "legacy-project",
        "2026-08-15T00:00:00.000Z",
        "2026-08-15T00:00:00.000Z",
      );
    legacy.pragma("user_version = 1");
    legacy.close();

    const migrated = new MetadataDatabase(path);
    try {
      expect(migrated.assertReady().schemaVersion).toBe(2);
      expect(
        migrated.connection
          .prepare(
            "SELECT name, revision, lifecycle_revision, favorite, theme_id FROM projects",
          )
          .get(),
      ).toEqual({
        name: "Legacy project",
        revision: 7,
        lifecycle_revision: 0,
        favorite: 0,
        theme_id: "light-clean-paper",
      });
      expect(
        migrated.connection
          .prepare("SELECT version FROM metadata_migrations ORDER BY version")
          .all(),
      ).toEqual([{ version: 1 }, { version: 2 }]);
    } finally {
      migrated.close();
    }
  });
});
