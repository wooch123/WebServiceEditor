import type {
  DataFieldDto,
  DataRelationDto,
  DataSchemaExportDto,
  DataTableDto,
  SchemaMigrationPlanDto,
  SchemaPlanStatus,
} from "@webeditor/domain";
import type Database from "better-sqlite3";

import type { MetadataDatabase } from "../metadata/database.js";

export interface SchemaStateRow {
  readonly project_id: string;
  readonly draft_revision: number;
  readonly test_applied_revision: number;
  readonly test_schema_checksum: string | null;
  readonly production_applied_revision: number;
  readonly production_schema_checksum: string | null;
  readonly updated_at: string;
}

export interface DataTableRow {
  readonly id: string;
  readonly project_id: string;
  readonly display_name: string;
  readonly physical_name: string;
  readonly description: string | null;
  readonly revision: number;
  readonly created_at: string;
  readonly updated_at: string;
  readonly deleted_at: string | null;
}

export interface DataFieldRow {
  readonly id: string;
  readonly project_id: string;
  readonly table_id: string;
  readonly display_name: string;
  readonly physical_name: string;
  readonly field_type: DataFieldDto["type"];
  readonly primary_key: 0 | 1;
  readonly auto_increment: 0 | 1;
  readonly nullable: 0 | 1;
  readonly is_unique: 0 | 1;
  readonly default_value: string | null;
  readonly indexed: 0 | 1;
  readonly unit: string | null;
  readonly description: string | null;
  readonly sort_order: number;
  readonly revision: number;
  readonly created_at: string;
  readonly updated_at: string;
  readonly deleted_at: string | null;
}

export interface DataRelationRow {
  readonly id: string;
  readonly project_id: string;
  readonly display_name: string;
  readonly relation_type: DataRelationDto["type"];
  readonly source_table_id: string;
  readonly source_field_id: string;
  readonly target_table_id: string;
  readonly target_field_id: string;
  readonly on_delete: DataRelationDto["onDelete"];
  readonly revision: number;
  readonly created_at: string;
  readonly updated_at: string;
  readonly deleted_at: string | null;
}

export interface SchemaPlanRow {
  readonly id: string;
  readonly project_id: string;
  readonly target_environment: "test";
  readonly schema_revision: number;
  readonly project_revision: number;
  readonly schema_checksum: string;
  readonly snapshot_json: string;
  readonly plan_json: string;
  readonly status: SchemaPlanStatus;
  readonly backup_id: string | null;
  readonly backup_checksum: string | null;
  readonly result_json: string | null;
  readonly error_json: string | null;
  readonly created_at: string;
  readonly expires_at: string;
  readonly started_at: string | null;
  readonly completed_at: string | null;
}

export interface SchemaCommandRow {
  readonly id: string;
  readonly project_id: string;
  readonly object_id: string | null;
  readonly command_type: string;
  readonly idempotency_key: string;
  readonly request_hash: string;
  readonly response_status: number;
  readonly response_json: string;
  readonly created_at: string;
}

const tableColumns = `
  id, project_id, display_name, physical_name, description, revision,
  created_at, updated_at, deleted_at
`;
const fieldColumns = `
  id, project_id, table_id, display_name, physical_name, field_type,
  primary_key, auto_increment, nullable, is_unique, default_value, indexed,
  unit, description, sort_order, revision, created_at, updated_at, deleted_at
`;
const relationColumns = `
  id, project_id, display_name, relation_type, source_table_id,
  source_field_id, target_table_id, target_field_id, on_delete, revision,
  created_at, updated_at, deleted_at
`;

export class SchemaRepository {
  constructor(readonly metadataDatabase: MetadataDatabase) {}

  get connection(): Database.Database {
    return this.metadataDatabase.connection;
  }

  state(projectId: string): SchemaStateRow | undefined {
    return this.connection
      .prepare("SELECT * FROM project_schema_states WHERE project_id = ?")
      .get(projectId) as SchemaStateRow | undefined;
  }

  tables(projectId: string): readonly DataTableRow[] {
    return this.connection
      .prepare(
        `SELECT ${tableColumns} FROM data_tables
         WHERE project_id = ? AND deleted_at IS NULL
         ORDER BY created_at, id`,
      )
      .all(projectId) as readonly DataTableRow[];
  }

