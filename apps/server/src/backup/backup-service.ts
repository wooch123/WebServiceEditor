import { createHash, randomUUID } from "node:crypto";

import type {
  CreateProjectBackupRequest,
  ProjectBackupDrillDto,
  ProjectBackupDto,
  ProjectBackupRestoreDto,
  RestoreProjectBackupRequest,
  VerifyProjectBackupRequest,
} from "@webeditor/domain";

import { ApiError, assertApi } from "../errors.js";
import type { MetadataDatabase } from "../metadata/database.js";
import type { ProjectService } from "../projects/project-service.js";
import {
  BackupStorage,
  type StoredProjectBackupManifest,
} from "./backup-storage.js";

interface BackupRow {
  readonly id: string;
  readonly source_project_id: string;
  readonly source_project_name: string;
  readonly source_project_slug: string;
  readonly source_project_revision: number;
  readonly status: "VERIFIED" | "INVALID";
  readonly label: string | null;
  readonly relative_path: string;
  readonly payload_checksum: string;
  readonly content_checksum: string;
  readonly file_count: number;
  readonly total_bytes: number;
  readonly manifest_json: string;
  readonly created_at: string;
  readonly verified_at: string;
}

interface BackupCommandRow {
  readonly id: string;
  readonly scope_id: string;
  readonly operation_type: "CREATE" | "RESTORE" | "VERIFY";
  readonly idempotency_key: string;
  readonly request_hash: string;
  readonly request_json: string;
  readonly backup_id: string | null;
  readonly status: "PENDING" | "COMPLETED" | "FAILED";
  readonly response_status: number | null;
  readonly response_json: string | null;
  readonly error_json: string | null;
  readonly created_at: string;
  readonly completed_at: string | null;
}

type BackupOperation = BackupCommandRow["operation_type"];

