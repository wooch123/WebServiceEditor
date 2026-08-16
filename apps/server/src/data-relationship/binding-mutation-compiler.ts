import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join, relative, sep } from "node:path";

import {
  BINDING_MUTATION_OPERATIONS,
  BINDING_MUTATION_SCHEMA_VERSION,
  type BindingMutationOperation,
  type BindingScalar,
  type ConfigureBindingMutationRequestDto,
  type DataFieldDto,
  type DataSchemaExportDto,
  type ElementEntryDto,
  type RelationshipBindingDto,
  type RuntimeBindingMutationDto,
  type RuntimeBindingMutationFieldErrorDto,
  type RuntimeBindingMutationRequestDto,
  type StoredBindingMutationMappingDto,
  type StoredBindingMutationQueryDto,
} from "@webeditor/domain";
import Database from "better-sqlite3";

import { ApiError, assertApi } from "../errors.js";
import type { ProjectStorage } from "../projects/project-storage.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PHYSICAL_TABLE_PATTERN = /^t_[0-9a-f]{32}$/;
const PHYSICAL_FIELD_PATTERN = /^c_[0-9a-f]{32}$/;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9._:-]{8,200}$/;
const operations = new Set<string>(BINDING_MUTATION_OPERATIONS);

export interface CompiledBindingMutation {
  readonly query: StoredBindingMutationQueryDto;
  readonly mapping: StoredBindingMutationMappingDto;
  readonly table: DataSchemaExportDto["tables"][number];
  readonly primaryKey: DataFieldDto;
  readonly fields: readonly DataFieldDto[];
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const source = value as Record<string, unknown>;
  return `{${Object.keys(source)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(source[key])}`)
    .join(",")}}`;
}

function exactObject(
  value: unknown,
  keys: readonly string[],
  label: string,
): Record<string, unknown> {
  assertApi(
    typeof value === "object" && value !== null && !Array.isArray(value),
    400,
    "INVALID_BINDING_MUTATION",
    `${label} must be an object`,
  );
  const source = value as Record<string, unknown>;
  const unknown = Object.keys(source).filter((key) => !keys.includes(key));
  assertApi(
    unknown.length === 0,
    400,
    "UNKNOWN_BINDING_MUTATION_FIELD",
    `${label} contains unknown fields`,
    { fields: unknown },
  );
  return source;
}

function uuid(value: unknown, label: string): string {
  assertApi(
    typeof value === "string" && UUID_PATTERN.test(value),
    400,
    "INVALID_BINDING_MUTATION_ID",
    `${label} is invalid`,
  );
  return value;
}

function identifier(value: string, kind: "table" | "field"): string {
  const pattern =
    kind === "table" ? PHYSICAL_TABLE_PATTERN : PHYSICAL_FIELD_PATTERN;
  assertApi(
    pattern.test(value),
    500,
    "INVALID_PHYSICAL_IDENTIFIER",
    `Stored ${kind} identifier is invalid`,
  );
  return `"${value}"`;
}

function scalar(value: unknown): value is BindingScalar {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

function valueForField(
  field: DataFieldDto,
  value: BindingScalar,
  inputElementId: string,
): BindingScalar {
  const fail = (code: string, message: string): never => {
    const fieldErrors: readonly RuntimeBindingMutationFieldErrorDto[] = [
      { fieldId: field.id, inputElementId, code, message },
    ];
    throw new ApiError(422, "BINDING_MUTATION_VALIDATION_FAILED", message, {
      fieldErrors,
    });
  };
  if (value === null) {
    if (
      !field.nullable &&
      field.defaultValue === null &&
      !field.autoIncrement
    ) {
      return fail("REQUIRED", `${field.displayName} is required`);
    }
    return null;
  }
  if (field.type === "INTEGER") {
    if (typeof value !== "number" || !Number.isInteger(value))
      return fail("INTEGER", `${field.displayName} must be an integer`);
    return value;
  }
  if (field.type === "REAL") {
    if (typeof value !== "number" || !Number.isFinite(value))
      return fail("NUMBER", `${field.displayName} must be a number`);
    return value;
  }
  if (field.type === "BOOLEAN") {
    if (typeof value !== "boolean")
      return fail("BOOLEAN", `${field.displayName} must be true or false`);
    return value ? 1 : 0;
  }
  if (["TEXT", "DATE", "DATETIME", "JSON"].includes(field.type)) {
    if (typeof value !== "string")
      return fail("TEXT", `${field.displayName} must be text`);
    if (field.type === "JSON") {
      try {
        JSON.parse(value);
      } catch {
        return fail("JSON", `${field.displayName} must be valid JSON`);
      }
    }
    return value;
  }
  return fail("UNSUPPORTED", `${field.displayName} cannot be written`);
}

function sqliteCode(error: unknown): string {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : "";
}

export class BindingMutationCompiler {
  constructor(readonly storage: ProjectStorage) {}

  compileDefinition(
    projectId: string,
    operation: BindingMutationOperation,
    sourceElementId: string,
    targetTableId: string,
    value: ConfigureBindingMutationRequestDto | unknown,
    schema: DataSchemaExportDto,
    elements: readonly ElementEntryDto[],
  ): CompiledBindingMutation {
    const source = exactObject(value, ["fieldMappings"], "Mutation mapping");
    assertApi(
      Array.isArray(source.fieldMappings) &&
        source.fieldMappings.length >= 1 &&
        source.fieldMappings.length <= 64,
      400,
      "INVALID_BINDING_MUTATION_MAPPING",
      "Mutation mapping must contain between 1 and 64 Fields",
    );
    const sourceElement = elements.find(
      (entry) => entry.element.id === sourceElementId,
    );
    assertApi(
      sourceElement !== undefined,
      404,
      "BINDING_MUTATION_SOURCE_NOT_FOUND",
      "Mutation source Element was not found",
    );
    const table = schema.tables.find((entry) => entry.id === targetTableId);
    assertApi(
      table?.projectId === projectId,
      404,
      "BINDING_MUTATION_TABLE_NOT_FOUND",
      "Mutation target Table was not found",
    );
    const primaryKeys = table.fields.filter((field) => field.primaryKey);
    assertApi(
      primaryKeys.length === 1,
      409,
      "BINDING_MUTATION_PRIMARY_KEY_REQUIRED",
      "Mutation target Table must have exactly one primary key",
    );
    const fieldById = new Map(table.fields.map((field) => [field.id, field]));
    const elementById = new Map(
      elements.map((entry) => [entry.element.id, entry] as const),
    );
    const mappings = source.fieldMappings.map((candidate) => {
      const mapping = exactObject(
        candidate,
        ["fieldId", "inputElementId"],
        "Field mapping",
      );
      const fieldId = uuid(mapping.fieldId, "Field ID");
      const inputElementId = uuid(mapping.inputElementId, "Input Element ID");
      const field = fieldById.get(fieldId);
      const input = elementById.get(inputElementId);
      assertApi(
        field !== undefined && field.type !== "BLOB",
        400,
        "INVALID_BINDING_MUTATION_FIELD",
        "Mapped Field is outside the target Table or is not writable",
      );
      assertApi(
        input !== undefined &&
          input.element.pageId === sourceElement.element.pageId &&
          input.element.type === "number-input",
        400,
        "INVALID_BINDING_MUTATION_INPUT",
        "Mapped input must be a Number Input on the source Page",
      );
      assertApi(
        field.type === "INTEGER" || field.type === "REAL",
        400,
        "BINDING_MUTATION_INPUT_TYPE_MISMATCH",
        "Number Input can map only to INTEGER or REAL Fields",
      );
      return { fieldId, inputElementId };
    });
    assertApi(
      new Set(mappings.map(({ fieldId }) => fieldId)).size ===
        mappings.length &&
        new Set(mappings.map(({ inputElementId }) => inputElementId)).size ===
          mappings.length,
      400,
      "DUPLICATE_BINDING_MUTATION_MAPPING",
      "Mutation Field and input mappings must be unique",
    );
    const mappedFields = new Set(mappings.map(({ fieldId }) => fieldId));
    const primaryKey = primaryKeys[0];
    assertApi(
      primaryKey !== undefined,
      409,
      "BINDING_MUTATION_PRIMARY_KEY_REQUIRED",
      "Mutation target Table must have exactly one primary key",
    );
    if (operation === "CREATE") {
      const required = table.fields.filter(
        (field) =>
          !field.nullable &&
          field.defaultValue === null &&
          !field.autoIncrement,
      );
      assertApi(
        required.every((field) => mappedFields.has(field.id)),
        400,
        "BINDING_MUTATION_REQUIRED_FIELD_MISSING",
        "CREATE mapping is missing a required Field",
        {
          fieldIds: required
            .filter((field) => !mappedFields.has(field.id))
            .map((field) => field.id),
        },
      );
      assertApi(
        !mappings.some(
          ({ fieldId }) => fieldById.get(fieldId)?.autoIncrement === true,
        ),
        400,
        "BINDING_MUTATION_AUTOINCREMENT_MAPPED",
        "Auto-increment Fields cannot be mapped for CREATE",
      );
    } else {
      assertApi(
        mappedFields.has(primaryKey.id),
        400,
        "BINDING_MUTATION_PRIMARY_KEY_MISSING",
        `${operation} mapping requires the primary key`,
      );
      assertApi(
        operation !== "UPDATE" ||
          mappings.some(({ fieldId }) => fieldId !== primaryKey.id),
        400,
        "BINDING_MUTATION_UPDATE_FIELD_MISSING",
        "UPDATE mapping requires at least one non-key Field",
      );
      assertApi(
        operation !== "DELETE" || mappings.length === 1,
        400,
        "BINDING_MUTATION_DELETE_MAPPING_INVALID",
        "DELETE mapping accepts only the primary key",
      );
    }
    const ordered = [...mappings].sort(
      (left, right) =>
        (fieldById.get(left.fieldId)?.sortOrder ?? 0) -
        (fieldById.get(right.fieldId)?.sortOrder ?? 0),
    );
    const orderedFields = ordered.map(({ fieldId }) => fieldById.get(fieldId));
    assertApi(
      orderedFields.every((field) => field !== undefined),
      500,
      "STORED_BINDING_MUTATION_INVALID",
      "Mutation mapping references a missing Field",
    );
    return {
      query: {
        schemaVersion: BINDING_MUTATION_SCHEMA_VERSION,
        operation,
        tableId: table.id,
        primaryKeyFieldId: primaryKey.id,
      },
      mapping: { fields: ordered },
      table,
      primaryKey,
      fields: orderedFields as readonly DataFieldDto[],
    };
  }

  compileStored(
    projectId: string,
    binding: RelationshipBindingDto,
    schema: DataSchemaExportDto,
    elements: readonly ElementEntryDto[],
  ): CompiledBindingMutation {
    const query = exactObject(
      binding.query,
      ["schemaVersion", "operation", "tableId", "primaryKeyFieldId"],
      "Stored mutation query",
    );
    const mapping = exactObject(
      binding.mapping,
      ["fields"],
      "Stored mutation mapping",
    );
    assertApi(
      query.schemaVersion === BINDING_MUTATION_SCHEMA_VERSION &&
        typeof query.operation === "string" &&
        operations.has(query.operation) &&
        query.operation === binding.bindingType,
      500,
      "STORED_BINDING_MUTATION_INVALID",
      "Stored mutation operation is invalid",
    );
    const tableId = uuid(query.tableId, "Stored Table ID");
    const compiled = this.compileDefinition(
      projectId,
      query.operation as BindingMutationOperation,
      binding.source.objectId,
      tableId,
      { fieldMappings: mapping.fields },
      schema,
      elements,
    );
    assertApi(
      compiled.primaryKey.id === query.primaryKeyFieldId,
      500,
      "STORED_BINDING_MUTATION_INVALID",
      "Stored mutation primary key is invalid",
    );
    return compiled;
  }

  execute(input: {
    readonly binding: RelationshipBindingDto;
    readonly snapshotId: string;
    readonly definitionChecksum: string;
    readonly environment: "test" | "production";
    readonly schema: DataSchemaExportDto;
    readonly elements: readonly ElementEntryDto[];
    readonly refreshBindingIds: readonly string[];
    readonly request: RuntimeBindingMutationRequestDto;
  }): RuntimeBindingMutationDto {
    const compiled = this.compileStored(
      input.binding.projectId,
      input.binding,
      input.schema,
      input.elements,
    );
    const request = exactObject(
      input.request,
      ["values", "idempotencyKey"],
      "Mutation request",
    );
    assertApi(
      typeof request.idempotencyKey === "string" &&
        IDEMPOTENCY_PATTERN.test(request.idempotencyKey),
      400,
      "INVALID_IDEMPOTENCY_KEY",
      "Idempotency key is invalid",
    );
    const values = exactObject(
      request.values,
      compiled.mapping.fields.map(({ inputElementId }) => inputElementId),
      "Form values",
    );
    const mappedValues = compiled.mapping.fields.map((mapping, index) => {
      const value = values[mapping.inputElementId];
      assertApi(
        scalar(value),
        422,
        "BINDING_MUTATION_VALIDATION_FAILED",
        "Form value is invalid",
        {
          fieldErrors: [
            {
              fieldId: mapping.fieldId,
              inputElementId: mapping.inputElementId,
              code: "SCALAR",
              message: "Value must be a scalar",
            },
          ],
        },
      );
      const field = compiled.fields[index];
      assertApi(
        field !== undefined,
        500,
        "STORED_BINDING_MUTATION_INVALID",
        "Mutation mapping references a missing Field",
      );
      return valueForField(field, value, mapping.inputElementId);
    });
    const root = this.storage.activePath(input.binding.projectId);
    const databasePath = join(root, `${input.environment}.sqlite`);
    const fromRoot = relative(root, databasePath);
    assertApi(
      fromRoot !== ".." &&
        !fromRoot.startsWith(`..${sep}`) &&
        existsSync(databasePath),
      503,
      "RUNTIME_DATABASE_MISSING",
      "Runtime database is missing",
    );
    this.storage.assertDatabaseIntegrity(
      databasePath,
      input.binding.projectId,
      input.environment,
    );
    const database = new Database(databasePath, { fileMustExist: true });
    try {
      database.pragma("foreign_keys = ON");
      database.pragma("busy_timeout = 5000");
      const appliedRevision =
        input.environment === "test"
          ? input.schema.testAppliedRevision
          : input.schema.productionAppliedRevision;
      const state = database
        .prepare(
          "SELECT schema_revision AS revision FROM webeditor_runtime_schema_state WHERE project_id = ? AND environment = ?",
        )
        .get(input.binding.projectId, input.environment) as
        { readonly revision: number } | undefined;
      assertApi(
        state?.revision === appliedRevision &&
          appliedRevision === input.schema.schemaRevision,
        409,
        "RUNTIME_SCHEMA_NOT_APPLIED",
        "Runtime schema does not match this definition snapshot",
      );
      database.exec(`
        CREATE TABLE IF NOT EXISTS webeditor_runtime_mutation_commands (
          command_id TEXT PRIMARY KEY NOT NULL,
          binding_id TEXT NOT NULL,
          idempotency_key TEXT NOT NULL,
          request_hash TEXT NOT NULL CHECK(length(request_hash) = 64),
          response_json TEXT NOT NULL CHECK(json_valid(response_json)),
          created_at TEXT NOT NULL,
          UNIQUE(binding_id, idempotency_key)
        );
      `);
      const requestHash = createHash("sha256")
        .update(
          stableJson({
            bindingId: input.binding.id,
            operation: compiled.query.operation,
            values,
            snapshotId: input.snapshotId,
          }),
        )
        .digest("hex");
      const run = database.transaction((): RuntimeBindingMutationDto => {
        const replay = database
          .prepare(
            "SELECT request_hash, response_json FROM webeditor_runtime_mutation_commands WHERE binding_id = ? AND idempotency_key = ?",
          )
          .get(input.binding.id, request.idempotencyKey) as
          | { readonly request_hash: string; readonly response_json: string }
          | undefined;
        if (replay) {
          assertApi(
            replay.request_hash === requestHash,
            409,
            "IDEMPOTENCY_PAYLOAD_CONFLICT",
            "Idempotency key was already used with a different payload",
          );
          return JSON.parse(replay.response_json) as RuntimeBindingMutationDto;
        }
        const tableName = identifier(compiled.table.physicalName, "table");
        const mapped = compiled.mapping.fields.map((mapping, index) => {
          const field = compiled.fields[index];
          assertApi(
            field !== undefined,
            500,
            "STORED_BINDING_MUTATION_INVALID",
            "Mutation mapping references a missing Field",
          );
          return { mapping, field, value: mappedValues[index] ?? null };
        });
        const primary = mapped.find(
          ({ field }) => field.id === compiled.primaryKey.id,
        );
        let affectedRows: number;
        let insertedPrimaryKey: BindingScalar = null;
        if (compiled.query.operation === "CREATE") {
          const columns = mapped.map(({ field }) =>
            identifier(field.physicalName, "field"),
          );
          const result = database
            .prepare(
              `INSERT INTO ${tableName} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
            )
            .run(...mapped.map(({ value }) => value));
          affectedRows = result.changes;
          insertedPrimaryKey = compiled.primaryKey.autoIncrement
            ? Number(result.lastInsertRowid)
            : (mapped.find(({ field }) => field.id === compiled.primaryKey.id)
                ?.value ?? null);
        } else {
          assertApi(
            primary !== undefined,
            422,
            "BINDING_MUTATION_VALIDATION_FAILED",
            "Primary key value is required",
          );
          const primaryName = identifier(
            compiled.primaryKey.physicalName,
            "field",
          );
          if (compiled.query.operation === "UPDATE") {
            const updates = mapped.filter(
              ({ field }) => field.id !== compiled.primaryKey.id,
            );
            const result = database
              .prepare(
                `UPDATE ${tableName} SET ${updates
                  .map(
                    ({ field }) =>
                      `${identifier(field.physicalName, "field")} = ?`,
                  )
                  .join(", ")} WHERE ${primaryName} = ?`,
              )
              .run(...updates.map(({ value }) => value), primary.value);
            affectedRows = result.changes;
          } else {
            affectedRows = database
              .prepare(`DELETE FROM ${tableName} WHERE ${primaryName} = ?`)
              .run(primary.value).changes;
          }
          assertApi(
            affectedRows === 1,
            409,
            "BINDING_MUTATION_ROW_CONFLICT",
            "The target row no longer matches this request",
          );
        }
        const commandId = randomUUID();
        const response: RuntimeBindingMutationDto = {
          bindingId: input.binding.id,
          projectId: input.binding.projectId,
          operation: compiled.query.operation,
          environment: input.environment,
          affectedRows,
          insertedPrimaryKey,
          refreshBindingIds: input.refreshBindingIds,
          snapshotId: input.snapshotId,
          definitionChecksum: input.definitionChecksum,
          commandId,
        };
        database
          .prepare(
            `INSERT INTO webeditor_runtime_mutation_commands (
               command_id, binding_id, idempotency_key, request_hash,
               response_json, created_at
             ) VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(
            commandId,
            input.binding.id,
            request.idempotencyKey,
            requestHash,
            JSON.stringify(response),
            new Date().toISOString(),
          );
        return response;
      });
      return run.immediate();
    } catch (error) {
      if (error instanceof ApiError) throw error;
      const code = sqliteCode(error);
      if (code.startsWith("SQLITE_CONSTRAINT")) {
        throw new ApiError(
          409,
          "BINDING_MUTATION_CONSTRAINT",
          "The database rejected this change",
          {
            fieldErrors: compiled.mapping.fields.map((mapping, index) => ({
              fieldId: mapping.fieldId,
              inputElementId: mapping.inputElementId,
              code: "CONSTRAINT",
              message: `${compiled.fields[index]?.displayName ?? "Field"} conflicts with a database constraint`,
            })),
          },
        );
      }
      if (code === "SQLITE_BUSY" || code === "SQLITE_LOCKED") {
        throw new ApiError(
          409,
          "BINDING_MUTATION_WRITE_CONFLICT",
          "The database is busy; retry this change",
        );
      }
      throw error;
    } finally {
      database.close();
    }
  }
}
