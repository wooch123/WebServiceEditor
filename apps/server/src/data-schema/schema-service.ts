import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, sep } from "node:path";

import {
  DATA_FIELD_TYPES,
  DATA_RELATION_DELETE_ACTIONS,
  DATA_RELATION_TYPES,
  DATA_SCHEMA_VERSION,
  DATA_TABLE_TEMPLATES,
  type ApplySchemaMigrationDto,
  type ApplySchemaMigrationRequest,
  type CreateDataFieldRequest,
  type CreateDataRelationRequest,
  type CreateDataTableRequest,
  type CreateSchemaMigrationPlanRequest,
  type DataFieldDto,
  type DataFieldType,
  type DataRelationDto,
  type DataSchemaDto,
  type DataTableDto,
  type DeleteDataFieldRequest,
  type DeleteDataRelationRequest,
  type DeleteDataTableRequest,
  type PatchDataFieldRequest,
  type PatchDataRelationRequest,
  type PatchDataTableRequest,
  type SchemaImpactDto,
  type SchemaMigrationPlanDto,
  type SchemaMigrationStepDto,
} from "@webeditor/domain";
import Database from "better-sqlite3";

import { ApiError, assertApi } from "../errors.js";
import type { MetadataDatabase } from "../metadata/database.js";
import { ProjectRepository } from "../projects/project-repository.js";
import type { ProjectStorage } from "../projects/project-storage.js";
import {
  SchemaRepository,
  type SchemaCommandRow,
} from "./schema-repository.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PHYSICAL_TABLE_PATTERN = /^t_[0-9a-f]{32}$/;
const PHYSICAL_FIELD_PATTERN = /^c_[0-9a-f]{32}$/;
const PLAN_TTL_MILLISECONDS = 5 * 60 * 1000;
const fieldTypes = new Set<string>(DATA_FIELD_TYPES);
const relationTypes = new Set<string>(DATA_RELATION_TYPES);
const deleteActions = new Set<string>(DATA_RELATION_DELETE_ACTIONS);
const tableTemplates = new Set<string>(DATA_TABLE_TEMPLATES);

export type SchemaFailurePoint =
  | "schema:after-backup"
  | "schema:before-runtime-swap"
  | "schema:after-runtime-swap"
  | "schema:before-metadata-finalize"
  | "production-schema:after-backup"
  | "production-schema:before-runtime-swap"
  | "production-schema:after-runtime-swap"
  | "production-schema:before-metadata-finalize"
  | "production-schema:after-metadata-finalize";

export interface SchemaServiceOptions {
  readonly metadataDatabase: MetadataDatabase;
  readonly projectStorage: ProjectStorage;
  readonly clock?: () => Date;
  readonly failureInjector?: (point: SchemaFailurePoint) => void;
}

interface DesiredSchemaSnapshot {
  readonly projectId: string;
  readonly schemaRevision: number;
  readonly tables: readonly DataTableDto[];
  readonly relations: readonly DataRelationDto[];
}

interface RuntimeTableShape {
  readonly physicalName: string;
  readonly columns: readonly string[];
  readonly rowCount: number;
}

interface ProductionSchemaDeploymentJournal {
  readonly schemaVersion: 1;
  readonly projectId: string;
  readonly backupId: string;
  readonly backupRelativePath: string;
  readonly backupChecksum: string;
  readonly previousRevision: number;
  readonly previousChecksum: string | null;
  readonly desiredRevision: number;
  readonly desiredChecksum: string;
  readonly createdAt: string;
}

export interface ProductionSchemaDeployment {
  readonly schemaRevision: number;
  readonly schemaChecksum: string;
  readonly databaseChecksum: string;
  readonly rowCountBefore: number;
  readonly rowCountAfter: number;
  readonly changed: boolean;
}

interface FieldInput {
  readonly displayName: string;
  readonly type: DataFieldType;
  readonly primaryKey: boolean;
  readonly autoIncrement: boolean;
  readonly nullable: boolean;
  readonly unique: boolean;
  readonly defaultValue: string | null;
  readonly indexed: boolean;
  readonly unit: string | null;
  readonly description: string | null;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function requestHash(operation: string, scope: string, value: unknown): string {
  return sha256(stableJson({ operation, scope, value }));
}

function physicalName(prefix: "t" | "c"): string {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

function quoteIdentifier(identifier: string): string {
  assertApi(
    PHYSICAL_TABLE_PATTERN.test(identifier) ||
      PHYSICAL_FIELD_PATTERN.test(identifier),
    500,
    "INVALID_PHYSICAL_IDENTIFIER",
    "Stored physical identifier is invalid",
  );
  return `"${identifier}"`;
}

function assertUuid(
  value: unknown,
  code: string,
  label: string,
): asserts value is string {
  assertApi(
    typeof value === "string" && UUID_PATTERN.test(value),
    400,
    code,
    `${label} is invalid`,
  );
}

function revision(value: unknown, code: string): number {
  assertApi(
    Number.isSafeInteger(value) && (value as number) >= 0,
    400,
    code,
    "Revision is invalid",
  );
  return value as number;
}

function idempotencyKey(value: unknown): string {
  assertApi(
    typeof value === "string" && value.length >= 8 && value.length <= 200,
    400,
    "INVALID_IDEMPOTENCY_KEY",
    "Idempotency key is invalid",
  );
  return value;
}

function text(
  value: unknown,
  label: string,
  maximum: number,
  nullable = false,
): string | null {
  if (nullable && (value === undefined || value === null || value === "")) {
    return null;
  }
  assertApi(
    typeof value === "string" &&
      value.trim().length > 0 &&
      value.trim().length <= maximum,
    400,
    `INVALID_${label.toUpperCase().replaceAll(" ", "_")}`,
    `${label} is invalid`,
  );
  return value.trim();
}

function boolean(value: unknown, fallback: boolean, label: string): boolean {
  if (value === undefined) return fallback;
  assertApi(
    typeof value === "boolean",
    400,
    `INVALID_${label.toUpperCase().replaceAll(" ", "_")}`,
    `${label} must be boolean`,
  );
  return value;
}

function compileDefault(field: DataFieldDto): string {
  if (field.defaultValue === null) return "";
  const raw = field.defaultValue;
  if (field.type === "INTEGER") {
    assertApi(
      /^-?\d+$/.test(raw),
      422,
      "INVALID_FIELD_DEFAULT",
      "INTEGER default must be an integer",
      { fieldId: field.id },
    );
    return ` DEFAULT ${raw}`;
  }
  if (field.type === "REAL") {
    assertApi(
      /^-?(?:\d+\.?\d*|\.\d+)$/.test(raw),
      422,
      "INVALID_FIELD_DEFAULT",
      "REAL default must be numeric",
      { fieldId: field.id },
    );
    return ` DEFAULT ${raw}`;
  }
  if (field.type === "BOOLEAN") {
    assertApi(
      raw === "0" || raw === "1" || raw === "true" || raw === "false",
      422,
      "INVALID_FIELD_DEFAULT",
      "BOOLEAN default must be true, false, 0, or 1",
      { fieldId: field.id },
    );
    return ` DEFAULT ${raw === "true" ? "1" : raw === "false" ? "0" : raw}`;
  }
  if (
    raw === "CURRENT_TIMESTAMP" &&
    (field.type === "DATE" || field.type === "DATETIME")
  ) {
    return " DEFAULT CURRENT_TIMESTAMP";
  }
  return ` DEFAULT '${raw.replaceAll("'", "''")}'`;
}

function sqliteType(type: DataFieldType): string {
  switch (type) {
    case "INTEGER":
    case "BOOLEAN":
      return "INTEGER";
    case "REAL":
      return "REAL";
    case "BLOB":
      return "BLOB";
    default:
      return "TEXT";
  }
}

function commandError(row: SchemaCommandRow): never {
  const payload = JSON.parse(row.response_json) as {
    readonly error?: {
      readonly code?: unknown;
      readonly message?: unknown;
      readonly details?: unknown;
    };
  };
  assertApi(
    typeof payload.error?.code === "string" &&
      typeof payload.error.message === "string",
    409,
    "SCHEMA_COMMAND_REPLAY_INVALID",
    "Stored schema command response is invalid",
  );
  throw new ApiError(
    row.response_status,
    payload.error.code,
    payload.error.message,
    payload.error.details,
  );
}

export class SchemaService {
  readonly repository: SchemaRepository;
  readonly projectRepository: ProjectRepository;
  readonly storage: ProjectStorage;
  readonly #clock: () => Date;
  readonly #failureInjector: ((point: SchemaFailurePoint) => void) | undefined;

  constructor(options: SchemaServiceOptions) {
    this.repository = new SchemaRepository(options.metadataDatabase);
    this.projectRepository = new ProjectRepository(options.metadataDatabase);
    this.storage = options.projectStorage;
    this.#clock = options.clock ?? (() => new Date());
    this.#failureInjector = options.failureInjector;
    this.#recoverApplyingPlans();
    this.#recoverProductionDeployments();
  }

  #now(): string {
    return this.#clock().toISOString();
  }

  #activeProject(projectId: string) {
    assertUuid(projectId, "INVALID_PROJECT_ID", "Project ID");
    const project = this.projectRepository.get(projectId);
    assertApi(
      project !== undefined,
      404,
      "PROJECT_NOT_FOUND",
      "Project was not found",
    );
    assertApi(
      project.lifecycle_status === "ACTIVE",
      409,
      "PROJECT_NOT_ACTIVE",
      "Schema is available only for active projects",
    );
    return project;
  }

