import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type {
  DataFieldDto,
  GenerateSampleDataRequest,
  ResetSampleDataRequest,
  SampleDataMutationDto,
} from "@webeditor/domain";
import Database from "better-sqlite3";

import { assertApi } from "../errors.js";
import type { MetadataDatabase } from "../metadata/database.js";
import { ProjectRepository } from "../projects/project-repository.js";
import type { ProjectStorage } from "../projects/project-storage.js";
import { SchemaRepository } from "../data-schema/schema-repository.js";

const PHYSICAL_TABLE_PATTERN = /^t_[0-9a-f]{32}$/;
const PHYSICAL_FIELD_PATTERN = /^c_[0-9a-f]{32}$/;

interface SampleTableCount {
  readonly tableId: string;
  readonly count: number;
}

interface PendingSampleCommand {
  readonly state: "PENDING";
  readonly before: readonly SampleTableCount[];
  readonly expected: readonly SampleTableCount[];
  readonly responseRowCount: number;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

function hash(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function identifier(value: string, pattern: RegExp): string {
  assertApi(
    pattern.test(value),
    500,
    "INVALID_PHYSICAL_IDENTIFIER",
    "Stored runtime identifier is invalid",
  );
  return `"${value}"`;
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

function sampleValue(field: DataFieldDto, row: number): unknown {
  if (field.type === "INTEGER") return row;
  if (field.type === "REAL") return Number((row * 1.25).toFixed(4));
  if (field.type === "BOOLEAN") return row % 2;
  if (field.type === "DATE")
    return new Date(Date.UTC(2025, 0, row)).toISOString().slice(0, 10);
  if (field.type === "DATETIME")
    return new Date(Date.UTC(2025, 0, 1, 0, row)).toISOString();
  if (field.type === "JSON") return JSON.stringify({ sample: row });
  if (field.type === "BLOB") return Buffer.from(`sample-${row}`, "utf8");
  return `${field.displayName} ${row}`;
}

export class SampleDataService {
  readonly projectRepository: ProjectRepository;
  readonly schemaRepository: SchemaRepository;

  constructor(
    readonly metadataDatabase: MetadataDatabase,
    readonly storage: ProjectStorage,
    readonly clock: () => Date = () => new Date(),
  ) {
    this.projectRepository = new ProjectRepository(metadataDatabase);
    this.schemaRepository = new SchemaRepository(metadataDatabase);
  }

  generate(
    projectId: string,
    request: GenerateSampleDataRequest,
  ): SampleDataMutationDto {
    assertApi(
      Number.isSafeInteger(request.rowCount) &&
        request.rowCount >= 1 &&
        request.rowCount <= 1_000,
      400,
      "INVALID_SAMPLE_ROW_COUNT",
      "Sample row count must be between 1 and 1000",
    );
    assertApi(
      typeof request.reset === "boolean",
      400,
      "INVALID_SAMPLE_RESET",
      "Sample reset option is invalid",
    );
    return this.#mutate(projectId, "GENERATE", request, (database, tables) => {
      if (request.reset) this.#clear(database, tables);
      let inserted = 0;
      database.pragma("defer_foreign_keys = ON");
      for (const table of tables) {
        const fields = table.fields.filter(
          ({ autoIncrement }) => !autoIncrement,
        );
        const names = fields.map(({ physicalName }) =>
          identifier(physicalName, PHYSICAL_FIELD_PATTERN),
        );
        const statement = database.prepare(
          `INSERT INTO ${identifier(table.physicalName, PHYSICAL_TABLE_PATTERN)} (${names.join(", ")}) VALUES (${fields.map(() => "?").join(", ")})`,
        );
        const primary = table.fields.find(
          ({ primaryKey, type }) => primaryKey && type === "INTEGER",
        );
        const offset =
          !request.reset && primary
            ? ((
                database
                  .prepare(
                    `SELECT coalesce(max(${identifier(primary.physicalName, PHYSICAL_FIELD_PATTERN)}), 0) AS value FROM ${identifier(table.physicalName, PHYSICAL_TABLE_PATTERN)}`,
                  )
                  .get() as { value: number }
              ).value ?? 0)
            : 0;
        for (let index = 1; index <= request.rowCount; index += 1) {
          statement.run(
            ...fields.map((field) => sampleValue(field, offset + index)),
          );
          inserted += 1;
        }
      }
      return inserted;
    });
  }

  reset(
    projectId: string,
    request: ResetSampleDataRequest,
  ): SampleDataMutationDto {
    return this.#mutate(projectId, "RESET", request, (database, tables) => {
      const before = tables.reduce((total, table) => {
        const row = database
          .prepare(
            `SELECT count(*) AS count FROM ${identifier(table.physicalName, PHYSICAL_TABLE_PATTERN)}`,
          )
          .get() as { count: number };
        return total + row.count;
      }, 0);
      this.#clear(database, tables);
      return before;
    });
  }

  #mutate(
    projectId: string,
    commandType: "GENERATE" | "RESET",
    request: GenerateSampleDataRequest | ResetSampleDataRequest,
    operation: (
      database: Database.Database,
      tables: ReturnType<SchemaRepository["exportDefinition"]>["tables"],
    ) => number,
  ): SampleDataMutationDto {
    const key = idempotencyKey(request.idempotencyKey);
    const requestHash = hash({ commandType, projectId, request });
    const replay = this.metadataDatabase.connection
      .prepare(
        "SELECT request_hash, response_status, response_json FROM sample_data_commands WHERE project_id = ? AND idempotency_key = ?",
      )
      .get(projectId, key) as
      | {
          readonly request_hash: string;
          readonly response_status: number;
          readonly response_json: string;
        }
      | undefined;
    const recovering = replay !== undefined;
    if (replay !== undefined) {
      assertApi(
        replay.request_hash === requestHash,
        409,
        "IDEMPOTENCY_PAYLOAD_CONFLICT",
        "Idempotency key was used with another sample request",
      );
      if (replay.response_status === 200) {
        return JSON.parse(replay.response_json) as SampleDataMutationDto;
      }
    }
    const project = this.projectRepository.get(projectId);
    assertApi(
      project !== undefined && project.lifecycle_status === "ACTIVE",
      404,
      "PROJECT_NOT_FOUND",
      "Project was not found",
    );
    const state = this.schemaRepository.state(projectId);
    assertApi(
      state !== undefined &&
        state.test_applied_revision === state.draft_revision &&
        state.test_applied_revision > 0,
      409,
      "TEST_SCHEMA_NOT_APPLIED",
      "Apply the current schema to Test before generating sample data",
    );
    const schema = this.schemaRepository.exportDefinition(projectId);
    assertApi(
      schema.tables.length > 0,
      409,
      "SAMPLE_TABLE_REQUIRED",
      "Add a Table before generating sample data",
    );
    const databasePath = join(
      this.storage.activePath(projectId),
      "test.sqlite",
    );
    const database = new Database(databasePath, { fileMustExist: true });
    let rowCount: number;
    try {
      database.pragma("foreign_keys = ON");
      database.pragma("trusted_schema = OFF");
      const before = this.#counts(database, schema.tables);
      let pending: PendingSampleCommand;
      if (replay === undefined) {
        const otherPending = this.metadataDatabase.connection
          .prepare(
            `SELECT idempotency_key FROM sample_data_commands
             WHERE project_id = ? AND response_status = 202 LIMIT 1`,
          )
          .get(projectId) as { readonly idempotency_key: string } | undefined;
        assertApi(
          otherPending === undefined,
          409,
          "SAMPLE_DATA_COMMAND_PENDING",
          "Complete the pending sample data command first",
          { idempotencyKey: otherPending?.idempotency_key },
        );
        const generatedRows =
          commandType === "GENERATE"
            ? (request as GenerateSampleDataRequest).rowCount
            : 0;
        const reset =
          commandType === "RESET" ||
          (request as GenerateSampleDataRequest).reset;
        pending = {
          state: "PENDING",
          before,
          expected: before.map((entry) => ({
            tableId: entry.tableId,
            count:
              commandType === "RESET"
                ? 0
                : reset
                  ? generatedRows
                  : entry.count + generatedRows,
          })),
          responseRowCount:
            commandType === "GENERATE"
              ? generatedRows * schema.tables.length
              : before.reduce((total, entry) => total + entry.count, 0),
        };
        this.metadataDatabase.connection
          .prepare(
            `INSERT INTO sample_data_commands (
               id, project_id, command_type, idempotency_key, request_hash,
               response_status, response_json, created_at
             ) VALUES (?, ?, ?, ?, ?, 202, ?, ?)`,
          )
          .run(
            randomUUID(),
            projectId,
            commandType,
            key,
            requestHash,
            JSON.stringify(pending),
            this.clock().toISOString(),
          );
      } else {
        const value = JSON.parse(
          replay.response_json,
        ) as Partial<PendingSampleCommand>;
        assertApi(
          value.state === "PENDING" &&
            Array.isArray(value.before) &&
            Array.isArray(value.expected) &&
            Number.isSafeInteger(value.responseRowCount),
          503,
          "SAMPLE_DATA_JOURNAL_INVALID",
          "Pending sample data command is invalid",
        );
        pending = value as PendingSampleCommand;
      }
      const current = this.#counts(database, schema.tables);
      const matches = (
        left: readonly SampleTableCount[],
        right: readonly SampleTableCount[],
      ) =>
        left.length === right.length &&
        left.every(
          (entry, index) =>
            entry.tableId === right[index]?.tableId &&
            entry.count === right[index]?.count,
        );
      if (recovering && matches(current, pending.expected)) {
        rowCount = pending.responseRowCount;
      } else {
        assertApi(
          matches(current, pending.before),
          503,
          "SAMPLE_DATA_RECOVERY_REQUIRED",
          "Sample data changed while a command was pending",
        );
        rowCount = database
          .transaction(() => operation(database, schema.tables))
          .immediate();
        assertApi(
          matches(this.#counts(database, schema.tables), pending.expected),
          500,
          "SAMPLE_DATA_RESULT_MISMATCH",
          "Sample data row counts do not match the command plan",
        );
      }
      const integrity = database.pragma("quick_check", { simple: true });
      const foreignKeys = database.pragma(
        "foreign_key_check",
      ) as readonly unknown[];
      assertApi(
        integrity === "ok" && foreignKeys.length === 0,
        500,
        "SAMPLE_DATA_INTEGRITY_FAILED",
        "Sample data failed integrity validation",
      );
      database.pragma("wal_checkpoint(TRUNCATE)");
    } finally {
      database.close();
    }
    const response: SampleDataMutationDto = {
      projectId,
      tableCount: schema.tables.length,
      rowCount,
      databaseChecksum: createHash("sha256")
        .update(readFileSync(databasePath))
        .digest("hex"),
    };
    const now = this.clock().toISOString();
    this.metadataDatabase.transaction(() => {
      this.metadataDatabase.connection
        .prepare(
          `UPDATE sample_data_commands
           SET response_status = 200, response_json = ?
           WHERE project_id = ? AND idempotency_key = ?
             AND request_hash = ? AND response_status = 202`,
        )
        .run(JSON.stringify(response), projectId, key, requestHash);
      this.metadataDatabase.connection
        .prepare(
          `INSERT INTO audit_logs (
             id, project_id, action, object_type, object_id, before_json,
             after_json, correlation_id, created_at
           ) VALUES (?, ?, ?, 'SAMPLE_DATA', ?, NULL, ?, ?, ?)`,
        )
        .run(
          randomUUID(),
          projectId,
          commandType === "GENERATE"
            ? "SAMPLE_DATA_GENERATED"
            : "SAMPLE_DATA_RESET",
          projectId,
          JSON.stringify(response),
          key,
          now,
        );
    });
    return response;
  }

  #counts(
    database: Database.Database,
    tables: ReturnType<SchemaRepository["exportDefinition"]>["tables"],
  ): readonly SampleTableCount[] {
    return tables.map((table) => ({
      tableId: table.id,
      count: (
        database
          .prepare(
            `SELECT count(*) AS count FROM ${identifier(table.physicalName, PHYSICAL_TABLE_PATTERN)}`,
          )
          .get() as { readonly count: number }
      ).count,
    }));
  }

  #clear(
    database: Database.Database,
    tables: ReturnType<SchemaRepository["exportDefinition"]>["tables"],
  ): void {
    database.pragma("defer_foreign_keys = ON");
    for (const table of [...tables].reverse()) {
      database.exec(
        `DELETE FROM ${identifier(table.physicalName, PHYSICAL_TABLE_PATTERN)}`,
      );
    }
  }
}