  fields(projectId: string): readonly DataFieldRow[] {
    return this.connection
      .prepare(
        `SELECT ${fieldColumns} FROM data_fields
         WHERE project_id = ? AND deleted_at IS NULL
         ORDER BY table_id, sort_order, id`,
      )
      .all(projectId) as readonly DataFieldRow[];
  }

  relations(projectId: string): readonly DataRelationRow[] {
    return this.connection
      .prepare(
        `SELECT ${relationColumns} FROM data_relations
         WHERE project_id = ? AND deleted_at IS NULL
         ORDER BY created_at, id`,
      )
      .all(projectId) as readonly DataRelationRow[];
  }

  table(tableId: string): DataTableRow | undefined {
    return this.connection
      .prepare(`SELECT ${tableColumns} FROM data_tables WHERE id = ?`)
      .get(tableId) as DataTableRow | undefined;
  }

  field(fieldId: string): DataFieldRow | undefined {
    return this.connection
      .prepare(`SELECT ${fieldColumns} FROM data_fields WHERE id = ?`)
      .get(fieldId) as DataFieldRow | undefined;
  }

  relation(relationId: string): DataRelationRow | undefined {
    return this.connection
      .prepare(`SELECT ${relationColumns} FROM data_relations WHERE id = ?`)
      .get(relationId) as DataRelationRow | undefined;
  }

  command(projectId: string, key: string): SchemaCommandRow | undefined {
    return this.connection
      .prepare(
        "SELECT * FROM schema_commands WHERE project_id = ? AND idempotency_key = ?",
      )
      .get(projectId, key) as SchemaCommandRow | undefined;
  }

  plan(planId: string): SchemaPlanRow | undefined {
    return this.connection
      .prepare("SELECT * FROM schema_migration_plans WHERE id = ?")
      .get(planId) as SchemaPlanRow | undefined;
  }

  applyingPlans(): readonly SchemaPlanRow[] {
    return this.connection
      .prepare(
        "SELECT * FROM schema_migration_plans WHERE status = 'APPLYING' ORDER BY started_at, id",
      )
      .all() as readonly SchemaPlanRow[];
  }

  activeTableCount(projectId: string): number {
    const row = this.connection
      .prepare(
        "SELECT COUNT(*) AS count FROM data_tables WHERE project_id = ? AND deleted_at IS NULL",
      )
      .get(projectId) as { readonly count: number };
    return row.count;
  }

  deleteOwnedDefinitions(projectId: string): void {
    this.connection
      .prepare("DELETE FROM schema_commands WHERE project_id = ?")
      .run(projectId);
    this.connection
      .prepare("DELETE FROM schema_migration_plans WHERE project_id = ?")
      .run(projectId);
    this.connection
      .prepare("DELETE FROM data_tables WHERE project_id = ?")
      .run(projectId);
    this.connection
      .prepare("DELETE FROM project_schema_states WHERE project_id = ?")
      .run(projectId);
  }

  exportDefinition(projectId: string): DataSchemaExportDto {
    const state = this.state(projectId);
    if (state === undefined) {
      throw new Error("Project schema state is missing");
    }
    const fieldsByTable = new Map<string, DataFieldDto[]>();
    for (const row of this.fields(projectId)) {
      const list = fieldsByTable.get(row.table_id) ?? [];
      list.push(this.fieldDto(row));
      fieldsByTable.set(row.table_id, list);
    }
    return {
      schemaVersion: 1,
      schemaRevision: state.draft_revision,
      testAppliedRevision: state.test_applied_revision,
      testSchemaChecksum: state.test_schema_checksum,
      productionAppliedRevision: state.production_applied_revision,
      productionSchemaChecksum: state.production_schema_checksum,
      tables: this.tables(projectId).map((row) =>
        this.tableDto(row, fieldsByTable.get(row.id) ?? []),
      ),
      relations: this.relations(projectId).map((row) => this.relationDto(row)),
    };
  }

