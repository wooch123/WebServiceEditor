import { createHash, randomUUID } from "node:crypto";

import {
  PROJECT_VARIABLE_SCHEMA_VERSION,
  PROJECT_VARIABLE_SCOPES,
  PROJECT_VARIABLE_TRANSPORTS,
  PROJECT_VARIABLE_TYPES,
  type BindingScalar,
  type CreateProjectVariableRequestDto,
  type DeleteProjectVariableDto,
  type DeleteProjectVariableRequestDto,
  type ProjectVariableDto,
  type ProjectVariableListDto,
  type ProjectVariableMutationDto,
  type ProjectVariableScope,
  type ProjectVariableTransport,
  type ProjectVariableType,
  type UpdateProjectVariableRequestDto,
} from "@webeditor/domain";
import type Database from "better-sqlite3";

import { assertApi } from "../errors.js";
import type { MetadataDatabase } from "../metadata/database.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/u;

export interface ProjectVariableRow {
  readonly id: string;
  readonly project_id: string;
  readonly variable_key: string;
  readonly display_name: string;
  readonly value_type: ProjectVariableType;
  readonly variable_scope: ProjectVariableScope;
  readonly transport: ProjectVariableTransport;
  readonly sensitive: 0 | 1;
  readonly default_value_json: string;
  readonly revision: number;
  readonly created_at: string;
  readonly updated_at: string;
  readonly deleted_at: string | null;
}

interface VariableCommandRow {
  readonly request_hash: string;
  readonly response_status: number;
  readonly response_json: string;
}