function sha256Json(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function validateIdempotencyKey(value: unknown): string {
  assertApi(
    typeof value === "string" && value.trim().length > 0 && value.length <= 200,
    400,
    "INVALID_IDEMPOTENCY_KEY",
    "idempotencyKey must contain 1 to 200 characters",
  );
  return value;
}

function validateLabel(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  assertApi(
    typeof value === "string" && value.trim().length <= 120,
    400,
    "INVALID_BACKUP_LABEL",
    "Backup label must contain at most 120 characters",
  );
  return value.trim();
}

export class BackupService {
  readonly storage: BackupStorage;

  constructor(
    readonly metadataDatabase: MetadataDatabase,
    readonly projectService: ProjectService,
    storageRoot: string,
    readonly clock: () => Date = () => new Date(),
  ) {
    this.storage = new BackupStorage(storageRoot);
    this.recoverPendingCommands();
  }

  list(): readonly ProjectBackupDto[] {
    return (
      this.metadataDatabase.connection
        .prepare(
          `SELECT * FROM project_backups
           ORDER BY created_at DESC, id DESC`,
        )
        .all() as readonly BackupRow[]
    ).map((row) => this.#toDto(row));
  }

  get(backupId: string): ProjectBackupDto {
    return this.#toDto(this.#requiredBackup(backupId));
  }

  create(
    projectId: string,
    request: CreateProjectBackupRequest,
  ): ProjectBackupDto {
    const idempotencyKey = validateIdempotencyKey(request.idempotencyKey);
    assertApi(
      Number.isInteger(request.expectedRevision) &&
        request.expectedRevision >= 1,
      400,
      "INVALID_EXPECTED_REVISION",
      "expectedRevision must be a positive integer",
    );
    const label = validateLabel(request.label);
    const requestValue = {
      expectedRevision: request.expectedRevision,
      idempotencyKey,
      label,
    };
    const hash = sha256Json({ operation: "CREATE", projectId, requestValue });
    const replay = this.#replay<ProjectBackupDto>(
      projectId,
      "CREATE",
      idempotencyKey,
      hash,
    );
    if (replay !== undefined) return replay;

    const project = this.projectService.getActive(projectId);
    assertApi(
      project.revision === request.expectedRevision,
      409,
      "BACKUP_PROJECT_REVISION_CONFLICT",
      "Project revision changed before backup",
      { latest: project },
    );
    const backupId = randomUUID();
    const commandId = randomUUID();
    const createdAt = this.clock().toISOString();
    this.#beginCommand({
      id: commandId,
      scopeId: projectId,
      operation: "CREATE",
      idempotencyKey,
      requestHash: hash,
      requestValue,
      backupId,
      createdAt,
    });
    try {
      const stored = this.storage.write(
        backupId,
        this.projectService.export(projectId),
        createdAt,
      );
      assertApi(
        stored.manifest.sourceProjectRevision === request.expectedRevision,
        409,
        "BACKUP_PROJECT_REVISION_CONFLICT",
        "Project revision changed while creating the backup",
      );
      const completedAt = this.clock().toISOString();
      const dto = this.#dtoFromManifest(stored.manifest, label);
      this.metadataDatabase.transaction(() => {
        this.#insertBackup(stored.manifest, stored.relativePath, label);
        this.#writeAudit(
          projectId,
          "PROJECT_BACKUP_CREATED",
          backupId,
          null,
          dto,
          commandId,
          completedAt,
        );
        this.#completeCommand(commandId, 201, dto, completedAt);
      });
      return dto;
    } catch (error) {
      this.#recordDeterministicFailure(commandId, error);
      throw error;
    }
  }

  restore(
    backupId: string,
    request: RestoreProjectBackupRequest,
  ): ProjectBackupRestoreDto {
    const idempotencyKey = validateIdempotencyKey(request.idempotencyKey);
    const requestValue = {
      idempotencyKey,
      ...(request.name === undefined ? {} : { name: request.name }),
      ...(request.slug === undefined ? {} : { slug: request.slug }),
    };
    const hash = sha256Json({ operation: "RESTORE", backupId, requestValue });
    const replay = this.#replay<ProjectBackupRestoreDto>(
      backupId,
      "RESTORE",
      idempotencyKey,
      hash,
    );
    if (replay !== undefined) return replay;

    const backup = this.#requiredBackup(backupId);
    assertApi(
      backup.status === "VERIFIED",
      409,
      "BACKUP_NOT_VERIFIED",
      "Only a verified backup can be restored",
    );
    const stored = this.storage.read(backup.source_project_id, backup.id);
    const verification = this.projectService.verifyExport(stored.export);
    const commandId = randomUUID();
    const startedAt = this.clock().toISOString();
    this.#beginCommand({
      id: commandId,
      scopeId: backupId,
      operation: "RESTORE",
      idempotencyKey,
      requestHash: hash,
      requestValue,
      backupId,
      createdAt: startedAt,
    });
    try {
      const project = this.projectService.restoreBackup(
        stored.export,
        {
          ...(request.name === undefined ? {} : { name: request.name }),
          ...(request.slug === undefined ? {} : { slug: request.slug }),
        },
        { backupId, idempotencyKey },
      );
      const completedAt = this.clock().toISOString();
      const result: ProjectBackupRestoreDto = {
        backup: this.#toDto(backup),
        project,
        sourcePayloadChecksum: stored.manifest.payloadChecksum,
        restoredFileCount: verification.fileCount,
        restoredAt: completedAt,
      };
      this.metadataDatabase.transaction(() => {
        this.#insertRestoreRun({
          backup,
          restoredProjectId: project.id,
          status: "PASS",
          detail: { verification, mode: "RESTORE_COPY" },
          startedAt,
          completedAt,
        });
        this.#completeCommand(commandId, 201, result, completedAt);
      });
      return result;
    } catch (error) {
      this.#recordDeterministicFailure(commandId, error);
      throw error;
    }
  }

  verify(
    backupId: string,
    request: VerifyProjectBackupRequest,
  ): ProjectBackupDrillDto {
    const idempotencyKey = validateIdempotencyKey(request.idempotencyKey);
    const requestValue = { idempotencyKey };
    const hash = sha256Json({ operation: "VERIFY", backupId, requestValue });
    const replay = this.#replay<ProjectBackupDrillDto>(
      backupId,
      "VERIFY",
      idempotencyKey,
      hash,
    );
    if (replay !== undefined) return replay;
    const backup = this.#requiredBackup(backupId);
    const commandId = randomUUID();
    const startedAt = this.clock().toISOString();
    this.#beginCommand({
      id: commandId,
      scopeId: backupId,
      operation: "VERIFY",
      idempotencyKey,
      requestHash: hash,
      requestValue,
      backupId,
      createdAt: startedAt,
    });
    try {
      const stored = this.storage.read(backup.source_project_id, backup.id);
      const verification = this.projectService.verifyExport(stored.export);
      const completedAt = this.clock().toISOString();
      const result: ProjectBackupDrillDto = {
        id: randomUUID(),
        backupId,
        status: "PASS",
        payloadChecksum: stored.manifest.payloadChecksum,
        contentChecksum: stored.manifest.contentChecksum,
        fileCount: stored.manifest.fileCount,
        checkedAt: completedAt,
      };
      this.metadataDatabase.transaction(() => {
        this.metadataDatabase.connection
          .prepare(
            "UPDATE project_backups SET status = 'VERIFIED', verified_at = ? WHERE id = ?",
          )
          .run(completedAt, backupId);
        this.#insertRestoreRun({
          backup,
          restoredProjectId: null,
          status: "PASS",
          detail: { verification, mode: "READ_ONLY_DRILL" },
          startedAt,
          completedAt,
          id: result.id,
        });
        this.#completeCommand(commandId, 200, result, completedAt);
      });
      return result;
    } catch (error) {
      const completedAt = this.clock().toISOString();
      this.metadataDatabase.transaction(() => {
        this.metadataDatabase.connection
          .prepare("UPDATE project_backups SET status = 'INVALID' WHERE id = ?")
          .run(backupId);
        this.#insertRestoreRun({
          backup,
          restoredProjectId: null,
          status: "FAIL",
          detail: {
            mode: "READ_ONLY_DRILL",
            error: error instanceof Error ? error.message : String(error),
          },
          startedAt,
          completedAt,
        });
      });
      this.#recordDeterministicFailure(commandId, error);
      throw error;
    }
  }

  recoverPendingCommands(): void {
    const pending = this.metadataDatabase.connection
      .prepare(
        `SELECT * FROM backup_commands
         WHERE status = 'PENDING' ORDER BY created_at, id`,
      )
      .all() as readonly BackupCommandRow[];
    for (const command of pending) this.#recoverCommand(command);
  }

  assertReady(): void {
    const rows = this.metadataDatabase.connection
      .prepare("SELECT * FROM project_backups WHERE status = 'VERIFIED'")
      .all() as readonly BackupRow[];
    for (const row of rows) this.storage.read(row.source_project_id, row.id);
  }

  #recoverCommand(command: BackupCommandRow): void {
    if (command.backup_id === null) {
      throw new Error("Pending backup command has no backup ID");
    }
    const backupId = command.backup_id;
    if (command.operation_type === "CREATE") {
      if (!this.storage.exists(command.scope_id, backupId)) {
        this.metadataDatabase.connection
          .prepare(
            "DELETE FROM backup_commands WHERE id = ? AND status = 'PENDING'",
          )
          .run(command.id);
        return;
      }
      const stored = this.storage.read(command.scope_id, backupId);
      const request = JSON.parse(command.request_json) as { label?: unknown };
      const label = validateLabel(request.label);
      const dto = this.#dtoFromManifest(stored.manifest, label);
      const completedAt = this.clock().toISOString();
      this.metadataDatabase.transaction(() => {
        this.#insertBackup(stored.manifest, stored.relativePath, label);
        this.#writeAudit(
          command.scope_id,
          "PROJECT_BACKUP_CREATED",
          backupId,
          null,
          dto,
          command.id,
          completedAt,
        );
        this.#completeCommand(command.id, 201, dto, completedAt);
      });
      return;
    }
    if (command.operation_type === "RESTORE") {
      const restored = this.metadataDatabase.connection
        .prepare(
          `SELECT project_id FROM audit_logs
           WHERE action = 'PROJECT_BACKUP_RESTORED'
             AND json_extract(before_json, '$.backupId') = ?
             AND json_extract(before_json, '$.idempotencyKey') = ?
           ORDER BY created_at DESC, id DESC LIMIT 1`,
        )
        .get(backupId, command.idempotency_key) as
        { readonly project_id: string } | undefined;
      if (restored === undefined) {
        this.metadataDatabase.connection
          .prepare(
            "DELETE FROM backup_commands WHERE id = ? AND status = 'PENDING'",
          )
          .run(command.id);
        return;
      }
      const backup = this.#requiredBackup(backupId);
      const stored = this.storage.read(backup.source_project_id, backup.id);
      const project = this.projectService.getActive(restored.project_id);
      const completedAt = this.clock().toISOString();
      const result: ProjectBackupRestoreDto = {
        backup: this.#toDto(backup),
        project,
        sourcePayloadChecksum: stored.manifest.payloadChecksum,
        restoredFileCount: stored.manifest.fileCount,
        restoredAt: completedAt,
      };
      this.metadataDatabase.transaction(() => {
        this.#insertRestoreRun({
          backup,
          restoredProjectId: project.id,
          status: "PASS",
          detail: { mode: "RESTORE_RECOVERY" },
          startedAt: command.created_at,
          completedAt,
        });
        this.#completeCommand(command.id, 201, result, completedAt);
      });
      return;
    }
    const backup = this.#requiredBackup(backupId);
    const stored = this.storage.read(backup.source_project_id, backup.id);
    this.projectService.verifyExport(stored.export);
    const completedAt = this.clock().toISOString();
    const result: ProjectBackupDrillDto = {
      id: randomUUID(),
      backupId: backup.id,
      status: "PASS",
      payloadChecksum: stored.manifest.payloadChecksum,
      contentChecksum: stored.manifest.contentChecksum,
      fileCount: stored.manifest.fileCount,
      checkedAt: completedAt,
    };
    this.metadataDatabase.transaction(() => {
      this.metadataDatabase.connection
        .prepare(
          "UPDATE project_backups SET status = 'VERIFIED', verified_at = ? WHERE id = ?",
        )
        .run(completedAt, backup.id);
      this.#insertRestoreRun({
        backup,
        restoredProjectId: null,
        status: "PASS",
        detail: { mode: "READ_ONLY_DRILL_RECOVERY" },
        startedAt: command.created_at,
        completedAt,
        id: result.id,
      });
      this.#completeCommand(command.id, 200, result, completedAt);
    });
  }

  #replay<T>(
    scopeId: string,
    operation: BackupOperation,
    idempotencyKey: string,
    requestHash: string,
  ): T | undefined {
    let command = this.#findCommand(scopeId, operation, idempotencyKey);
    if (command === undefined) return undefined;
    assertApi(
      command.request_hash === requestHash,
      409,
      "IDEMPOTENCY_PAYLOAD_CONFLICT",
      "Idempotency key was already used with another backup payload",
    );
    if (command.status === "PENDING") {
      this.#recoverCommand(command);
      command = this.#findCommand(scopeId, operation, idempotencyKey);
    }
    assertApi(
      command !== undefined && command.status !== "PENDING",
      409,
      "IDEMPOTENCY_OPERATION_INCOMPLETE",
      "Backup operation is still incomplete",
    );
    if (command.status === "FAILED") {
      const error = JSON.parse(command.error_json ?? "{}") as {
        statusCode?: unknown;
        code?: unknown;
        message?: unknown;
        details?: unknown;
      };
      throw new ApiError(
        typeof error.statusCode === "number" ? error.statusCode : 409,
        typeof error.code === "string" ? error.code : "BACKUP_OPERATION_FAILED",
        typeof error.message === "string"
          ? error.message
          : "Backup operation failed",
        error.details,
      );
    }
    assertApi(
      command.response_json !== null,
      503,
      "BACKUP_RESPONSE_MISSING",
      "Completed backup operation has no response",
    );
    return JSON.parse(command.response_json) as T;
  }

  #findCommand(
    scopeId: string,
    operation: BackupOperation,
    idempotencyKey: string,
  ): BackupCommandRow | undefined {
    return this.metadataDatabase.connection
      .prepare(
        `SELECT * FROM backup_commands
         WHERE scope_id = ? AND operation_type = ? AND idempotency_key = ?`,
      )
      .get(scopeId, operation, idempotencyKey) as BackupCommandRow | undefined;
  }

  #beginCommand(input: {
    readonly id: string;
    readonly scopeId: string;
    readonly operation: BackupOperation;
    readonly idempotencyKey: string;
    readonly requestHash: string;
    readonly requestValue: unknown;
    readonly backupId: string;
    readonly createdAt: string;
  }): void {
    this.metadataDatabase.connection
      .prepare(
        `INSERT INTO backup_commands
          (id, scope_id, operation_type, idempotency_key, request_hash,
           request_json, backup_id, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)`,
      )
      .run(
        input.id,
        input.scopeId,
        input.operation,
        input.idempotencyKey,
        input.requestHash,
        JSON.stringify(input.requestValue),
        input.backupId,
        input.createdAt,
      );
  }

  #completeCommand(
    commandId: string,
    statusCode: number,
    response: unknown,
    completedAt: string,
  ): void {
    this.metadataDatabase.connection
      .prepare(
        `UPDATE backup_commands
         SET status = 'COMPLETED', response_status = ?, response_json = ?,
             error_json = NULL, completed_at = ?
         WHERE id = ? AND status = 'PENDING'`,
      )
      .run(statusCode, JSON.stringify(response), completedAt, commandId);
  }

  #recordDeterministicFailure(commandId: string, error: unknown): void {
    if (!(error instanceof ApiError) || error.statusCode >= 500) return;
    const completedAt = this.clock().toISOString();
    this.metadataDatabase.connection
      .prepare(
        `UPDATE backup_commands
         SET status = 'FAILED', response_status = ?, error_json = ?,
             completed_at = ?
         WHERE id = ? AND status = 'PENDING'`,
      )
      .run(
        error.statusCode,
        JSON.stringify({
          statusCode: error.statusCode,
          code: error.code,
          message: error.message,
          ...(error.details === undefined ? {} : { details: error.details }),
        }),
        completedAt,
        commandId,
      );
  }

  #requiredBackup(backupId: string): BackupRow {
    const row = this.metadataDatabase.connection
      .prepare("SELECT * FROM project_backups WHERE id = ?")
      .get(backupId) as BackupRow | undefined;
    assertApi(row !== undefined, 404, "BACKUP_NOT_FOUND", "Backup not found");
    return row;
  }

  #insertBackup(
    manifest: StoredProjectBackupManifest,
    relativePath: string,
    label: string | null,
  ): void {
    this.metadataDatabase.connection
      .prepare(
        `INSERT INTO project_backups
          (id, source_project_id, source_project_name, source_project_slug,
           source_project_revision, status, label, relative_path,
           payload_checksum, content_checksum, file_count, total_bytes,
           manifest_json, created_at, verified_at)
         VALUES (?, ?, ?, ?, ?, 'VERIFIED', ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO NOTHING`,
      )
      .run(
        manifest.backupId,
        manifest.sourceProjectId,
        manifest.sourceProjectName,
        manifest.sourceProjectSlug,
        manifest.sourceProjectRevision,
        label,
        relativePath,
        manifest.payloadChecksum,
        manifest.contentChecksum,
        manifest.fileCount,
        manifest.totalBytes,
        JSON.stringify(manifest),
        manifest.createdAt,
        manifest.createdAt,
      );
  }

  #insertRestoreRun(input: {
    readonly backup: BackupRow;
    readonly restoredProjectId: string | null;
    readonly status: "PASS" | "FAIL";
    readonly detail: unknown;
    readonly startedAt: string;
    readonly completedAt: string;
    readonly id?: string;
  }): void {
    this.metadataDatabase.connection
      .prepare(
        `INSERT INTO backup_restore_runs
          (id, backup_id, restored_project_id, status, payload_checksum,
           content_checksum, detail_json, started_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id ?? randomUUID(),
        input.backup.id,
        input.restoredProjectId,
        input.status,
        input.backup.payload_checksum,
        input.backup.content_checksum,
        JSON.stringify(input.detail),
        input.startedAt,
        input.completedAt,
      );
  }

  #writeAudit(
    projectId: string,
    action: string,
    objectId: string,
    before: unknown,
    after: unknown,
    correlationId: string,
    createdAt: string,
  ): void {
    this.metadataDatabase.connection
      .prepare(
        `INSERT INTO audit_logs
          (id, user_id, project_id, action, object_type, object_id,
           before_json, after_json, correlation_id, created_at)
         VALUES (?, NULL, ?, ?, 'PROJECT_BACKUP', ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        projectId,
        action,
        objectId,
        before === null ? null : JSON.stringify(before),
        JSON.stringify(after),
        correlationId,
        createdAt,
      );
  }

  #toDto(row: BackupRow): ProjectBackupDto {
    return {
      id: row.id,
      sourceProjectId: row.source_project_id,
      sourceProjectName: row.source_project_name,
      sourceProjectSlug: row.source_project_slug,
      sourceProjectRevision: row.source_project_revision,
      status: row.status,
      label: row.label,
      payloadChecksum: row.payload_checksum,
      contentChecksum: row.content_checksum,
      fileCount: row.file_count,
      totalBytes: row.total_bytes,
      createdAt: row.created_at,
      verifiedAt: row.verified_at,
    };
  }

  #dtoFromManifest(
    manifest: StoredProjectBackupManifest,
    label: string | null,
  ): ProjectBackupDto {
    return {
      id: manifest.backupId,
      sourceProjectId: manifest.sourceProjectId,
      sourceProjectName: manifest.sourceProjectName,
      sourceProjectSlug: manifest.sourceProjectSlug,
      sourceProjectRevision: manifest.sourceProjectRevision,
      status: "VERIFIED",
      label,
      payloadChecksum: manifest.payloadChecksum,
      contentChecksum: manifest.contentChecksum,
      fileCount: manifest.fileCount,
      totalBytes: manifest.totalBytes,
      createdAt: manifest.createdAt,
      verifiedAt: manifest.createdAt,
    };
  }
}