  insertImportedDefinition(options: {
    readonly projectId: string;
    readonly source: DataSchemaExportDto;
    readonly tableIdMap: ReadonlyMap<string, string>;
    readonly fieldIdMap: ReadonlyMap<string, string>;
    readonly relationIdMap: ReadonlyMap<string, string>;
    readonly now: string;
  }): void {
    const { projectId, source, tableIdMap, fieldIdMap, relationIdMap, now } =
      options;
    for (const table of source.tables) {
      const tableId = tableIdMap.get(table.id);
      if (tableId === undefined)
        throw new Error("Imported Table ID map is incomplete");
      this.connection
        .prepare(
          `INSERT INTO data_tables (
            id, project_id, display_name, physical_name, description,
            revision, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          tableId,
          projectId,
          table.displayName,
          table.physicalName,
          table.description,
          table.revision,
          now,
          now,
        );
      for (const field of table.fields) {
        const fieldId = fieldIdMap.get(field.id);
        if (fieldId === undefined)
          throw new Error("Imported Field ID map is incomplete");
        this.connection
          .prepare(
            `INSERT INTO data_fields (
              id, project_id, table_id, display_name, physical_name,
              field_type, primary_key, auto_increment, nullable, is_unique,
              default_value, indexed, unit, description, sort_order, revision,
              created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            fieldId,
            projectId,
            tableId,
            field.displayName,
            field.physicalName,
            field.type,
            field.primaryKey ? 1 : 0,
            field.autoIncrement ? 1 : 0,
            field.nullable ? 1 : 0,
            field.unique ? 1 : 0,
            field.defaultValue,
            field.indexed ? 1 : 0,
            field.unit,
            field.description,
            field.sortOrder,
            field.revision,
            now,
            now,
          );
      }
    }
    for (const relation of source.relations) {
      const relationId = relationIdMap.get(relation.id);
      const sourceTableId = tableIdMap.get(relation.sourceTableId);
      const sourceFieldId = fieldIdMap.get(relation.sourceFieldId);
      const targetTableId = tableIdMap.get(relation.targetTableId);
      const targetFieldId = fieldIdMap.get(relation.targetFieldId);
      if (
        relationId === undefined ||
        sourceTableId === undefined ||
        sourceFieldId === undefined ||
        targetTableId === undefined ||
        targetFieldId === undefined
      ) {
        throw new Error("Imported Relation ID map is incomplete");
      }
      this.connection
        .prepare(
          `INSERT INTO data_relations (
            id, project_id, display_name, relation_type, source_table_id,
            source_field_id, target_table_id, target_field_id, on_delete,
            revision, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          relationId,
          projectId,
          relation.displayName,
          relation.type,
          sourceTableId,
          sourceFieldId,
          targetTableId,
          targetFieldId,
          relation.onDelete,
          relation.revision,
          now,
          now,
        );
    }
    this.connection
      .prepare(
        `UPDATE project_schema_states SET
          draft_revision = ?, test_applied_revision = ?,
          test_schema_checksum = ?, production_applied_revision = ?,
          production_schema_checksum = ?, updated_at = ?
         WHERE project_id = ?`,
      )
      .run(
        source.schemaRevision,
        source.testAppliedRevision,
        source.testSchemaChecksum,
        source.productionAppliedRevision,
        source.productionSchemaChecksum,
        now,
        projectId,
      );
  }

  tableDto(row: DataTableRow, fields: readonly DataFieldDto[]): DataTableDto {
    return {
      id: row.id,
      projectId: row.project_id,
      displayName: row.display_name,
      physicalName: row.physical_name,
      description: row.description,
      revision: row.revision,
      rowCount: 0,
      fields,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  fieldDto(row: DataFieldRow): DataFieldDto {
    return {
      id: row.id,
      projectId: row.project_id,
      tableId: row.table_id,
      displayName: row.display_name,
      physicalName: row.physical_name,
      type: row.field_type,
      primaryKey: row.primary_key === 1,
      autoIncrement: row.auto_increment === 1,
      nullable: row.nullable === 1,
      unique: row.is_unique === 1,
      defaultValue: row.default_value,
      indexed: row.indexed === 1,
      unit: row.unit,
      description: row.description,
      sortOrder: row.sort_order,
      revision: row.revision,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  relationDto(row: DataRelationRow): DataRelationDto {
    return {
      id: row.id,
      projectId: row.project_id,
      displayName: row.display_name,
      type: row.relation_type,
      sourceTableId: row.source_table_id,
      sourceFieldId: row.source_field_id,
      targetTableId: row.target_table_id,
      targetFieldId: row.target_field_id,
      onDelete: row.on_delete,
      revision: row.revision,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  planDto(row: SchemaPlanRow): SchemaMigrationPlanDto {
    return JSON.parse(row.plan_json) as SchemaMigrationPlanDto;
  }
}
