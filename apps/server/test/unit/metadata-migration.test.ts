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
      expect(migrated.assertReady().schemaVersion).toBe(4);
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
      ).toEqual([
        { version: 1 },
        { version: 2 },
        { version: 3 },
        { version: 4 },
      ]);
      expect(
        migrated.connection
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('pages', 'page_commands', 'project_definition_operations', 'project_versions') ORDER BY name",
          )
          .all(),
      ).toEqual([
        { name: "page_commands" },
        { name: "pages" },
        { name: "project_definition_operations" },
        { name: "project_versions" },
      ]);
      expect(
        migrated.connection
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('page_layout_revisions', 'elements', 'element_layouts', 'element_commands') ORDER BY name",
          )
          .all(),
      ).toEqual([
        { name: "element_commands" },
        { name: "element_layouts" },
        { name: "elements" },
        { name: "page_layout_revisions" },
      ]);
    } finally {
      migrated.close();
    }
  });

  it("fails closed on a future SQLite user_version", () => {
    const directory = mkdtempSync(
      join(tmpdir(), "webeditor-future-migration-"),
    );
    directories.push(directory);
    const path = join(directory, "metadata.sqlite");
    const future = new Database(path);
    future.pragma("application_id = 1464156741");
    future.pragma("user_version = 5");
    future.close();

    expect(() => new MetadataDatabase(path)).toThrow(
      "Refusing unknown future metadata schema version 5",
    );
  });

  it("backfills one zero desktop layout revision for every existing version-3 Page", () => {
    const directory = mkdtempSync(
      join(tmpdir(), "webeditor-v3-layout-migration-"),
    );
    directories.push(directory);
    const path = join(directory, "metadata.sqlite");
    const current = new MetadataDatabase(path);
    const projectId = "00000000-0000-4000-8000-000000000001";
    const pageId = "00000000-0000-4000-8000-000000000002";
    const now = "2026-08-16T00:00:00.000Z";
    current.connection
      .prepare(
        `INSERT INTO projects (
           id, name, slug, lifecycle_status, status, schema_version, revision,
           lifecycle_revision, favorite, theme_id, created_at, updated_at
         ) VALUES (?, 'V3 Project', 'v3-project', 'ACTIVE', 'DRAFT', 1, 0,
           0, 0, 'light-clean-paper', ?, ?)`,
      )
      .run(projectId, now, now);
    current.connection
      .prepare(
        `INSERT INTO pages (
           id, project_id, schema_version, revision, name, route, page_type,
           icon_name, icon_catalog_version, navigation_visible,
           sort_order, created_at, updated_at
         ) VALUES (?, ?, 1, 1, 'Legacy Page', '/legacy', 'blank', 'File',
           '1.31.0', 1, 0, ?, ?)`,
      )
      .run(pageId, projectId, now, now);
    const preservedHistory = current.connection
      .prepare(
        "SELECT version, name, checksum FROM metadata_migrations WHERE version <= 3 ORDER BY version",
      )
      .all();
    current.close();

    const version3 = new Database(path);
    version3.pragma("foreign_keys = OFF");
    version3.exec(`
      DROP TRIGGER pages_initialize_layout_revision;
      DROP TABLE element_commands;
      DROP TABLE element_layouts;
      DROP TABLE elements;
      DROP TABLE page_layout_revisions;
      DROP INDEX pages_id_project_unique_idx;
      DELETE FROM metadata_migrations WHERE version = 4;
    `);
    version3.pragma("user_version = 3");
    version3.close();

    const migrated = new MetadataDatabase(path);
    try {
      expect(migrated.assertReady().schemaVersion).toBe(4);
      expect(
        migrated.connection
          .prepare(
            "SELECT page_id, project_id, desktop_revision, updated_at FROM page_layout_revisions",
          )
          .all(),
      ).toEqual([
        {
          page_id: pageId,
          project_id: projectId,
          desktop_revision: 0,
          updated_at: now,
        },
      ]);
      expect(
        migrated.connection
          .prepare(
            "SELECT version, name, checksum FROM metadata_migrations WHERE version <= 3 ORDER BY version",
          )
          .all(),
      ).toEqual(preservedHistory);
    } finally {
      migrated.close();
    }
  });

  it("fails closed on unknown or non-prefix migration history", () => {
    const directory = mkdtempSync(
      join(tmpdir(), "webeditor-unknown-migration-"),
    );
    directories.push(directory);
    const path = join(directory, "metadata.sqlite");
    const unknown = new Database(path);
    unknown.pragma("application_id = 1464156741");
    unknown.exec(`
      CREATE TABLE metadata_migrations (
        version INTEGER PRIMARY KEY NOT NULL,
        name TEXT NOT NULL UNIQUE,
        checksum TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
      INSERT INTO metadata_migrations
        (version, name, checksum, applied_at)
      VALUES (5, 'future', 'unknown', '2026-08-15T00:00:00.000Z');
    `);
    unknown.close();

    expect(() => new MetadataDatabase(path)).toThrow(
      "Metadata migration history is not a known prefix",
    );
  });
});
