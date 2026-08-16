import { describe, expect, it } from "vitest";

import { MetadataDatabase } from "../../src/metadata/database.js";

describe("MetadataDatabase", () => {
  it("applies the initial schema transactionally and reports readiness", () => {
    const database = new MetadataDatabase(":memory:");

    try {
      expect(database.assertReady()).toMatchObject({
        foreignKeysEnabled: true,
        integrity: "ok",
        schemaVersion: 15,
      });
    } finally {
      database.close();
    }
  });

  it("rejects reversed or duplicate active Binding endpoints at the SQLite boundary", () => {
    const database = new MetadataDatabase(":memory:");
    const projectId = "00000000-0000-4000-8000-000000000001";
    const now = "2026-08-16T00:00:00.000Z";
    const insertBinding = database.connection.prepare(`
      INSERT INTO bindings (
        id, project_id, binding_type,
        source_node_type, source_object_id, source_node_id, source_port_id,
        source_port_role, source_side, source_direction, source_value_type,
        target_node_type, target_object_id, target_node_id, target_port_id,
        target_port_role, target_side, target_direction, target_value_type,
        query_json, mapping_json, status, revision, created_at, updated_at
      ) VALUES (
        @id, @projectId, 'READ',
        'table', @sourceObjectId, @sourceNodeId, @sourcePortId,
        'value', @sourceSide, @sourceDirection, 'number',
        'element', @targetObjectId, @targetNodeId, @targetPortId,
        'rows', @targetSide, @targetDirection, 'number',
        '{}', '{}', 'READY', 1, @now, @now
      )
    `);
    const base = {
      id: "00000000-0000-4000-8000-000000000002",
      projectId,
      sourceObjectId: "00000000-0000-4000-8000-000000000003",
      sourceNodeId: "table:00000000-0000-4000-8000-000000000004",
      sourcePortId: "00000000-0000-4000-8000-000000000003:value:output:0",
      sourceSide: "right",
      sourceDirection: "output",
      targetObjectId: "00000000-0000-4000-8000-000000000005",
      targetNodeId: "element:00000000-0000-4000-8000-000000000005",
      targetPortId: "00000000-0000-4000-8000-000000000005:rows:input:0",
      targetSide: "left",
      targetDirection: "input",
      now,
    };

    try {
      database.connection
        .prepare(
          `INSERT INTO projects (
             id, name, slug, lifecycle_status, status, schema_version,
             revision, lifecycle_revision, favorite, theme_id, created_at,
             updated_at, original_storage_path, current_storage_path
           ) VALUES (?, 'Binding Project', 'binding-project', 'ACTIVE',
             'DRAFT', 1, 1, 0, 0, 'light-clean-paper', ?, ?, ?, ?)`,
        )
        .run(projectId, now, now, `active/${projectId}`, `active/${projectId}`);

      expect(() =>
        insertBinding.run({ ...base, sourceSide: "left" }),
      ).toThrow();
      expect(() =>
        insertBinding.run({
          ...base,
          id: "00000000-0000-4000-8000-000000000006",
          targetDirection: "output",
        }),
      ).toThrow();

      insertBinding.run(base);
      expect(() =>
        insertBinding.run({
          ...base,
          id: "00000000-0000-4000-8000-000000000007",
        }),
      ).toThrow();
    } finally {
      database.close();
    }
  });

  it("constrains Phase 11 query evidence and sample command replay rows", () => {
    const database = new MetadataDatabase(":memory:");
    const projectId = "00000000-0000-4000-8000-000000000011";
    const now = "2026-08-16T00:00:00.000Z";
    try {
      database.connection
        .prepare(
          `INSERT INTO projects (
             id, name, slug, lifecycle_status, status, schema_version,
             revision, lifecycle_revision, favorite, theme_id, created_at,
             updated_at, original_storage_path, current_storage_path
           ) VALUES (?, 'READ Project', 'read-project', 'ACTIVE',
             'DRAFT', 1, 1, 0, 0, 'light-clean-paper', ?, ?, ?, ?)`,
        )
        .run(projectId, now, now, `active/${projectId}`, `active/${projectId}`);
      const insertRun = database.connection.prepare(`
        INSERT INTO binding_query_runs (
          id, project_id, binding_id, environment, plan_checksum, row_count,
          truncated, status, error_code, created_at
        ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, NULL, ?)
      `);
      expect(() =>
        insertRun.run(
          "00000000-0000-4000-8000-000000000012",
          projectId,
          "draft",
          "a".repeat(64),
          0,
          0,
          "SUCCEEDED",
          now,
        ),
      ).toThrow();
      expect(() =>
        insertRun.run(
          "00000000-0000-4000-8000-000000000013",
          projectId,
          "test",
          "not-a-checksum",
          0,
          0,
          "SUCCEEDED",
          now,
        ),
      ).toThrow();
      expect(() =>
        insertRun.run(
          "00000000-0000-4000-8000-000000000014",
          projectId,
          "test",
          "b".repeat(64),
          -1,
          0,
          "SUCCEEDED",
          now,
        ),
      ).toThrow();
      insertRun.run(
        "00000000-0000-4000-8000-000000000015",
        projectId,
        "test",
        "c".repeat(64),
        12,
        0,
        "SUCCEEDED",
        now,
      );

      const insertCommand = database.connection.prepare(`
        INSERT INTO sample_data_commands (
          id, project_id, command_type, idempotency_key, request_hash,
          response_status, response_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      expect(() =>
        insertCommand.run(
          "00000000-0000-4000-8000-000000000016",
          projectId,
          "GENERATE",
          "sample-key",
          "d".repeat(64),
          500,
          "{}",
          now,
        ),
      ).toThrow();
      expect(() =>
        insertCommand.run(
          "00000000-0000-4000-8000-000000000017",
          projectId,
          "GENERATE",
          "sample-key",
          "d".repeat(64),
          200,
          "not-json",
          now,
        ),
      ).toThrow();
    } finally {
      database.close();
    }
  });
});