const variableColumns = `
  id, project_id, variable_key, display_name, value_type, variable_scope,
  transport, sensitive, default_value_json, revision, created_at, updated_at,
  deleted_at
`;

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const source = value as Record<string, unknown>;
  return `{${Object.keys(source)
    .sort()
    .filter((key) => source[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${stableJson(source[key])}`)
    .join(",")}}`;
}

function requestHash(operation: string, targetId: string, value: unknown) {
  return createHash("sha256")
    .update(stableJson({ operation, targetId, value }))
    .digest("hex");
}

function uuid(value: unknown, code: string, label: string): string {
  assertApi(
    typeof value === "string" && UUID_PATTERN.test(value),
    400,
    code,
    `${label} is invalid`,
  );
  return value;
}

function idempotencyKey(value: unknown): string {
  assertApi(
    typeof value === "string" && value.length >= 1 && value.length <= 200,
    400,
    "INVALID_IDEMPOTENCY_KEY",
    "Idempotency key is invalid",
  );
  return value;
}

function revision(value: unknown, label: string): number {
  assertApi(
    Number.isSafeInteger(value) && (value as number) >= 0,
    400,
    "INVALID_REVISION",
    `${label} is invalid`,
  );
  return value as number;
}

function scalar(value: unknown, type: ProjectVariableType): BindingScalar {
  const valid =
    value === null ||
    (type === "number" &&
      typeof value === "number" &&
      Number.isFinite(value)) ||
    (type === "boolean" && typeof value === "boolean") ||
    (type === "string" && typeof value === "string" && value.length <= 2_000) ||
    (type === "date" &&
      typeof value === "string" &&
      /^\d{4}-\d{2}-\d{2}$/u.test(value)) ||
    (type === "datetime" &&
      typeof value === "string" &&
      Number.isFinite(Date.parse(value)));
  assertApi(
    valid,
    400,
    "INVALID_VARIABLE_DEFAULT",
    "Variable default is invalid",
  );
  return value as BindingScalar;
}

function enumValue<T extends string>(
  value: unknown,
  values: readonly T[],
  code: string,
  label: string,
): T {
  assertApi(
    typeof value === "string" && values.includes(value as T),
    400,
    code,
    `${label} is invalid`,
  );
  return value as T;
}

export class ProjectVariableRepository {
  constructor(readonly metadataDatabase: MetadataDatabase) {}

  get connection(): Database.Database {
    return this.metadataDatabase.connection;
  }

  listActive(projectId: string): ProjectVariableDto[] {
    return (
      this.connection
        .prepare(
          `SELECT ${variableColumns} FROM project_variables
           WHERE project_id = ? AND deleted_at IS NULL
           ORDER BY created_at, id`,
        )
        .all(projectId) as ProjectVariableRow[]
    ).map((row) => this.toDto(row));
  }

  row(id: string): ProjectVariableRow | undefined {
    return this.connection
      .prepare(`SELECT ${variableColumns} FROM project_variables WHERE id = ?`)
      .get(id) as ProjectVariableRow | undefined;
  }

  toDto(row: ProjectVariableRow): ProjectVariableDto {
    return {
      id: row.id,
      projectId: row.project_id,
      key: row.variable_key,
      name: row.display_name,
      valueType: row.value_type,
      scope: row.variable_scope,
      transport: row.transport,
      sensitive: row.sensitive === 1,
      defaultValue: JSON.parse(row.default_value_json) as BindingScalar,
      revision: row.revision,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

export class ProjectVariableService {
  readonly repository: ProjectVariableRepository;

  constructor(
    readonly metadataDatabase: MetadataDatabase,
    readonly clock: () => Date = () => new Date(),
  ) {
    this.repository = new ProjectVariableRepository(metadataDatabase);
  }

  list(projectIdValue: unknown): ProjectVariableListDto {
    const projectId = uuid(projectIdValue, "INVALID_PROJECT_ID", "Project ID");
    const project = this.#project(projectId);
    return {
      schemaVersion: PROJECT_VARIABLE_SCHEMA_VERSION,
      projectId,
      projectRevision: project.revision,
      variables: this.repository.listActive(projectId),
    };
  }

  create(
    projectIdValue: unknown,
    request: CreateProjectVariableRequestDto,
  ): ProjectVariableMutationDto {
    const projectId = uuid(projectIdValue, "INVALID_PROJECT_ID", "Project ID");
    const key = idempotencyKey(request.idempotencyKey);
    const hash = requestHash("CREATE_VARIABLE", projectId, request);
    const replay = this.#replay<ProjectVariableMutationDto>(
      projectId,
      key,
      hash,
    );
    if (replay) return replay;
    const input = this.#validateCreate(request);
    const now = this.clock().toISOString();
    const id = randomUUID();
    const commandId = randomUUID();
    return this.metadataDatabase.transaction(() => {
      const project = this.#project(projectId);
      assertApi(
        project.revision === request.expectedProjectRevision,
        409,
        "PROJECT_REVISION_CONFLICT",
        "Project revision changed",
        { latestRevision: project.revision },
      );
      this.#assertKeyAvailable(projectId, input.key);
      this.repository.connection
        .prepare(
          `INSERT INTO project_variables (
             id, project_id, variable_key, display_name, value_type,
             variable_scope, transport, sensitive, default_value_json,
             revision, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        )
        .run(
          id,
          projectId,
          input.key,
          input.name,
          input.valueType,
          input.scope,
          input.transport,
          input.sensitive ? 1 : 0,
          JSON.stringify(input.defaultValue),
          now,
          now,
        );
      const projectRevision = this.#incrementProject(
        projectId,
        project.revision,
        now,
      );
      const variable = this.repository.toDto(
        this.repository.row(id) as ProjectVariableRow,
      );
      const response = { variable, projectRevision, commandId };
      this.#record(projectId, id, "CREATE_VARIABLE", key, hash, response, now);
      this.#audit(
        projectId,
        id,
        "PROJECT_VARIABLE_CREATED",
        null,
        variable,
        commandId,
        now,
      );
      return response;
    });
  }

  update(
    variableIdValue: unknown,
    request: UpdateProjectVariableRequestDto,
  ): ProjectVariableMutationDto {
    const variableId = uuid(
      variableIdValue,
      "INVALID_VARIABLE_ID",
      "Variable ID",
    );
    const current = this.#variableRow(variableId);
    this.#project(current.project_id);
    const key = idempotencyKey(request.idempotencyKey);
    const hash = requestHash("UPDATE_VARIABLE", variableId, request);
    const replay = this.#replay<ProjectVariableMutationDto>(
      current.project_id,
      key,
      hash,
    );
    if (replay) return replay;
    assertApi(
      current.deleted_at === null,
      404,
      "VARIABLE_NOT_FOUND",
      "Variable was not found",
    );
    const existing = this.repository.toDto(current);
    const input = this.#validateCreate({
      ...existing,
      ...request,
      expectedProjectRevision: request.expectedProjectRevision,
      idempotencyKey: request.idempotencyKey,
      valueType: existing.valueType,
    });
    const now = this.clock().toISOString();
    const commandId = randomUUID();
    return this.metadataDatabase.transaction(() => {
      const row = this.#variable(variableId);
      const project = this.#project(row.project_id);
      assertApi(
        row.revision === request.expectedRevision,
        409,
        "VARIABLE_REVISION_CONFLICT",
        "Variable revision changed",
        { latestRevision: row.revision },
      );
      assertApi(
        project.revision === request.expectedProjectRevision,
        409,
        "PROJECT_REVISION_CONFLICT",
        "Project revision changed",
        { latestRevision: project.revision },
      );
      this.#assertKeyAvailable(row.project_id, input.key, variableId);
      this.repository.connection
        .prepare(
          `UPDATE project_variables SET variable_key = ?, display_name = ?,
             variable_scope = ?, transport = ?, sensitive = ?,
             default_value_json = ?, revision = revision + 1, updated_at = ?
           WHERE id = ? AND revision = ? AND deleted_at IS NULL`,
        )
        .run(
          input.key,
          input.name,
          input.scope,
          input.transport,
          input.sensitive ? 1 : 0,
          JSON.stringify(input.defaultValue),
          now,
          variableId,
          row.revision,
        );
      const projectRevision = this.#incrementProject(
        row.project_id,
        project.revision,
        now,
      );
      const variable = this.repository.toDto(
        this.repository.row(variableId) as ProjectVariableRow,
      );
      const response = { variable, projectRevision, commandId };
      this.#record(
        row.project_id,
        variableId,
        "UPDATE_VARIABLE",
        key,
        hash,
        response,
        now,
      );
      this.#audit(
        row.project_id,
        variableId,
        "PROJECT_VARIABLE_UPDATED",
        existing,
        variable,
        commandId,
        now,
      );
      return response;
    });
  }

  delete(
    variableIdValue: unknown,
    request: DeleteProjectVariableRequestDto,
  ): DeleteProjectVariableDto {
    const variableId = uuid(
      variableIdValue,
      "INVALID_VARIABLE_ID",
      "Variable ID",
    );
    const current = this.#variableRow(variableId);
    this.#project(current.project_id);
    const key = idempotencyKey(request.idempotencyKey);
    const hash = requestHash("DELETE_VARIABLE", variableId, request);
    const replay = this.#replay<DeleteProjectVariableDto>(
      current.project_id,
      key,
      hash,
    );
    if (replay) return replay;
    assertApi(
      current.deleted_at === null,
      404,
      "VARIABLE_NOT_FOUND",
      "Variable was not found",
    );
    const now = this.clock().toISOString();
    const commandId = randomUUID();
    return this.metadataDatabase.transaction(() => {
      const row = this.#variable(variableId);
      const project = this.#project(row.project_id);
      assertApi(
        row.revision ===
          revision(request.expectedRevision, "Variable revision"),
        409,
        "VARIABLE_REVISION_CONFLICT",
        "Variable revision changed",
      );
      assertApi(
        project.revision ===
          revision(request.expectedProjectRevision, "Project revision"),
        409,
        "PROJECT_REVISION_CONFLICT",
        "Project revision changed",
      );
      const inUse = this.repository.connection
        .prepare(
          `SELECT id FROM bindings
           WHERE project_id = ? AND deleted_at IS NULL
             AND json_extract(query_json, '$.variableId') = ? LIMIT 1`,
        )
        .get(row.project_id, variableId) as { readonly id: string } | undefined;
      assertApi(
        inUse === undefined,
        409,
        "VARIABLE_IN_USE",
        "Remove dependent Filter and Navigation Bindings first",
        { bindingId: inUse?.id },
      );
      this.repository.connection
        .prepare(
          `UPDATE project_variables SET deleted_at = ?, updated_at = ?,
             revision = revision + 1 WHERE id = ? AND deleted_at IS NULL`,
        )
        .run(now, now, variableId);
      const projectRevision = this.#incrementProject(
        row.project_id,
        project.revision,
        now,
      );
      const response = {
        deletedVariableId: variableId,
        projectRevision,
        commandId,
      };
      this.#record(
        row.project_id,
        variableId,
        "DELETE_VARIABLE",
        key,
        hash,
        response,
        now,
      );
      this.#audit(
        row.project_id,
        variableId,
        "PROJECT_VARIABLE_DELETED",
        this.repository.toDto(row),
        null,
        commandId,
        now,
      );
      return response;
    });
  }

  #validateCreate(request: CreateProjectVariableRequestDto) {
    assertApi(
      typeof request.key === "string" && KEY_PATTERN.test(request.key),
      400,
      "INVALID_VARIABLE_KEY",
      "Variable key must use lower-case letters, digits, or underscores",
    );
    assertApi(
      typeof request.name === "string" &&
        request.name.trim().length >= 1 &&
        request.name.trim().length <= 120,
      400,
      "INVALID_VARIABLE_NAME",
      "Variable name is invalid",
    );
    const valueType = enumValue(
      request.valueType,
      PROJECT_VARIABLE_TYPES,
      "INVALID_VARIABLE_TYPE",
      "Variable type",
    );
    const scope = enumValue(
      request.scope,
      PROJECT_VARIABLE_SCOPES,
      "INVALID_VARIABLE_SCOPE",
      "Variable scope",
    );
    const transport = enumValue(
      request.transport,
      PROJECT_VARIABLE_TRANSPORTS,
      "INVALID_VARIABLE_TRANSPORT",
      "Variable transport",
    );
    assertApi(
      typeof request.sensitive === "boolean",
      400,
      "INVALID_VARIABLE_SENSITIVITY",
      "Variable sensitivity is invalid",
    );
    assertApi(
      !request.sensitive || transport === "SESSION_STATE",
      400,
      "SENSITIVE_VARIABLE_URL_FORBIDDEN",
      "Sensitive variables cannot be placed in the URL",
    );
    revision(request.expectedProjectRevision, "Project revision");
    return {
      key: request.key,
      name: request.name.trim(),
      valueType,
      scope,
      transport,
      sensitive: request.sensitive,
      defaultValue: scalar(request.defaultValue, valueType),
    };
  }

  #project(projectId: string): { readonly revision: number } {
    const row = this.repository.connection
      .prepare(
        `SELECT revision FROM projects
         WHERE id = ? AND lifecycle_status = 'ACTIVE'`,
      )
      .get(projectId) as { readonly revision: number } | undefined;
    assertApi(
      row !== undefined,
      404,
      "PROJECT_NOT_FOUND",
      "Project was not found",
    );
    return row;
  }

  #variable(variableId: string): ProjectVariableRow {
    const row = this.#variableRow(variableId);
    assertApi(
      row.deleted_at === null,
      404,
      "VARIABLE_NOT_FOUND",
      "Variable was not found",
    );
    this.#project(row.project_id);
    return row;
  }

  #variableRow(variableId: string): ProjectVariableRow {
    const row = this.repository.row(variableId);
    assertApi(
      row !== undefined,
      404,
      "VARIABLE_NOT_FOUND",
      "Variable was not found",
    );
    return row;
  }

  #assertKeyAvailable(
    projectId: string,
    key: string,
    excludingId?: string,
  ): void {
    const row = this.repository.connection
      .prepare(
        `SELECT id FROM project_variables
         WHERE project_id = ? AND variable_key = ? COLLATE NOCASE
           AND deleted_at IS NULL AND (? IS NULL OR id <> ?)
         LIMIT 1`,
      )
      .get(projectId, key, excludingId ?? null, excludingId ?? null) as
      { readonly id: string } | undefined;
    assertApi(
      row === undefined,
      409,
      "VARIABLE_KEY_CONFLICT",
      "Variable key already exists",
      { variableId: row?.id },
    );
  }

  #incrementProject(projectId: string, expected: number, now: string): number {
    const result = this.repository.connection
      .prepare(
        `UPDATE projects SET revision = revision + 1, updated_at = ?
         WHERE id = ? AND revision = ? AND lifecycle_status = 'ACTIVE'`,
      )
      .run(now, projectId, expected);
    assertApi(
      result.changes === 1,
      409,
      "PROJECT_REVISION_CONFLICT",
      "Project revision changed",
    );
    return expected + 1;
  }

  #replay<T>(projectId: string, key: string, hash: string): T | undefined {
    const row = this.repository.connection
      .prepare(
        `SELECT request_hash, response_status, response_json
         FROM project_variable_commands
         WHERE project_id = ? AND idempotency_key = ?`,
      )
      .get(projectId, key) as VariableCommandRow | undefined;
    if (!row) return undefined;
    assertApi(
      row.request_hash === hash,
      409,
      "IDEMPOTENCY_PAYLOAD_CONFLICT",
      "Idempotency key was used with another payload",
    );
    return JSON.parse(row.response_json) as T;
  }

  #record(
    projectId: string,
    variableId: string,
    commandType: string,
    key: string,
    hash: string,
    response: unknown,
    now: string,
  ): void {
    this.repository.connection
      .prepare(
        `INSERT INTO project_variable_commands (
           id, project_id, variable_id, command_type, idempotency_key,
           request_hash, response_status, response_json, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, 200, ?, ?)`,
      )
      .run(
        randomUUID(),
        projectId,
        variableId,
        commandType,
        key,
        hash,
        JSON.stringify(response),
        now,
      );
  }

  #audit(
    projectId: string,
    variableId: string,
    action: string,
    before: unknown,
    after: unknown,
    correlationId: string,
    now: string,
  ): void {
    this.repository.connection
      .prepare(
        `INSERT INTO audit_logs (
           id, project_id, action, object_type, object_id, before_json,
           after_json, correlation_id, created_at
         ) VALUES (?, ?, ?, 'PROJECT_VARIABLE', ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        projectId,
        action,
        variableId,
        before === null ? null : JSON.stringify(before),
        after === null ? null : JSON.stringify(after),
        correlationId,
        now,
      );
  }
}
