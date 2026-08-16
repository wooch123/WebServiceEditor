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
      expect(migrated.assertReady().schemaVersion).toBe(10);
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
        { version: 5 },
        { version: 6 },
        { version: 7 },
        { version: 8 },
        { version: 9 },
        { version: 10 },
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
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('page_layout_revisions', 'elements', 'element_layouts', 'element_commands', 'element_history_operations', 'layout_preset_instances', 'layout_preset_instance_elements', 'element_binding_placeholders') ORDER BY name",
          )
          .all(),
      ).toEqual([
        { name: "element_binding_placeholders" },
        { name: "element_commands" },
        { name: "element_history_operations" },
        { name: "element_layouts" },
        { name: "elements" },
        { name: "layout_preset_instance_elements" },
        { name: "layout_preset_instances" },
        { name: "page_layout_revisions" },
      ]);
      expect(
        migrated.connection
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('binding_query_runs', 'sample_data_commands') ORDER BY name",
          )
          .all(),
      ).toEqual([
        { name: "binding_query_runs" },
        { name: "sample_data_commands" },
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
    future.pragma("user_version = 11");
    future.close();

    expect(() => new MetadataDatabase(path)).toThrow(
      "Refusing unknown future metadata schema version 11",
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
      DROP TABLE binding_query_runs;
      DROP TABLE sample_data_commands;
      DROP TABLE relationship_layout_history_operations;
      DROP TABLE relationship_layout_commands;
      DROP TABLE relationship_node_positions;
      DROP TRIGGER projects_initialize_relationship_viewport;
      DROP TABLE project_relationship_viewports;
      DROP TABLE binding_history_operations;
      DROP TABLE binding_commands;
      DROP TABLE bindings;
      DROP TRIGGER projects_initialize_binding_state;
      DROP TABLE project_binding_states;
      DROP TRIGGER projects_initialize_schema_state;
      DROP TABLE schema_commands;
      DROP TABLE schema_backups;
      DROP TABLE schema_migration_plans;
      DROP TABLE data_relations;
      DROP TABLE data_fields;
      DROP TABLE data_tables;
      DROP TABLE project_schema_states;
      DROP TRIGGER pages_initialize_layout_revision;
      DROP TABLE element_binding_placeholders;
      DROP TABLE layout_preset_instance_elements;
      DROP TABLE layout_preset_instances;
      DROP TABLE element_history_operations;
      DROP TABLE element_commands;
      DROP TABLE element_layouts;
      DROP TABLE elements;
      DROP TABLE page_layout_revisions;
      DROP INDEX pages_id_project_unique_idx;
      DELETE FROM metadata_migrations WHERE version >= 4;
    `);
    version3.pragma("user_version = 3");
    version3.close();

    const migrated = new MetadataDatabase(path);
    try {
      expect(migrated.assertReady().schemaVersion).toBe(10);
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

  it("performs the v5 to v6 forward migration and backfills exact required binding placeholders", () => {
    const directory = mkdtempSync(
      join(tmpdir(), "webeditor-v5-preset-migration-"),
    );
    directories.push(directory);
    const path = join(directory, "metadata.sqlite");
    const current = new MetadataDatabase(path);
    const projectId = "00000000-0000-4000-8000-000000000021";
    const pageId = "00000000-0000-4000-8000-000000000022";
    const commandId = "00000000-0000-4000-8000-000000000026";
    const historyOperationId = "00000000-0000-4000-8000-000000000027";
    const now = "2026-08-16T02:00:00.000Z";
    current.connection.exec(`
      INSERT INTO projects (
        id, name, slug, lifecycle_status, status, schema_version, revision,
        lifecycle_revision, favorite, theme_id, created_at, updated_at
      ) VALUES (
        '${projectId}', 'V5 Presets', 'v5-presets', 'ACTIVE', 'DRAFT', 1, 1,
        0, 0, 'light-clean-paper', '${now}', '${now}'
      );
      INSERT INTO pages (
        id, project_id, schema_version, revision, name, route, page_type,
        icon_name, icon_catalog_version, navigation_visible, sort_order,
        created_at, updated_at
      ) VALUES (
        '${pageId}', '${projectId}', 1, 1, 'Page', '/page', 'blank', 'File',
        '1.31.0', 1, 0, '${now}', '${now}'
      );
    `);
    const insertElement = current.connection.prepare(
      `INSERT INTO elements (
         id, project_id, page_id, type, type_version, name, props_json,
         style_json, events_json, locked, hidden, revision, created_at, updated_at
       ) VALUES (?, ?, ?, ?, 1, ?, '{}', '{}', '[]', 0, 0, 1, ?, ?)`,
    );
    const insertLayout = current.connection.prepare(
      `INSERT INTO element_layouts (
         element_id, project_id, page_id, breakpoint, x, y, w, h,
         min_w, min_h, max_w, max_h
       ) VALUES (?, ?, ?, 'desktop', 0, ?, 6, 8, 2, 3, 24, 40)`,
    );
    const legacyElements = [
      ["00000000-0000-4000-8000-000000000023", "kpi-card", "KPI"],
      ["00000000-0000-4000-8000-000000000024", "data-table", "Table"],
      ["00000000-0000-4000-8000-000000000025", "text", "Text"],
    ] as const;
    legacyElements.forEach(([id, type, name], index) => {
      insertElement.run(id, projectId, pageId, type, name, now, now);
      insertLayout.run(id, projectId, pageId, index * 8);
    });
    current.connection
      .prepare(
        `INSERT INTO element_commands (
           id, project_id, page_id, element_id, command_type, idempotency_key,
           request_hash, before_json, after_json, response_status, response_json,
           before_layout_revision, after_layout_revision, history_state,
           history_sequence, history_updated_at, created_at
         ) VALUES (?, ?, ?, ?, 'ADD', 'legacy-command', 'legacy-hash', NULL,
           '{}', 201, '{}', 0, 1, 'APPLIED', 1, ?, ?)`,
      )
      .run(commandId, projectId, pageId, legacyElements[0][0], now, now);
    current.connection
      .prepare(
        `INSERT INTO element_history_operations (
           id, project_id, command_id, requested_command_id, operation_type,
           idempotency_key, request_hash, response_status, response_json,
           created_at
         ) VALUES (?, ?, ?, ?, 'UNDO', 'legacy-undo', 'legacy-undo-hash',
           200, '{}', ?)`,
      )
      .run(historyOperationId, projectId, commandId, commandId, now);
    const preservedHistory = current.connection
      .prepare(
        `SELECT version, name, checksum FROM metadata_migrations
         WHERE version <= 5 ORDER BY version`,
      )
      .all();
    current.close();

    const version5 = new Database(path);
    version5.pragma("foreign_keys = OFF");
    version5.exec(`
      DROP TABLE binding_query_runs;
      DROP TABLE sample_data_commands;
      DROP TABLE relationship_layout_history_operations;
      DROP TABLE relationship_layout_commands;
      DROP TABLE relationship_node_positions;
      DROP TRIGGER projects_initialize_relationship_viewport;
      DROP TABLE project_relationship_viewports;
      DROP TABLE binding_history_operations;
      DROP TABLE binding_commands;
      DROP TABLE bindings;
      DROP TRIGGER projects_initialize_binding_state;
      DROP TABLE project_binding_states;
      DROP TRIGGER projects_initialize_schema_state;
      DROP TABLE schema_commands;
      DROP TABLE schema_backups;
      DROP TABLE schema_migration_plans;
      DROP TABLE data_relations;
      DROP TABLE data_fields;
      DROP TABLE data_tables;
      DROP TABLE project_schema_states;
      DROP TABLE element_binding_placeholders;
      DROP TABLE layout_preset_instance_elements;
      DROP TABLE layout_preset_instances;

      ALTER TABLE element_history_operations
        RENAME TO element_history_operations_v6_fixture;
      ALTER TABLE element_commands RENAME TO element_commands_v6_fixture;
      CREATE TABLE element_commands (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        page_id TEXT NOT NULL,
        element_id TEXT,
        command_type TEXT NOT NULL CHECK (
          command_type IN (
            'ADD', 'MOVE', 'RESIZE', 'LOCK', 'BATCH_LAYOUT', 'DELETE',
            'PROPERTIES'
          )
        ),
        idempotency_key TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        before_json TEXT CHECK (before_json IS NULL OR json_valid(before_json)),
        after_json TEXT CHECK (after_json IS NULL OR json_valid(after_json)),
        response_status INTEGER NOT NULL
          CHECK (response_status BETWEEN 200 AND 499)
          CHECK (typeof(response_status) = 'integer'),
        response_json TEXT NOT NULL CHECK (json_valid(response_json)),
        before_layout_revision INTEGER NOT NULL
          CHECK (before_layout_revision >= 0)
          CHECK (typeof(before_layout_revision) = 'integer'),
        after_layout_revision INTEGER NOT NULL
          CHECK (after_layout_revision >= before_layout_revision)
          CHECK (typeof(after_layout_revision) = 'integer'),
        history_state TEXT CHECK (
          history_state IS NULL OR
          history_state IN ('APPLIED', 'UNDONE', 'DISCARDED')
        ),
        history_sequence INTEGER CHECK (
          history_sequence IS NULL OR
          (history_sequence >= 1 AND typeof(history_sequence) = 'integer')
        ),
        history_updated_at TEXT,
        created_at TEXT NOT NULL,
        CHECK (
          (history_state IS NULL AND history_sequence IS NULL AND
            history_updated_at IS NULL) OR
          (history_state IS NOT NULL AND history_sequence IS NOT NULL AND
            history_updated_at IS NOT NULL)
        ),
        UNIQUE(id, project_id),
        UNIQUE(project_id, idempotency_key),
        UNIQUE(project_id, history_sequence),
        FOREIGN KEY (page_id, project_id)
          REFERENCES pages(id, project_id) ON DELETE CASCADE
      );
      INSERT INTO element_commands SELECT * FROM element_commands_v6_fixture;

      CREATE TABLE element_history_operations (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        command_id TEXT,
        requested_command_id TEXT NOT NULL,
        operation_type TEXT NOT NULL CHECK (operation_type IN ('UNDO', 'REDO')),
        idempotency_key TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        response_status INTEGER NOT NULL
          CHECK (response_status BETWEEN 200 AND 499)
          CHECK (typeof(response_status) = 'integer'),
        response_json TEXT NOT NULL CHECK (json_valid(response_json)),
        created_at TEXT NOT NULL,
        UNIQUE(project_id, idempotency_key),
        FOREIGN KEY (command_id, project_id)
          REFERENCES element_commands(id, project_id) ON DELETE CASCADE
      );
      INSERT INTO element_history_operations
        SELECT id, project_id, command_id, requested_command_id,
          operation_type, idempotency_key, request_hash, response_status,
          response_json, created_at
        FROM element_history_operations_v6_fixture;
      DROP TABLE element_history_operations_v6_fixture;
      DROP TABLE element_commands_v6_fixture;
      CREATE INDEX element_commands_page_created_idx
        ON element_commands(page_id, created_at, id);
      CREATE INDEX element_commands_project_history_idx
        ON element_commands(project_id, history_state, history_sequence);
      CREATE INDEX element_history_operations_project_created_idx
        ON element_history_operations(project_id, created_at, id);
      DELETE FROM metadata_migrations WHERE version >= 6;
    `);
    expect(
      (
        version5
          .prepare(
            "SELECT sql FROM sqlite_master WHERE name = 'element_commands'",
          )
          .get() as { sql: string }
      ).sql,
    ).not.toContain("PRESET_APPLY");
    version5.pragma("user_version = 5");
    version5.close();

    const migrated = new MetadataDatabase(path);
    try {
      expect(migrated.assertReady().schemaVersion).toBe(10);
      expect(
        migrated.connection
          .prepare(
            `SELECT e.type, p.port_id, p.instance_id, p.template_id, p.status
             FROM element_binding_placeholders p
             JOIN elements e ON e.id = p.element_id
             ORDER BY e.type`,
          )
          .all(),
      ).toEqual([
        {
          type: "data-table",
          port_id: "rows",
          instance_id: null,
          template_id: null,
          status: "UNCONNECTED",
        },
        {
          type: "kpi-card",
          port_id: "value",
          instance_id: null,
          template_id: null,
          status: "UNCONNECTED",
        },
      ]);
      expect(
        migrated.connection
          .prepare(
            `SELECT version, name, checksum FROM metadata_migrations
             WHERE version <= 5 ORDER BY version`,
          )
          .all(),
      ).toEqual(preservedHistory);
      expect(
        migrated.connection
          .prepare(
            `SELECT id, command_type, history_state, history_sequence
             FROM element_commands WHERE id = ?`,
          )
          .get(commandId),
      ).toEqual({
        id: commandId,
        command_type: "ADD",
        history_state: "APPLIED",
        history_sequence: 1,
      });
      expect(
        migrated.connection
          .prepare(
            `SELECT id, command_id, requested_command_id, operation_type
             FROM element_history_operations WHERE id = ?`,
          )
          .get(historyOperationId),
      ).toEqual({
        id: historyOperationId,
        command_id: commandId,
        requested_command_id: commandId,
        operation_type: "UNDO",
      });
      expect(() =>
        migrated.connection
          .prepare(
            `INSERT INTO element_commands (
               id, project_id, page_id, element_id, command_type,
               idempotency_key, request_hash, before_json, after_json,
               response_status, response_json, before_layout_revision,
               after_layout_revision, created_at
             ) VALUES (?, ?, ?, NULL, 'PRESET_APPLY', 'v6-preset', 'hash',
               NULL, NULL, 400, '{}', 0, 0, ?)`,
          )
          .run("00000000-0000-4000-8000-000000000028", projectId, pageId, now),
      ).not.toThrow();
      expect(migrated.connection.pragma("foreign_key_check")).toEqual([]);
    } finally {
      migrated.close();
    }
  });

  it("preserves v4 insertion order when successful commands share one timestamp", () => {
    const directory = mkdtempSync(
      join(tmpdir(), "webeditor-v4-history-order-"),
    );
    directories.push(directory);
    const path = join(directory, "metadata.sqlite");
    const current = new MetadataDatabase(path);
    const projectId = "00000000-0000-4000-8000-000000000011";
    const pageId = "00000000-0000-4000-8000-000000000012";
    const elementId = "00000000-0000-4000-8000-000000000013";
    const fixedNow = "2026-08-16T01:00:00.000Z";
    current.connection.exec(`
      INSERT INTO projects (
        id, name, slug, lifecycle_status, status, schema_version, revision,
        lifecycle_revision, favorite, theme_id, created_at, updated_at
      ) VALUES (
        '${projectId}', 'History', 'history-order', 'ACTIVE', 'DRAFT', 1, 3,
        0, 0, 'light-clean-paper', '${fixedNow}', '${fixedNow}'
      );
      INSERT INTO pages (
        id, project_id, schema_version, revision, name, route, page_type,
        icon_name, icon_catalog_version, navigation_visible, sort_order,
        created_at, updated_at
      ) VALUES (
        '${pageId}', '${projectId}', 1, 1, 'Page', '/page', 'blank', 'File',
        '1.31.0', 1, 0, '${fixedNow}', '${fixedNow}'
      );
      INSERT INTO elements (
        id, project_id, page_id, type, type_version, name, props_json,
        style_json, events_json, locked, hidden, revision, created_at, updated_at
      ) VALUES (
        '${elementId}', '${projectId}', '${pageId}', 'text', 1, 'Text',
        '{"text":"Text"}', '{}', '[]', 0, 0, 2, '${fixedNow}', '${fixedNow}'
      );
      INSERT INTO element_layouts (
        element_id, project_id, page_id, breakpoint, x, y, w, h,
        min_w, min_h, max_w, max_h
      ) VALUES (
        '${elementId}', '${projectId}', '${pageId}', 'desktop', 0, 0, 6, 5,
        2, 3, 24, 20
      );
    `);
    const insertCommand = current.connection.prepare(
      `INSERT INTO element_commands (
         id, project_id, page_id, element_id, command_type, idempotency_key,
         request_hash, before_json, after_json, response_status, response_json,
         before_layout_revision, after_layout_revision, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 200, '{}', ?, ?, ?)`,
    );
    insertCommand.run(
      "z-first-insertion",
      projectId,
      pageId,
      elementId,
      "ADD",
      "first-insertion",
      "first-hash",
      null,
      "{}",
      0,
      1,
      fixedNow,
    );
    insertCommand.run(
      "a-second-insertion",
      projectId,
      pageId,
      elementId,
      "PROPERTIES",
      "second-insertion",
      "second-hash",
      "{}",
      "{}",
      1,
      1,
      fixedNow,
    );
    current.close();

    const version4 = new Database(path);
    version4.pragma("foreign_keys = OFF");
    version4.exec(`
      DROP TABLE binding_query_runs;
      DROP TABLE sample_data_commands;
      DROP TABLE relationship_layout_history_operations;
      DROP TABLE relationship_layout_commands;
      DROP TABLE relationship_node_positions;
      DROP TRIGGER projects_initialize_relationship_viewport;
      DROP TABLE project_relationship_viewports;
      DROP TABLE binding_history_operations;
      DROP TABLE binding_commands;
      DROP TABLE bindings;
      DROP TRIGGER projects_initialize_binding_state;
      DROP TABLE project_binding_states;
      DROP TRIGGER projects_initialize_schema_state;
      DROP TABLE schema_commands;
      DROP TABLE schema_backups;
      DROP TABLE schema_migration_plans;
      DROP TABLE data_relations;
      DROP TABLE data_fields;
      DROP TABLE data_tables;
      DROP TABLE project_schema_states;
      DROP TABLE element_binding_placeholders;
      DROP TABLE layout_preset_instance_elements;
      DROP TABLE layout_preset_instances;
      DROP TABLE element_history_operations;
      DELETE FROM metadata_migrations WHERE version >= 5;
    `);
    version4.pragma("user_version = 4");
    version4.close();

    const migrated = new MetadataDatabase(path);
    try {
      expect(
        migrated.connection
          .prepare(
            `SELECT id, history_sequence FROM element_commands
             WHERE project_id = ? ORDER BY history_sequence`,
          )
          .all(projectId),
      ).toEqual([
        { id: "z-first-insertion", history_sequence: 1 },
        { id: "a-second-insertion", history_sequence: 2 },
      ]);
      expect(migrated.connection.pragma("foreign_key_check")).toEqual([]);
    } finally {
      migrated.close();
    }
  });
});