  #state(projectId: string) {
    const state = this.repository.state(projectId);
    assertApi(
      state !== undefined,
      500,
      "SCHEMA_STATE_MISSING",
      "Project schema state is missing",
    );
    return state;
  }

  #runtimePath(projectId: string, environment: "test" | "production"): string {
    const root = this.storage.activePath(projectId);
    const path = join(root, `${environment}.sqlite`);
    const fromRoot = relative(root, path);
    assertApi(
      fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`),
      500,
      "RUNTIME_PATH_ESCAPE",
      "Runtime database path escaped project storage",
    );
    assertApi(
      existsSync(path),
      503,
      "RUNTIME_DATABASE_MISSING",
      "Runtime database is missing",
      { environment },
    );
    return path;
  }

  #runtimeState(projectId: string, environment: "test" | "production") {
    const path = this.#runtimePath(projectId, environment);
    const database = new Database(path, {
      readonly: true,
      fileMustExist: true,
    });
    try {
      assertApi(
        database.pragma("quick_check", { simple: true }) === "ok",
        503,
        "RUNTIME_DATABASE_INTEGRITY_FAILED",
        "Runtime database integrity check failed",
        { environment },
      );
      const exists = database
        .prepare(
          "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'webeditor_runtime_schema_state'",
        )
        .get() as { readonly present: 1 } | undefined;
      if (exists === undefined) {
        return { revision: 0, checksum: null, integrity: "ok" as const };
      }
      const row = database
        .prepare(
          "SELECT schema_revision AS revision, schema_checksum AS checksum FROM webeditor_runtime_schema_state WHERE project_id = ? AND environment = ?",
        )
        .get(projectId, environment) as
        { readonly revision: number; readonly checksum: string } | undefined;
      assertApi(
        row !== undefined,
        503,
        "RUNTIME_SCHEMA_STATE_INVALID",
        "Runtime schema state is invalid",
        { environment },
      );
      return { ...row, integrity: "ok" as const };
    } finally {
      database.close();
    }
  }

  schema(projectId: string): DataSchemaDto {
    const project = this.#activeProject(projectId);
    const state = this.#state(projectId);
    const fieldRows = this.repository.fields(projectId);
    const fieldsByTable = new Map<string, DataFieldDto[]>();
    for (const row of fieldRows) {
      const list = fieldsByTable.get(row.table_id) ?? [];
      list.push(this.repository.fieldDto(row));
      fieldsByTable.set(row.table_id, list);
    }
    const test = this.#runtimeState(projectId, "test");
    const production = this.#runtimeState(projectId, "production");
    const testRows = this.#runtimeRowCounts(projectId, "test");
    const tables = this.repository.tables(projectId).map((row) => ({
      ...this.repository.tableDto(row, fieldsByTable.get(row.id) ?? []),
      rowCount: testRows.get(row.physical_name) ?? 0,
    }));
    return {
      schemaVersion: DATA_SCHEMA_VERSION,
      projectId,
      schemaRevision: state.draft_revision,
      projectRevision: project.revision,
      tables,
      relations: this.repository
        .relations(projectId)
        .map((row) => this.repository.relationDto(row)),
      runtime: {
        test: {
          environment: "test",
          appliedRevision: test.revision,
          schemaChecksum: test.checksum,
          drift: test.revision !== state.draft_revision,
          integrity: test.integrity,
        },
        production: {
          environment: "production",
          appliedRevision: production.revision,
          schemaChecksum: production.checksum,
          drift: production.revision !== state.draft_revision,
          integrity: production.integrity,
        },
      },
    };
  }

  createTable(
    projectId: string,
    request: CreateDataTableRequest,
  ): DataSchemaDto {
    const displayName = text(
      request.displayName,
      "table display name",
      120,
    ) as string;
    const description = text(
      request.description,
      "table description",
      1000,
      true,
    );
    assertApi(
      typeof request.template === "string" &&
        tableTemplates.has(request.template),
      400,
      "INVALID_TABLE_TEMPLATE",
      "Table template is invalid",
    );
    return this.#definitionMutation({
      projectId,
      request,
      expectedProjectRevision: request.expectedProjectRevision,
      expectedSchemaRevision: request.expectedSchemaRevision,
      idempotencyKey: request.idempotencyKey,
      commandType: "TABLE_CREATE",
      objectId: null,
      mutate: (now) => {
        this.#assertDisplayNameAvailable(
          "data_tables",
          projectId,
          null,
          displayName,
        );
        const tableId = randomUUID();
        this.repository.connection
          .prepare(
            `INSERT INTO data_tables (
              id, project_id, display_name, physical_name, description,
              revision, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
          )
          .run(
            tableId,
            projectId,
            displayName,
            physicalName("t"),
            description,
            now,
            now,
          );
        for (const [index, field] of this.#templateFields(
          request.template,
        ).entries()) {
          this.#insertField(projectId, tableId, field, index, now);
        }
        return tableId;
      },
    });
  }

  patchTable(tableId: string, request: PatchDataTableRequest): DataSchemaDto {
    assertUuid(tableId, "INVALID_TABLE_ID", "Table ID");
    const row = this.repository.table(tableId);
    assertApi(
      row !== undefined && row.deleted_at === null,
      404,
      "TABLE_NOT_FOUND",
      "Table was not found",
    );
    const displayName =
      request.displayName === undefined
        ? row.display_name
        : (text(request.displayName, "table display name", 120) as string);
    const description =
      request.description === undefined
        ? row.description
        : text(request.description, "table description", 1000, true);
    return this.#definitionMutation({
      projectId: row.project_id,
      request,
      expectedProjectRevision: request.expectedProjectRevision,
      expectedSchemaRevision: request.expectedSchemaRevision,
      idempotencyKey: request.idempotencyKey,
      commandType: "TABLE_UPDATE",
      objectId: tableId,
      mutate: (now) => {
        this.#assertObjectRevision(
          row.revision,
          request.expectedRevision,
          "TABLE_REVISION_CONFLICT",
        );
        this.#assertDisplayNameAvailable(
          "data_tables",
          row.project_id,
          tableId,
          displayName,
        );
        const result = this.repository.connection
          .prepare(
            `UPDATE data_tables SET display_name = ?, description = ?,
               revision = revision + 1, updated_at = ?
             WHERE id = ? AND deleted_at IS NULL AND revision = ?`,
          )
          .run(
            displayName,
            description,
            now,
            tableId,
            request.expectedRevision,
          );
        assertApi(
          result.changes === 1,
          409,
          "TABLE_REVISION_CONFLICT",
          "Table changed before this request",
        );
        return tableId;
      },
    });
  }

  deleteTable(tableId: string, request: DeleteDataTableRequest): DataSchemaDto {
    assertUuid(tableId, "INVALID_TABLE_ID", "Table ID");
    const row = this.repository.table(tableId);
    assertApi(
      row !== undefined && row.deleted_at === null,
      404,
      "TABLE_NOT_FOUND",
      "Table was not found",
    );
    return this.#definitionMutation({
      projectId: row.project_id,
      request,
      expectedProjectRevision: request.expectedProjectRevision,
      expectedSchemaRevision: request.expectedSchemaRevision,
      idempotencyKey: request.idempotencyKey,
      commandType: "TABLE_DELETE",
      objectId: tableId,
      mutate: (now) => {
        this.#assertObjectRevision(
          row.revision,
          request.expectedRevision,
          "TABLE_REVISION_CONFLICT",
        );
        const connection = this.repository.connection;
        connection
          .prepare(
            "UPDATE data_relations SET deleted_at = ?, updated_at = ? WHERE project_id = ? AND deleted_at IS NULL AND (source_table_id = ? OR target_table_id = ?)",
          )
          .run(now, now, row.project_id, tableId, tableId);
        connection
          .prepare(
            "UPDATE data_fields SET deleted_at = ?, updated_at = ? WHERE table_id = ? AND deleted_at IS NULL",
          )
          .run(now, now, tableId);
        const result = connection
          .prepare(
            "UPDATE data_tables SET deleted_at = ?, updated_at = ?, revision = revision + 1 WHERE id = ? AND deleted_at IS NULL AND revision = ?",
          )
          .run(now, now, tableId, request.expectedRevision);
        assertApi(
          result.changes === 1,
          409,
          "TABLE_REVISION_CONFLICT",
          "Table changed before this request",
        );
        return tableId;
      },
    });
  }

  createField(tableId: string, request: CreateDataFieldRequest): DataSchemaDto {
    assertUuid(tableId, "INVALID_TABLE_ID", "Table ID");
    const table = this.repository.table(tableId);
    assertApi(
      table !== undefined && table.deleted_at === null,
      404,
      "TABLE_NOT_FOUND",
      "Table was not found",
    );
    const input = this.#fieldInput(request);
    return this.#definitionMutation({
      projectId: table.project_id,
      request,
      expectedProjectRevision: request.expectedProjectRevision,
      expectedSchemaRevision: request.expectedSchemaRevision,
      idempotencyKey: request.idempotencyKey,
      commandType: "FIELD_CREATE",
      objectId: tableId,
      mutate: (now) => {
        this.#assertDisplayNameAvailable(
          "data_fields",
          tableId,
          null,
          input.displayName,
        );
        const count = this.repository.connection
          .prepare(
            "SELECT COUNT(*) AS count FROM data_fields WHERE table_id = ? AND deleted_at IS NULL",
          )
          .get(tableId) as { readonly count: number };
        const fieldId = this.#insertField(
          table.project_id,
          tableId,
          input,
          count.count,
          now,
        );
        return fieldId;
      },
    });
  }

  patchField(fieldId: string, request: PatchDataFieldRequest): DataSchemaDto {
    assertUuid(fieldId, "INVALID_FIELD_ID", "Field ID");
    const row = this.repository.field(fieldId);
    assertApi(
      row !== undefined && row.deleted_at === null,
      404,
      "FIELD_NOT_FOUND",
      "Field was not found",
    );
    const input = this.#fieldInput({
      displayName: request.displayName ?? row.display_name,
      type: request.type ?? row.field_type,
      primaryKey: request.primaryKey ?? row.primary_key === 1,
      autoIncrement: request.autoIncrement ?? row.auto_increment === 1,
      nullable: request.nullable ?? row.nullable === 1,
      unique: request.unique ?? row.is_unique === 1,
      defaultValue:
        request.defaultValue === undefined
          ? row.default_value
          : request.defaultValue,
      indexed: request.indexed ?? row.indexed === 1,
      unit: request.unit === undefined ? row.unit : request.unit,
      description:
        request.description === undefined
          ? row.description
          : request.description,
    });
    return this.#definitionMutation({
      projectId: row.project_id,
      request,
      expectedProjectRevision: request.expectedProjectRevision,
      expectedSchemaRevision: request.expectedSchemaRevision,
      idempotencyKey: request.idempotencyKey,
      commandType: "FIELD_UPDATE",
      objectId: fieldId,
      mutate: (now) => {
        this.#assertObjectRevision(
          row.revision,
          request.expectedRevision,
          "FIELD_REVISION_CONFLICT",
        );
        this.#assertDisplayNameAvailable(
          "data_fields",
          row.table_id,
          fieldId,
          input.displayName,
        );
        const result = this.repository.connection
          .prepare(
            `
          UPDATE data_fields SET display_name = ?, field_type = ?, primary_key = ?,
            auto_increment = ?, nullable = ?, is_unique = ?, default_value = ?,
            indexed = ?, unit = ?, description = ?, revision = revision + 1,
            updated_at = ? WHERE id = ? AND deleted_at IS NULL AND revision = ?
        `,
          )
          .run(
            input.displayName,
            input.type,
            input.primaryKey ? 1 : 0,
            input.autoIncrement ? 1 : 0,
            input.nullable ? 1 : 0,
            input.unique ? 1 : 0,
            input.defaultValue,
            input.indexed ? 1 : 0,
            input.unit,
            input.description,
            now,
            fieldId,
            request.expectedRevision,
          );
        assertApi(
          result.changes === 1,
          409,
          "FIELD_REVISION_CONFLICT",
          "Field changed before this request",
        );
        return fieldId;
      },
    });
  }

  deleteField(fieldId: string, request: DeleteDataFieldRequest): DataSchemaDto {
    assertUuid(fieldId, "INVALID_FIELD_ID", "Field ID");
    const row = this.repository.field(fieldId);
    assertApi(
      row !== undefined && row.deleted_at === null,
      404,
      "FIELD_NOT_FOUND",
      "Field was not found",
    );
    return this.#definitionMutation({
      projectId: row.project_id,
      request,
      expectedProjectRevision: request.expectedProjectRevision,
      expectedSchemaRevision: request.expectedSchemaRevision,
      idempotencyKey: request.idempotencyKey,
      commandType: "FIELD_DELETE",
      objectId: fieldId,
      mutate: (now) => {
        this.#assertObjectRevision(
          row.revision,
          request.expectedRevision,
          "FIELD_REVISION_CONFLICT",
        );
        const count = this.repository.connection
          .prepare(
            "SELECT COUNT(*) AS count FROM data_fields WHERE table_id = ? AND deleted_at IS NULL",
          )
          .get(row.table_id) as { readonly count: number };
        assertApi(
          count.count > 1,
          409,
          "LAST_FIELD_DELETE_BLOCKED",
          "A table must retain at least one field",
        );
        const connection = this.repository.connection;
        connection
          .prepare(
            "UPDATE data_relations SET deleted_at = ?, updated_at = ? WHERE project_id = ? AND deleted_at IS NULL AND (source_field_id = ? OR target_field_id = ?)",
          )
          .run(now, now, row.project_id, fieldId, fieldId);
        const result = connection
          .prepare(
            "UPDATE data_fields SET deleted_at = ?, updated_at = ?, revision = revision + 1 WHERE id = ? AND deleted_at IS NULL AND revision = ?",
          )
          .run(now, now, fieldId, request.expectedRevision);
        assertApi(
          result.changes === 1,
          409,
          "FIELD_REVISION_CONFLICT",
          "Field changed before this request",
        );
        return fieldId;
      },
    });
  }

  createRelation(
    projectId: string,
    request: CreateDataRelationRequest,
  ): DataSchemaDto {
    const displayName = text(
      request.displayName,
      "relation display name",
      120,
    ) as string;
    const endpoints = this.#relationInput(projectId, request);
    return this.#definitionMutation({
      projectId,
      request,
      expectedProjectRevision: request.expectedProjectRevision,
      expectedSchemaRevision: request.expectedSchemaRevision,
      idempotencyKey: request.idempotencyKey,
      commandType: "RELATION_CREATE",
      objectId: null,
      mutate: (now) => {
        const id = randomUUID();
        this.repository.connection
          .prepare(
            `
          INSERT INTO data_relations (
            id, project_id, display_name, relation_type, source_table_id,
            source_field_id, target_table_id, target_field_id, on_delete,
            revision, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
        `,
          )
          .run(
            id,
            projectId,
            displayName,
            endpoints.type,
            endpoints.sourceTable.id,
            endpoints.sourceField.id,
            endpoints.targetTable.id,
            endpoints.targetField.id,
            endpoints.onDelete,
            now,
            now,
          );
        return id;
      },
    });
  }

  patchRelation(
    relationId: string,
    request: PatchDataRelationRequest,
  ): DataSchemaDto {
    assertUuid(relationId, "INVALID_RELATION_ID", "Relation ID");
    const row = this.repository.relation(relationId);
    assertApi(
      row !== undefined && row.deleted_at === null,
      404,
      "RELATION_NOT_FOUND",
      "Relation was not found",
    );
    const displayName =
      request.displayName === undefined
        ? row.display_name
        : (text(request.displayName, "relation display name", 120) as string);
    const type = request.type ?? row.relation_type;
    const onDelete = request.onDelete ?? row.on_delete;
    assertApi(
      relationTypes.has(type),
      400,
      "INVALID_RELATION_TYPE",
      "Relation type is invalid",
    );
    assertApi(
      deleteActions.has(onDelete),
      400,
      "INVALID_RELATION_DELETE_ACTION",
      "Relation delete action is invalid",
    );
    return this.#definitionMutation({
      projectId: row.project_id,
      request,
      expectedProjectRevision: request.expectedProjectRevision,
      expectedSchemaRevision: request.expectedSchemaRevision,
      idempotencyKey: request.idempotencyKey,
      commandType: "RELATION_UPDATE",
      objectId: relationId,
      mutate: (now) => {
        this.#assertObjectRevision(
          row.revision,
          request.expectedRevision,
          "RELATION_REVISION_CONFLICT",
        );
        const result = this.repository.connection
          .prepare(
            "UPDATE data_relations SET display_name = ?, relation_type = ?, on_delete = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND deleted_at IS NULL AND revision = ?",
          )
          .run(
            displayName,
            type,
            onDelete,
            now,
            relationId,
            request.expectedRevision,
          );
        assertApi(
          result.changes === 1,
          409,
          "RELATION_REVISION_CONFLICT",
          "Relation changed before this request",
        );
        return relationId;
      },
    });
  }

  deleteRelation(
    relationId: string,
    request: DeleteDataRelationRequest,
  ): DataSchemaDto {
    assertUuid(relationId, "INVALID_RELATION_ID", "Relation ID");
    const row = this.repository.relation(relationId);
    assertApi(
      row !== undefined && row.deleted_at === null,
      404,
      "RELATION_NOT_FOUND",
      "Relation was not found",
    );
    return this.#definitionMutation({
      projectId: row.project_id,
      request,
      expectedProjectRevision: request.expectedProjectRevision,
      expectedSchemaRevision: request.expectedSchemaRevision,
      idempotencyKey: request.idempotencyKey,
      commandType: "RELATION_DELETE",
      objectId: relationId,
      mutate: (now) => {
        this.#assertObjectRevision(
          row.revision,
          request.expectedRevision,
          "RELATION_REVISION_CONFLICT",
        );
        const result = this.repository.connection
          .prepare(
            "UPDATE data_relations SET deleted_at = ?, updated_at = ?, revision = revision + 1 WHERE id = ? AND deleted_at IS NULL AND revision = ?",
          )
          .run(now, now, relationId, request.expectedRevision);
        assertApi(
          result.changes === 1,
          409,
          "RELATION_REVISION_CONFLICT",
          "Relation changed before this request",
        );
        return relationId;
      },
    });
  }

  plan(
    projectId: string,
    request: CreateSchemaMigrationPlanRequest,
  ): { readonly plan: SchemaMigrationPlanDto } {
    const project = this.#activeProject(projectId);
    const state = this.#state(projectId);
    this.#assertRevisions(
      project.revision,
      state.draft_revision,
      request.expectedProjectRevision,
      request.expectedSchemaRevision,
    );
    const snapshot = this.#snapshot(projectId, state.draft_revision);
    const checksum = sha256(stableJson(snapshot));
    const actual = this.#runtimeTables(projectId, "test");
    const steps: SchemaMigrationStepDto[] = [];
    const desiredByName = new Map(
      snapshot.tables.map((table) => [table.physicalName, table]),
    );
    let droppedTableCount = 0;
    let droppedFieldCount = 0;
    let affectedRowCount = 0;
    for (const table of snapshot.tables) {
      const current = actual.get(table.physicalName);
      if (current === undefined) {
        steps.push({
          order: steps.length + 1,
          kind: "CREATE_TABLE",
          tableId: table.id,
          label: `Create ${table.displayName}`,
          destructive: false,
          affectedRows: 0,
        });
        continue;
      }
      const desiredNames = new Set(
        table.fields.map((field) => field.physicalName),
      );
      const removed = current.columns.filter(
        (column) => !desiredNames.has(column),
      );
      droppedFieldCount += removed.length;
      if (removed.length > 0) affectedRowCount += current.rowCount;
      steps.push({
        order: steps.length + 1,
        kind: "REBUILD_TABLE",
        tableId: table.id,
        label: `Rebuild ${table.displayName}`,
        destructive: removed.length > 0,
        affectedRows: current.rowCount,
      });
    }
    for (const current of actual.values()) {
      if (
        PHYSICAL_TABLE_PATTERN.test(current.physicalName) &&
        !desiredByName.has(current.physicalName)
      ) {
        droppedTableCount += 1;
        affectedRowCount += current.rowCount;
        steps.push({
          order: steps.length + 1,
          kind: "DROP_TABLE",
          tableId: null,
          label: `Remove ${current.physicalName}`,
          destructive: true,
          affectedRows: current.rowCount,
        });
      }
    }
    for (const relation of snapshot.relations) {
      steps.push({
        order: steps.length + 1,
        kind: "CREATE_RELATION",
        tableId: relation.sourceTableId,
        label: relation.displayName,
        destructive: false,
        affectedRows: 0,
      });
    }
    for (const table of snapshot.tables) {
      if (table.fields.some((field) => field.indexed)) {
        steps.push({
          order: steps.length + 1,
          kind: "CREATE_INDEX",
          tableId: table.id,
          label: `Index ${table.displayName}`,
          destructive: false,
          affectedRows: 0,
        });
      }
    }
    const impact: SchemaImpactDto = {
      destructive: droppedTableCount > 0 || droppedFieldCount > 0,
      droppedTableCount,
      droppedFieldCount,
      affectedRowCount,
      relationCount: snapshot.relations.length,
    };
    const now = this.#now();
    const plan: SchemaMigrationPlanDto = {
      id: randomUUID(),
      projectId,
      target: "test",
      schemaRevision: state.draft_revision,
      projectRevision: project.revision,
      schemaChecksum: checksum,
      status: "READY",
      impact,
      steps,
      createdAt: now,
      expiresAt: new Date(
        this.#clock().getTime() + PLAN_TTL_MILLISECONDS,
      ).toISOString(),
    };
    this.repository.connection
      .prepare(
        `
      INSERT INTO schema_migration_plans (
        id, project_id, target_environment, schema_revision, project_revision,
        schema_checksum, snapshot_json, plan_json, status, created_at, expires_at
      ) VALUES (?, ?, 'test', ?, ?, ?, ?, ?, 'READY', ?, ?)
    `,
      )
      .run(
        plan.id,
        projectId,
        plan.schemaRevision,
        plan.projectRevision,
        checksum,
        stableJson(snapshot),
        JSON.stringify(plan),
        now,
        plan.expiresAt,
      );
    return { plan };
  }

  apply(
    projectId: string,
    request: ApplySchemaMigrationRequest,
  ): ApplySchemaMigrationDto {
    const key = idempotencyKey(request.idempotencyKey);
    const hash = requestHash("SCHEMA_APPLY", projectId, request);
    const replay = this.#replay<ApplySchemaMigrationDto>(projectId, key, hash);
    if (replay !== undefined) return replay;
    const project = this.#activeProject(projectId);
    const state = this.#state(projectId);
    this.#assertRevisions(
      project.revision,
      state.draft_revision,
      request.expectedProjectRevision,
      request.expectedSchemaRevision,
    );
    assertUuid(request.planId, "INVALID_SCHEMA_PLAN_ID", "Schema plan ID");
    const row = this.repository.plan(request.planId);
    assertApi(
      row !== undefined && row.project_id === projectId,
      404,
      "SCHEMA_PLAN_NOT_FOUND",
      "Schema migration plan was not found",
    );
    assertApi(
      row.status === "READY",
      409,
      "SCHEMA_PLAN_ALREADY_USED",
      "Schema migration plan is not ready",
    );
    assertApi(
      new Date(row.expires_at).getTime() > this.#clock().getTime(),
      409,
      "SCHEMA_PLAN_EXPIRED",
      "Schema migration plan expired",
    );
    assertApi(
      row.schema_revision === state.draft_revision &&
        row.project_revision === project.revision,
      409,
      "SCHEMA_PLAN_STALE",
      "Schema migration plan is stale",
    );
    assertApi(
      !this.repository.planDto(row).impact.destructive ||
        request.confirmDestructive === true,
      409,
      "DESTRUCTIVE_SCHEMA_CONFIRMATION_REQUIRED",
      "Destructive schema changes require confirmation",
    );
    const snapshot = JSON.parse(row.snapshot_json) as DesiredSchemaSnapshot;
    assertApi(
      sha256(stableJson(snapshot)) === row.schema_checksum,
      500,
      "SCHEMA_PLAN_CHECKSUM_MISMATCH",
      "Stored schema plan checksum is invalid",
    );

    const activeRoot = this.storage.activePath(projectId);
    const runtimePath = this.#runtimePath(projectId, "test");
    const backupId = randomUUID();
    const backupRoot = join(
      this.storage.backupsRoot,
      projectId,
      "schema",
      backupId,
    );
    const backupPath = join(backupRoot, "test.sqlite");
    const stagingPath = join(activeRoot, `.schema-${row.id}.sqlite`);
    mkdirSync(backupRoot, { recursive: true });
    this.#checkpoint(runtimePath);
    copyFileSync(runtimePath, backupPath);
    this.#fsyncFile(backupPath);
    const backupChecksum = sha256(readFileSync(backupPath));
    const sizeBytes = statSync(backupPath).size;
    const startedAt = this.#now();
    this.repository.metadataDatabase.transaction(() => {
      this.repository.connection
        .prepare(
          "INSERT INTO schema_backups (id, project_id, plan_id, environment, relative_path, checksum, size_bytes, verified, created_at) VALUES (?, ?, ?, 'test', ?, ?, ?, 1, ?)",
        )
        .run(
          backupId,
          projectId,
          row.id,
          relative(this.storage.root, backupPath).replaceAll(sep, "/"),
          backupChecksum,
          sizeBytes,
          startedAt,
        );
      this.repository.connection
        .prepare(
          "UPDATE schema_migration_plans SET status = 'APPLYING', backup_id = ?, backup_checksum = ?, started_at = ? WHERE id = ? AND status = 'READY'",
        )
        .run(backupId, backupChecksum, startedAt, row.id);
    });
    this.#failureInjector?.("schema:after-backup");

    let rowCountBefore = 0;
    let rowCountAfter = 0;
    try {
      rmSync(stagingPath, { force: true });
      const built = this.#buildRuntimeDatabase(
        runtimePath,
        stagingPath,
        snapshot,
        row.schema_checksum,
        "test",
      );
      rowCountBefore = built.before;
      rowCountAfter = built.after;
      this.#failureInjector?.("schema:before-runtime-swap");
      renameSync(stagingPath, runtimePath);
      this.#fsyncDirectory(dirname(runtimePath));
      this.#failureInjector?.("schema:after-runtime-swap");
      const runtime = this.#runtimeState(projectId, "test");
      assertApi(
        runtime.revision === row.schema_revision &&
          runtime.checksum === row.schema_checksum,
        500,
        "SCHEMA_RUNTIME_VERIFY_FAILED",
        "Applied runtime schema did not match its plan",
      );
      this.#failureInjector?.("schema:before-metadata-finalize");
      const databaseChecksum = sha256(readFileSync(runtimePath));
      const completedAt = this.#now();
      let response!: ApplySchemaMigrationDto;
      this.repository.metadataDatabase.transaction(() => {
        this.repository.connection
          .prepare(
            "UPDATE project_schema_states SET test_applied_revision = ?, test_schema_checksum = ?, updated_at = ? WHERE project_id = ?",
          )
          .run(
            row.schema_revision,
            row.schema_checksum,
            completedAt,
            projectId,
          );
        const appliedPlan = {
          ...this.repository.planDto(row),
          status: "APPLIED" as const,
        };
        response = {
          plan: appliedPlan,
          schema: this.schema(projectId),
          backupId,
          backupChecksum,
          databaseChecksum,
          rowCountBefore,
          rowCountAfter,
          integrity: "ok",
        };
        this.repository.connection
          .prepare(
            "UPDATE schema_migration_plans SET status = 'APPLIED', result_json = ?, completed_at = ? WHERE id = ? AND status = 'APPLYING'",
          )
          .run(JSON.stringify(response), completedAt, row.id);
        this.#storeCommand(
          projectId,
          null,
          "SCHEMA_APPLY",
          key,
          hash,
          200,
          response,
          completedAt,
        );
        this.#audit(
          projectId,
          "SCHEMA_APPLIED",
          row.id,
          null,
          response,
          key,
          completedAt,
        );
      });
      return response;
    } catch (error) {
      rmSync(stagingPath, { force: true });
      if (
        existsSync(backupPath) &&
        sha256(readFileSync(backupPath)) === backupChecksum
      ) {
        copyFileSync(backupPath, runtimePath);
        this.#fsyncFile(runtimePath);
        this.#fsyncDirectory(dirname(runtimePath));
      }
      const failedAt = this.#now();
      this.repository.connection
        .prepare(
          "UPDATE schema_migration_plans SET status = 'FAILED', error_json = ?, completed_at = ? WHERE id = ? AND status = 'APPLYING'",
        )
        .run(
          JSON.stringify({
            message:
              error instanceof Error ? error.message : "Schema apply failed",
          }),
          failedAt,
          row.id,
        );
      throw error;
    }
  }

  synchronizeProductionForPublish(
    projectId: string,
    expectedProjectRevision: number,
  ): ProductionSchemaDeployment {
    const project = this.#activeProject(projectId);
    const state = this.#state(projectId);
    this.#assertRevisions(
      project.revision,
      state.draft_revision,
      expectedProjectRevision,
      state.draft_revision,
    );
    const snapshot = this.#snapshot(projectId, state.draft_revision);
    const desiredChecksum = sha256(stableJson(snapshot));
    if (snapshot.tables.length > 0 || snapshot.relations.length > 0) {
      const test = this.#runtimeState(projectId, "test");
      assertApi(
        state.test_applied_revision === state.draft_revision &&
          state.test_schema_checksum === desiredChecksum &&
          test.revision === state.draft_revision &&
          test.checksum === desiredChecksum,
        409,
        "SCHEMA_TEST_NOT_APPLIED",
        "Apply the current schema to Test before publishing",
        {
          draftRevision: state.draft_revision,
          testAppliedRevision: test.revision,
        },
      );
    }
    const current = this.#runtimeState(projectId, "production");
    const runtimePath = this.#runtimePath(projectId, "production");
    if (
      state.production_applied_revision === state.draft_revision &&
      state.production_schema_checksum === desiredChecksum &&
      current.revision === state.draft_revision &&
      current.checksum === desiredChecksum
    ) {
      return {
        schemaRevision: state.draft_revision,
        schemaChecksum: desiredChecksum,
        databaseChecksum: sha256(readFileSync(runtimePath)),
        rowCountBefore: this.#runtimeRowTotal(projectId, "production"),
        rowCountAfter: this.#runtimeRowTotal(projectId, "production"),
        changed: false,
      };
    }

    const activeRoot = this.storage.activePath(projectId);
    const backupId = randomUUID();
    const backupRoot = join(
      this.storage.backupsRoot,
      projectId,
      "schema",
      backupId,
    );
    const backupPath = join(backupRoot, "production.sqlite");
    const stagingPath = join(
      activeRoot,
      `.production-schema-${backupId}.sqlite`,
    );
    const journalPath = this.#productionJournalPath(projectId);
    mkdirSync(backupRoot, { recursive: true });
    this.#checkpoint(runtimePath);
    copyFileSync(runtimePath, backupPath);
    this.#fsyncFile(backupPath);
    this.#fsyncDirectory(backupRoot);
    const journal: ProductionSchemaDeploymentJournal = {
      schemaVersion: 1,
      projectId,
      backupId,
      backupRelativePath: relative(this.storage.root, backupPath).replaceAll(
        sep,
        "/",
      ),
      backupChecksum: sha256(readFileSync(backupPath)),
      previousRevision: state.production_applied_revision,
      previousChecksum: state.production_schema_checksum,
      desiredRevision: state.draft_revision,
      desiredChecksum,
      createdAt: this.#now(),
    };
    this.#writeProductionJournal(journalPath, journal);
    this.#failureInjector?.("production-schema:after-backup");

    try {
      rmSync(stagingPath, { force: true });
      const built = this.#buildRuntimeDatabase(
        runtimePath,
        stagingPath,
        snapshot,
        desiredChecksum,
        "production",
      );
      this.#failureInjector?.("production-schema:before-runtime-swap");
      renameSync(stagingPath, runtimePath);
      this.#fsyncDirectory(dirname(runtimePath));
      this.#failureInjector?.("production-schema:after-runtime-swap");
      const deployed = this.#runtimeState(projectId, "production");
      assertApi(
        deployed.revision === state.draft_revision &&
          deployed.checksum === desiredChecksum,
        500,
        "PRODUCTION_SCHEMA_VERIFY_FAILED",
        "Production schema did not match the publish definition",
      );
      this.#failureInjector?.("production-schema:before-metadata-finalize");
      const completedAt = this.#now();
      const databaseChecksum = sha256(readFileSync(runtimePath));
      this.repository.metadataDatabase.transaction(() => {
        const update = this.repository.connection
          .prepare(
            `UPDATE project_schema_states SET
               production_applied_revision = ?, production_schema_checksum = ?,
               updated_at = ? WHERE project_id = ? AND draft_revision = ?`,
          )
          .run(
            state.draft_revision,
            desiredChecksum,
            completedAt,
            projectId,
            state.draft_revision,
          );
        assertApi(
          update.changes === 1,
          409,
          "SCHEMA_REVISION_CONFLICT",
          "Schema changed while Production was being prepared",
        );
        this.#audit(
          projectId,
          "PRODUCTION_SCHEMA_DEPLOYED",
          backupId,
          {
            revision: journal.previousRevision,
            checksum: journal.previousChecksum,
          },
          {
            revision: state.draft_revision,
            checksum: desiredChecksum,
            databaseChecksum,
            rowCountBefore: built.before,
            rowCountAfter: built.after,
          },
          `production-schema:${backupId}`,
          completedAt,
        );
      });
      this.#failureInjector?.("production-schema:after-metadata-finalize");
      this.#removeProductionJournal(journalPath);
      return {
        schemaRevision: state.draft_revision,
        schemaChecksum: desiredChecksum,
        databaseChecksum,
        rowCountBefore: built.before,
        rowCountAfter: built.after,
        changed: true,
      };
    } catch (error) {
      rmSync(stagingPath, { force: true });
      this.#restoreProductionDeployment(journal, journalPath);
      throw error;
    }
  }

  #definitionMutation(options: {
    readonly projectId: string;
    readonly request: unknown;
    readonly expectedProjectRevision: number;
    readonly expectedSchemaRevision: number;
    readonly idempotencyKey: string;
    readonly commandType: string;
    readonly objectId: string | null;
    readonly mutate: (now: string) => string;
  }): DataSchemaDto {
    const key = idempotencyKey(options.idempotencyKey);
    const hash = requestHash(
      options.commandType,
      options.projectId,
      options.request,
    );
    const replay = this.#replay<DataSchemaDto>(options.projectId, key, hash);
    if (replay !== undefined) return replay;
    const project = this.#activeProject(options.projectId);
    const state = this.#state(options.projectId);
    this.#assertRevisions(
      project.revision,
      state.draft_revision,
      options.expectedProjectRevision,
      options.expectedSchemaRevision,
    );
    const now = this.#now();
    let response!: DataSchemaDto;
    this.repository.metadataDatabase.transaction(() => {
      const objectId = options.mutate(now);
      const stateUpdate = this.repository.connection
        .prepare(
          "UPDATE project_schema_states SET draft_revision = draft_revision + 1, updated_at = ? WHERE project_id = ? AND draft_revision = ?",
        )
        .run(now, options.projectId, options.expectedSchemaRevision);
      const projectUpdate = this.repository.connection
        .prepare(
          "UPDATE projects SET revision = revision + 1, updated_at = ? WHERE id = ? AND lifecycle_status = 'ACTIVE' AND revision = ?",
        )
        .run(now, options.projectId, options.expectedProjectRevision);
      assertApi(
        stateUpdate.changes === 1,
        409,
        "SCHEMA_REVISION_CONFLICT",
        "Schema changed before this request",
      );
      assertApi(
        projectUpdate.changes === 1,
        409,
        "PROJECT_REVISION_CONFLICT",
        "Project changed before this request",
      );
      response = this.schema(options.projectId);
      this.#storeCommand(
        options.projectId,
        objectId ?? options.objectId,
        options.commandType,
        key,
        hash,
        200,
        response,
        now,
      );
      this.#audit(
        options.projectId,
        options.commandType,
        objectId,
        null,
        response,
        key,
        now,
      );
    });
    return response;
  }

  #replay<T>(projectId: string, key: string, hash: string): T | undefined {
    const row = this.repository.command(projectId, key);
    if (row === undefined) return undefined;
    assertApi(
      row.request_hash === hash,
      409,
      "IDEMPOTENCY_PAYLOAD_CONFLICT",
      "Idempotency key was used with another schema request",
    );
    if (row.response_status >= 400) commandError(row);
    return JSON.parse(row.response_json) as T;
  }

  #storeCommand(
    projectId: string,
    objectId: string | null,
    commandType: string,
    key: string,
    hash: string,
    status: number,
    response: unknown,
    now: string,
  ): void {
    this.repository.connection
      .prepare(
        "INSERT INTO schema_commands (id, project_id, object_id, command_type, idempotency_key, request_hash, response_status, response_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        randomUUID(),
        projectId,
        objectId,
        commandType,
        key,
        hash,
        status,
        JSON.stringify(response),
        now,
      );
  }

  #audit(
    projectId: string,
    action: string,
    objectId: string,
    before: unknown,
    after: unknown,
    correlationId: string,
    now: string,
  ): void {
    this.repository.connection
      .prepare(
        "INSERT INTO audit_logs (id, project_id, action, object_type, object_id, before_json, after_json, correlation_id, created_at) VALUES (?, ?, ?, 'DATA_SCHEMA', ?, ?, ?, ?, ?)",
      )
      .run(
        randomUUID(),
        projectId,
        action,
        objectId,
        before === null ? null : JSON.stringify(before),
        JSON.stringify(after),
        correlationId,
        now,
      );
  }

  #assertRevisions(
    projectRevision: number,
    schemaRevision: number,
    expectedProjectRevision: unknown,
    expectedSchemaRevision: unknown,
  ): void {
    const expectedProject = revision(
      expectedProjectRevision,
      "INVALID_PROJECT_REVISION",
    );
    const expectedSchema = revision(
      expectedSchemaRevision,
      "INVALID_SCHEMA_REVISION",
    );
    assertApi(
      projectRevision === expectedProject,
      409,
      "PROJECT_REVISION_CONFLICT",
      "Project changed before this request",
      { latestRevision: projectRevision },
    );
    assertApi(
      schemaRevision === expectedSchema,
      409,
      "SCHEMA_REVISION_CONFLICT",
      "Schema changed before this request",
      { latestRevision: schemaRevision },
    );
  }

  #assertObjectRevision(actual: number, expected: unknown, code: string): void {
    assertApi(
      actual === revision(expected, `INVALID_${code}`),
      409,
      code,
      "Definition changed before this request",
      { latestRevision: actual },
    );
  }

  #assertDisplayNameAvailable(
    table: "data_tables" | "data_fields",
    scopeId: string,
    excludingId: string | null,
    displayName: string,
  ): void {
    const scopeColumn = table === "data_tables" ? "project_id" : "table_id";
    const row = this.repository.connection
      .prepare(
        `SELECT id FROM ${table} WHERE ${scopeColumn} = ? AND deleted_at IS NULL AND display_name = ? COLLATE NOCASE AND (? IS NULL OR id != ?) LIMIT 1`,
      )
      .get(scopeId, displayName, excludingId, excludingId);
    assertApi(
      row === undefined,
      409,
      "SCHEMA_DISPLAY_NAME_CONFLICT",
      "A definition already uses this display name",
    );
  }

  #fieldInput(
    request: Partial<CreateDataFieldRequest> & {
      readonly displayName: unknown;
      readonly type: unknown;
    },
  ): FieldInput {
    const displayName = text(
      request.displayName,
      "field display name",
      120,
    ) as string;
    assertApi(
      typeof request.type === "string" && fieldTypes.has(request.type),
      400,
      "INVALID_FIELD_TYPE",
      "Field type is invalid",
    );
    const primaryKey = boolean(request.primaryKey, false, "primary key");
    const autoIncrement = boolean(
      request.autoIncrement,
      false,
      "auto increment",
    );
    const nullable = primaryKey
      ? false
      : boolean(request.nullable, true, "nullable");
    const unique = boolean(request.unique, false, "unique");
    const indexed = boolean(request.indexed, false, "indexed");
    assertApi(
      !autoIncrement || (primaryKey && request.type === "INTEGER"),
      400,
      "INVALID_AUTO_INCREMENT",
      "Auto increment requires an INTEGER primary key",
    );
    const defaultValue =
      request.defaultValue === undefined ||
      request.defaultValue === null ||
      request.defaultValue === ""
        ? null
        : (text(request.defaultValue, "field default", 1000) as string);
    return {
      displayName,
      type: request.type as DataFieldType,
      primaryKey,
      autoIncrement,
      nullable,
      unique,
      defaultValue,
      indexed,
      unit: text(request.unit, "field unit", 100, true),
      description: text(request.description, "field description", 1000, true),
    };
  }

  #insertField(
    projectId: string,
    tableId: string,
    input: FieldInput,
    sortOrder: number,
    now: string,
  ): string {
    const id = randomUUID();
    this.repository.connection
      .prepare(
        `
      INSERT INTO data_fields (
        id, project_id, table_id, display_name, physical_name, field_type,
        primary_key, auto_increment, nullable, is_unique, default_value,
        indexed, unit, description, sort_order, revision, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `,
      )
      .run(
        id,
        projectId,
        tableId,
        input.displayName,
        physicalName("c"),
        input.type,
        input.primaryKey ? 1 : 0,
        input.autoIncrement ? 1 : 0,
        input.nullable ? 1 : 0,
        input.unique ? 1 : 0,
        input.defaultValue,
        input.indexed ? 1 : 0,
        input.unit,
        input.description,
        sortOrder,
        now,
        now,
      );
    return id;
  }

  #templateFields(
    template: CreateDataTableRequest["template"],
  ): readonly FieldInput[] {
    const field = (
      value: Partial<CreateDataFieldRequest> & {
        readonly displayName: unknown;
        readonly type: unknown;
      },
    ) => this.#fieldInput(value);
    if (template === "ENTITY")
      return [
        field({ displayName: "ID", type: "TEXT", primaryKey: true }),
        field({
          displayName: "생성일",
          type: "DATETIME",
          nullable: false,
          defaultValue: "CURRENT_TIMESTAMP",
          indexed: true,
        }),
        field({
          displayName: "수정일",
          type: "DATETIME",
          nullable: false,
          defaultValue: "CURRENT_TIMESTAMP",
        }),
      ];
    if (template === "TIME_SERIES")
      return [
        field({ displayName: "ID", type: "TEXT", primaryKey: true }),
        field({
          displayName: "시각",
          type: "DATETIME",
          nullable: false,
          indexed: true,
        }),
        field({ displayName: "값", type: "REAL", nullable: false }),
      ];
    return [field({ displayName: "ID", type: "TEXT", primaryKey: true })];
  }

  #relationInput(projectId: string, request: CreateDataRelationRequest) {
    assertUuid(
      request.sourceTableId,
      "INVALID_SOURCE_TABLE_ID",
      "Source table ID",
    );
    assertUuid(
      request.sourceFieldId,
      "INVALID_SOURCE_FIELD_ID",
      "Source field ID",
    );
    assertUuid(
      request.targetTableId,
      "INVALID_TARGET_TABLE_ID",
      "Target table ID",
    );
    assertUuid(
      request.targetFieldId,
      "INVALID_TARGET_FIELD_ID",
      "Target field ID",
    );
    assertApi(
      relationTypes.has(request.type),
      400,
      "INVALID_RELATION_TYPE",
      "Relation type is invalid",
    );
    assertApi(
      deleteActions.has(request.onDelete),
      400,
      "INVALID_RELATION_DELETE_ACTION",
      "Relation delete action is invalid",
    );
    const sourceTable = this.repository.table(request.sourceTableId);
    const sourceField = this.repository.field(request.sourceFieldId);
    const targetTable = this.repository.table(request.targetTableId);
    const targetField = this.repository.field(request.targetFieldId);
    assertApi(
      sourceTable?.project_id === projectId &&
        sourceTable.deleted_at === null &&
        sourceField?.project_id === projectId &&
        sourceField.table_id === sourceTable.id &&
        sourceField.deleted_at === null &&
        targetTable?.project_id === projectId &&
        targetTable.deleted_at === null &&
        targetField?.project_id === projectId &&
        targetField.table_id === targetTable.id &&
        targetField.deleted_at === null,
      400,
      "RELATION_ENDPOINT_INVALID",
      "Relation endpoints must be active fields in this project",
    );
    assertApi(
      sourceField.field_type === targetField.field_type,
      400,
      "RELATION_TYPE_MISMATCH",
      "Relation field types must match",
    );
    assertApi(
      targetField.primary_key === 1 || targetField.is_unique === 1,
      400,
      "RELATION_TARGET_NOT_UNIQUE",
      "Relation target must be primary or unique",
    );
    assertApi(
      request.onDelete !== "SET_NULL" || sourceField.nullable === 1,
      400,
      "RELATION_SET_NULL_REQUIRES_NULLABLE",
      "SET NULL requires a nullable source field",
    );
    return {
      type: request.type,
      onDelete: request.onDelete,
      sourceTable,
      sourceField,
      targetTable,
      targetField,
    };
  }

  #snapshot(projectId: string, schemaRevision: number): DesiredSchemaSnapshot {
    const fields = this.repository
      .fields(projectId)
      .map((row) => this.repository.fieldDto(row));
    const fieldsByTable = new Map<string, DataFieldDto[]>();
    for (const field of fields) {
      const list = fieldsByTable.get(field.tableId) ?? [];
      list.push(field);
      fieldsByTable.set(field.tableId, list);
    }
    return {
      projectId,
      schemaRevision,
      tables: this.repository
        .tables(projectId)
        .map((row) =>
          this.repository.tableDto(row, fieldsByTable.get(row.id) ?? []),
        ),
      relations: this.repository
        .relations(projectId)
        .map((row) => this.repository.relationDto(row)),
    };
  }

  #runtimeTables(
    projectId: string,
    environment: "test" | "production",
  ): Map<string, RuntimeTableShape> {
    const path = this.#runtimePath(projectId, environment);
    const database = new Database(path, {
      readonly: true,
      fileMustExist: true,
    });
    try {
      const rows = database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'webeditor_%' ORDER BY name",
        )
        .all() as readonly { readonly name: string }[];
      return new Map(
        rows.map(({ name }) => {
          assertApi(
            PHYSICAL_TABLE_PATTERN.test(name),
            409,
            "UNMANAGED_RUNTIME_TABLE",
            "Runtime database contains an unmanaged table",
            { table: name, environment },
          );
          const columns = database
            .prepare(`PRAGMA table_info(${quoteIdentifier(name)})`)
            .all() as readonly { readonly name: string }[];
          const count = database
            .prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(name)}`)
            .get() as { readonly count: number };
          return [
            name,
            {
              physicalName: name,
              columns: columns.map((column) => column.name),
              rowCount: count.count,
            },
          ];
        }),
      );
    } finally {
      database.close();
    }
  }

  #runtimeRowCounts(
    projectId: string,
    environment: "test" | "production",
  ): Map<string, number> {
    return new Map(
      [...this.#runtimeTables(projectId, environment)].map(([name, table]) => [
        name,
        table.rowCount,
      ]),
    );
  }

  #runtimeRowTotal(
    projectId: string,
    environment: "test" | "production",
  ): number {
    return [...this.#runtimeRowCounts(projectId, environment).values()].reduce(
      (total, count) => total + count,
      0,
    );
  }

  #buildRuntimeDatabase(
    sourcePath: string,
    stagingPath: string,
    snapshot: DesiredSchemaSnapshot,
    checksum: string,
    environment: "test" | "production",
  ): { readonly before: number; readonly after: number } {
    const source = new Database(sourcePath, {
      readonly: true,
      fileMustExist: true,
    });
    const target = new Database(stagingPath);
    let before = 0;
    let after = 0;
    try {
      target.pragma("journal_mode = DELETE");
      target.pragma("synchronous = FULL");
      target.pragma("foreign_keys = ON");
      target.exec(`
        CREATE TABLE webeditor_runtime_metadata (
          project_id TEXT NOT NULL,
          environment TEXT NOT NULL CHECK (environment IN ('test', 'production')),
          sentinel TEXT NOT NULL
        );
        CREATE TABLE webeditor_runtime_schema_state (
          project_id TEXT PRIMARY KEY NOT NULL,
          environment TEXT NOT NULL CHECK (environment IN ('test', 'production')),
          schema_revision INTEGER NOT NULL CHECK (schema_revision >= 0),
          schema_checksum TEXT NOT NULL,
          applied_at TEXT NOT NULL
        );
        CREATE TABLE webeditor_runtime_mutation_commands (
          command_id TEXT PRIMARY KEY NOT NULL,
          binding_id TEXT NOT NULL,
          idempotency_key TEXT NOT NULL,
          request_hash TEXT NOT NULL CHECK(length(request_hash) = 64),
          response_json TEXT NOT NULL CHECK(json_valid(response_json)),
          created_at TEXT NOT NULL,
          UNIQUE(binding_id, idempotency_key)
        );
      `);
      target
        .prepare(
          "INSERT INTO webeditor_runtime_metadata (project_id, environment, sentinel) VALUES (?, ?, ?)",
        )
        .run(
          snapshot.projectId,
          environment,
          `${snapshot.projectId}:${environment}:v1`,
        );
      target
        .prepare(
          "INSERT INTO webeditor_runtime_schema_state (project_id, environment, schema_revision, schema_checksum, applied_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run(
          snapshot.projectId,
          environment,
          snapshot.schemaRevision,
          checksum,
          this.#now(),
        );
      const sourceTables = this.#runtimeTables(snapshot.projectId, environment);
      target.prepare("ATTACH DATABASE ? AS source").run(sourcePath);
      const mutationCommandsExist = source
        .prepare(
          "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'webeditor_runtime_mutation_commands'",
        )
        .get() as { readonly present: 1 } | undefined;
      if (mutationCommandsExist !== undefined) {
        target.exec(`
          INSERT INTO webeditor_runtime_mutation_commands (
            command_id, binding_id, idempotency_key, request_hash,
            response_json, created_at
          )
          SELECT command_id, binding_id, idempotency_key, request_hash,
            response_json, created_at
          FROM source.webeditor_runtime_mutation_commands
        `);
      }
      const tableById = new Map(
        snapshot.tables.map((table) => [table.id, table]),
      );
      const relationsBySource = new Map<string, DataRelationDto[]>();
      for (const relation of snapshot.relations) {
        const list = relationsBySource.get(relation.sourceTableId) ?? [];
        list.push(relation);
        relationsBySource.set(relation.sourceTableId, list);
      }
      for (const table of snapshot.tables) {
        assertApi(
          table.fields.length > 0,
          422,
          "EMPTY_TABLE_SCHEMA",
          "A runtime table requires at least one field",
          { tableId: table.id },
        );
        const fieldById = new Map(
          table.fields.map((field) => [field.id, field]),
        );
        const definitions = table.fields.map((field) => {
          let sql = `${quoteIdentifier(field.physicalName)} ${sqliteType(field.type)}`;
          if (field.primaryKey) sql += " PRIMARY KEY";
          if (field.autoIncrement) sql += " AUTOINCREMENT";
          if (!field.nullable) sql += " NOT NULL";
          if (field.unique && !field.primaryKey) sql += " UNIQUE";
          sql += compileDefault(field);
          if (field.type === "BOOLEAN")
            sql += ` CHECK (${quoteIdentifier(field.physicalName)} IN (0, 1))`;
          if (field.type === "JSON")
            sql += ` CHECK (${quoteIdentifier(field.physicalName)} IS NULL OR json_valid(${quoteIdentifier(field.physicalName)}))`;
          return sql;
        });
        for (const relation of relationsBySource.get(table.id) ?? []) {
          const sourceField = fieldById.get(relation.sourceFieldId);
          const targetTable = tableById.get(relation.targetTableId);
          const targetField = targetTable?.fields.find(
            (field) => field.id === relation.targetFieldId,
          );
          assertApi(
            sourceField !== undefined &&
              targetTable !== undefined &&
              targetField !== undefined,
            422,
            "RELATION_ENDPOINT_INVALID",
            "Relation endpoint is missing from schema snapshot",
          );
          definitions.push(
            `FOREIGN KEY (${quoteIdentifier(sourceField.physicalName)}) REFERENCES ${quoteIdentifier(targetTable.physicalName)} (${quoteIdentifier(targetField.physicalName)}) ON DELETE ${relation.onDelete.replaceAll("_", " ")}`,
          );
        }
        target.exec(
          `CREATE TABLE ${quoteIdentifier(table.physicalName)} (${definitions.join(", ")})`,
        );
        const current = sourceTables.get(table.physicalName);
        if (current !== undefined) {
          before += current.rowCount;
          const currentColumns = new Set(current.columns);
          const retained = table.fields.filter((field) =>
            currentColumns.has(field.physicalName),
          );
          if (retained.length > 0) {
            const columns = retained
              .map((field) => quoteIdentifier(field.physicalName))
              .join(", ");
            target.exec(
              `INSERT INTO ${quoteIdentifier(table.physicalName)} (${columns}) SELECT ${columns} FROM source.${quoteIdentifier(table.physicalName)}`,
            );
          } else {
            assertApi(
              current.rowCount === 0,
              422,
              "SCHEMA_DATA_COPY_IMPOSSIBLE",
              "No compatible fields remain for a table with rows",
              { tableId: table.id },
            );
          }
        }
        for (const field of table.fields.filter(
          (item) => item.indexed && !item.primaryKey && !item.unique,
        )) {
          target.exec(
            `CREATE INDEX ${quoteIdentifier(`c_${sha256(`${table.id}:${field.id}`).slice(0, 32)}`)} ON ${quoteIdentifier(table.physicalName)} (${quoteIdentifier(field.physicalName)})`,
          );
        }
        const count = target
          .prepare(
            `SELECT COUNT(*) AS count FROM ${quoteIdentifier(table.physicalName)}`,
          )
          .get() as { readonly count: number };
        after += count.count;
        assertApi(
          current === undefined || count.count === current.rowCount,
          500,
          "SCHEMA_ROW_COUNT_MISMATCH",
          "Runtime row count changed during schema rebuild",
          {
            tableId: table.id,
            before: current?.rowCount ?? 0,
            after: count.count,
          },
        );
      }
      target.exec("DETACH DATABASE source");
      assertApi(
        target.pragma("quick_check", { simple: true }) === "ok",
        500,
        "SCHEMA_INTEGRITY_FAILED",
        "Staged runtime database failed integrity check",
      );
      const violations = target.pragma(
        "foreign_key_check",
      ) as readonly unknown[];
      assertApi(
        violations.length === 0,
        422,
        "SCHEMA_FOREIGN_KEY_FAILED",
        "Staged runtime database has foreign key violations",
        { count: violations.length },
      );
    } finally {
      target.close();
      source.close();
    }
    this.#fsyncFile(stagingPath);
    return { before, after };
  }

  #productionJournalPath(projectId: string): string {
    return join(
      this.storage.activePath(projectId),
      ".production-schema-deployment.json",
    );
  }

  #writeProductionJournal(
    journalPath: string,
    journal: ProductionSchemaDeploymentJournal,
  ): void {
    const temporaryPath = join(
      dirname(journalPath),
      `.production-schema-journal-${randomUUID()}.tmp`,
    );
    writeFileSync(temporaryPath, `${stableJson(journal)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    this.#fsyncFile(temporaryPath);
    renameSync(temporaryPath, journalPath);
    this.#fsyncDirectory(dirname(journalPath));
  }

  #removeProductionJournal(journalPath: string): void {
    rmSync(journalPath, { force: true });
    this.#fsyncDirectory(dirname(journalPath));
  }

  #readProductionJournal(
    projectId: string,
    journalPath: string,
  ): ProductionSchemaDeploymentJournal {
    let value: unknown;
    try {
      value = JSON.parse(readFileSync(journalPath, "utf8"));
    } catch {
      throw new ApiError(
        503,
        "PRODUCTION_SCHEMA_JOURNAL_INVALID",
        "Production schema recovery journal is invalid",
        { projectId },
      );
    }
    assertApi(
      value !== null && typeof value === "object" && !Array.isArray(value),
      503,
      "PRODUCTION_SCHEMA_JOURNAL_INVALID",
      "Production schema recovery journal is invalid",
      { projectId },
    );
    const journal = value as Partial<ProductionSchemaDeploymentJournal>;
    const exactKeys = [
      "schemaVersion",
      "projectId",
      "backupId",
      "backupRelativePath",
      "backupChecksum",
      "previousRevision",
      "previousChecksum",
      "desiredRevision",
      "desiredChecksum",
      "createdAt",
    ];
    assertApi(
      Object.keys(journal).sort().join("\u0000") ===
        [...exactKeys].sort().join("\u0000") &&
        journal.schemaVersion === 1 &&
        journal.projectId === projectId &&
        typeof journal.backupId === "string" &&
        UUID_PATTERN.test(journal.backupId) &&
        typeof journal.backupRelativePath === "string" &&
        typeof journal.backupChecksum === "string" &&
        /^[0-9a-f]{64}$/.test(journal.backupChecksum) &&
        Number.isSafeInteger(journal.previousRevision) &&
        (journal.previousRevision as number) >= 0 &&
        (journal.previousChecksum === null ||
          (typeof journal.previousChecksum === "string" &&
            /^[0-9a-f]{64}$/.test(journal.previousChecksum))) &&
        Number.isSafeInteger(journal.desiredRevision) &&
        (journal.desiredRevision as number) >= 0 &&
        typeof journal.desiredChecksum === "string" &&
        /^[0-9a-f]{64}$/.test(journal.desiredChecksum) &&
        typeof journal.createdAt === "string",
      503,
      "PRODUCTION_SCHEMA_JOURNAL_INVALID",
      "Production schema recovery journal is invalid",
      { projectId },
    );
    const expectedPath = relative(
      this.storage.root,
      join(
        this.storage.backupsRoot,
        projectId,
        "schema",
        journal.backupId,
        "production.sqlite",
      ),
    ).replaceAll(sep, "/");
    assertApi(
      journal.backupRelativePath === expectedPath,
      503,
      "PRODUCTION_SCHEMA_JOURNAL_INVALID",
      "Production schema recovery backup path is invalid",
      { projectId },
    );
    return journal as ProductionSchemaDeploymentJournal;
  }

  #restoreProductionDeployment(
    journal: ProductionSchemaDeploymentJournal,
    journalPath: string,
  ): void {
    const backupPath = join(this.storage.root, journal.backupRelativePath);
    assertApi(
      existsSync(backupPath) &&
        sha256(readFileSync(backupPath)) === journal.backupChecksum,
      503,
      "PRODUCTION_SCHEMA_RECOVERY_BACKUP_INVALID",
      "Production schema recovery backup is invalid",
      { projectId: journal.projectId },
    );
    const runtimePath = this.#runtimePath(journal.projectId, "production");
    copyFileSync(backupPath, runtimePath);
    this.#fsyncFile(runtimePath);
    this.#fsyncDirectory(dirname(runtimePath));
    this.repository.metadataDatabase.transaction(() => {
      this.repository.connection
        .prepare(
          `UPDATE project_schema_states SET
             production_applied_revision = ?, production_schema_checksum = ?,
             updated_at = ? WHERE project_id = ?`,
        )
        .run(
          journal.previousRevision,
          journal.previousChecksum,
          this.#now(),
          journal.projectId,
        );
    });
    this.#removeProductionJournal(journalPath);
  }

  #checkpoint(path: string): void {
    const database = new Database(path);
    try {
      database.pragma("wal_checkpoint(TRUNCATE)");
      assertApi(
        database.pragma("quick_check", { simple: true }) === "ok",
        503,
        "RUNTIME_DATABASE_INTEGRITY_FAILED",
        "Runtime database failed backup preflight",
      );
    } finally {
      database.close();
    }
  }

  #fsyncFile(path: string): void {
    const descriptor = openSync(path, "r");
    try {
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
  }

  #fsyncDirectory(path: string): void {
    const descriptor = openSync(path, "r");
    try {
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
  }

  #recoverApplyingPlans(): void {
    for (const plan of this.repository.applyingPlans()) {
      const backup = this.repository.connection
        .prepare(
          "SELECT relative_path, checksum FROM schema_backups WHERE plan_id = ? AND project_id = ? AND verified = 1",
        )
        .get(plan.id, plan.project_id) as
        | { readonly relative_path: string; readonly checksum: string }
        | undefined;
      assertApi(
        backup !== undefined,
        503,
        "SCHEMA_RECOVERY_BACKUP_MISSING",
        "Interrupted schema apply has no verified backup",
        { planId: plan.id },
      );
      const backupPath = join(this.storage.root, backup.relative_path);
      assertApi(
        existsSync(backupPath) &&
          sha256(readFileSync(backupPath)) === backup.checksum,
        503,
        "SCHEMA_RECOVERY_BACKUP_INVALID",
        "Interrupted schema backup is invalid",
        { planId: plan.id },
      );
      const runtimePath = this.#runtimePath(plan.project_id, "test");
      copyFileSync(backupPath, runtimePath);
      this.#fsyncFile(runtimePath);
      this.#fsyncDirectory(dirname(runtimePath));
      this.repository.metadataDatabase.transaction(() => {
        this.repository.connection
          .prepare(
            "UPDATE schema_migration_plans SET status = 'FAILED', error_json = ?, completed_at = ? WHERE id = ? AND status = 'APPLYING'",
          )
          .run(
            JSON.stringify({
              code: "SCHEMA_APPLY_INTERRUPTED",
              message: "Interrupted schema apply was rolled back",
            }),
            this.#now(),
            plan.id,
          );
      });
    }
  }

  #recoverProductionDeployments(): void {
    for (const project of this.projectRepository.listActive()) {
      const journalPath = this.#productionJournalPath(project.id);
      if (!existsSync(journalPath)) continue;
      const journal = this.#readProductionJournal(project.id, journalPath);
      const state = this.#state(project.id);
      const runtime = this.#runtimeState(project.id, "production");
      if (
        state.production_applied_revision === journal.desiredRevision &&
        state.production_schema_checksum === journal.desiredChecksum &&
        runtime.revision === journal.desiredRevision &&
        runtime.checksum === journal.desiredChecksum
      ) {
        this.#removeProductionJournal(journalPath);
        continue;
      }
      this.#restoreProductionDeployment(journal, journalPath);
    }
  }
}
