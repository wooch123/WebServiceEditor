import type {
  ProjectCounts,
  ProjectDto,
  ProjectLifecycleStatus,
  ProjectStatus,
  PurgePlanDto,
  ProjectTombstoneDto,
} from "@webeditor/domain";
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

import { ApiError } from "../errors.js";
import type { MetadataDatabase } from "../metadata/database.js";

export interface ProjectRow {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly description: string | null;
  readonly lifecycle_status: ProjectLifecycleStatus;
  readonly status: ProjectStatus;
  readonly schema_version: number;
  readonly revision: number;
  readonly lifecycle_revision: number;
  readonly favorite: 0 | 1;
  readonly theme_id: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly deleted_at: string | null;
  readonly deleted_reason: string | null;
  readonly original_storage_path: string | null;
  readonly current_storage_path: string | null;
  readonly tombstone_checksum: string | null;
}

export interface LifecycleOperationRow {
  readonly id: string;
  readonly project_id: string;
  readonly operation_type: "TRASH" | "RESTORE" | "PURGE";
  readonly from_status: ProjectLifecycleStatus;
  readonly to_status: ProjectLifecycleStatus;
  readonly idempotency_key: string;
  readonly request_hash: string;
  readonly storage_from: string | null;
  readonly storage_to: string | null;
  readonly status: "PENDING" | "COMPLETED" | "FAILED";
  readonly response_status: number | null;
  readonly response_json: string | null;
  readonly error_json: string | null;
  readonly started_at: string;
  readonly completed_at: string | null;
}

export interface TrashManifestRow {
  readonly project_id: string;
  readonly operation_id: string;
  readonly original_slug: string;
  readonly original_storage_path: string;
  readonly trash_storage_path: string;
  readonly project_checksum: string;
  readonly test_db_checksum: string;
  readonly production_db_checksum: string;
  readonly asset_count: number;
  readonly deleted_at: string;
  readonly manifest_json: string;
}

interface PurgePlanRow {
  readonly id: string;
  readonly project_id: string;
  readonly project_name: string;
  readonly lifecycle_revision: number;
  readonly project_checksum: string;
  readonly impact_json: string;
  readonly created_at: string;
  readonly expires_at: string;
  readonly consumed_at: string | null;
}

const projectColumns = `
  id, name, slug, description, lifecycle_status, status, schema_version,
  revision, lifecycle_revision, favorite, theme_id, created_at, updated_at,
  deleted_at, deleted_reason, original_storage_path, current_storage_path,
  tombstone_checksum
`;

const emptyCounts: ProjectCounts = {
  pages: 0,
  elements: 0,
  bindings: 0,
  tables: 0,
  assets: 0,
};

export class ProjectRepository {
  constructor(readonly metadataDatabase: MetadataDatabase) {}

  get connection(): Database.Database {
    return this.metadataDatabase.connection;
  }

  listActive(): readonly ProjectRow[] {
    return this.connection
      .prepare(
        `SELECT ${projectColumns} FROM projects
         WHERE lifecycle_status = 'ACTIVE'
         ORDER BY favorite DESC, updated_at DESC, name COLLATE NOCASE`,
      )
      .all() as readonly ProjectRow[];
  }

  listRecycleBin(): readonly ProjectRow[] {
    return this.connection
      .prepare(
        `SELECT ${projectColumns} FROM projects
         WHERE lifecycle_status IN ('TRASHED', 'PURGE_FAILED')
         ORDER BY deleted_at DESC, name COLLATE NOCASE`,
      )
      .all() as readonly ProjectRow[];
  }

  listKnownProjectIds(): ReadonlySet<string> {
    const rows = this.connection
      .prepare("SELECT id FROM projects WHERE lifecycle_status != 'PURGED'")
      .all() as readonly { readonly id: string }[];
    return new Set(rows.map((row) => row.id));
  }

  get(projectId: string): ProjectRow | undefined {
    return this.connection
      .prepare(`SELECT ${projectColumns} FROM projects WHERE id = ?`)
      .get(projectId) as ProjectRow | undefined;
  }

  hasActiveNameOrSlug(
    name: string,
    slug: string,
    excludingProjectId?: string,
  ): { readonly nameConflict: boolean; readonly slugConflict: boolean } {
    const rows = this.connection
      .prepare(
        `SELECT id, name, slug FROM projects
         WHERE lifecycle_status IN ('ACTIVE', 'TRASHING', 'RESTORING')
           AND (? IS NULL OR id != ?)`,
      )
      .all(excludingProjectId ?? null, excludingProjectId ?? null) as readonly {
      readonly id: string;
      readonly name: string;
      readonly slug: string;
    }[];
    const normalizedName = name.trim().toLocaleLowerCase();
    const normalizedSlug = slug.trim().toLocaleLowerCase();
    return {
      nameConflict: rows.some(
        (row) => row.name.trim().toLocaleLowerCase() === normalizedName,
      ),
      slugConflict: rows.some(
        (row) => row.slug.trim().toLocaleLowerCase() === normalizedSlug,
      ),
    };
  }

  insert(project: {
    readonly id: string;
    readonly name: string;
    readonly slug: string;
    readonly description: string | null;
    readonly favorite: boolean;
    readonly themeId: string;
    readonly now: string;
  }): ProjectRow {
    this.connection
      .prepare(
        `INSERT INTO projects (
          id, name, slug, description, lifecycle_status, status,
          schema_version, revision, lifecycle_revision, favorite, theme_id,
          created_at, updated_at, original_storage_path, current_storage_path
        ) VALUES (?, ?, ?, ?, 'ACTIVE', 'DRAFT', 1, 1, 0, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        project.id,
        project.name,
        project.slug,
        project.description,
        project.favorite ? 1 : 0,
        project.themeId,
        project.now,
        project.now,
        `active/${project.id}`,
        `active/${project.id}`,
      );
    return this.getRequired(project.id);
  }

  patch(
    projectId: string,
    expectedRevision: number,
    patch: {
      readonly name: string;
      readonly slug: string;
      readonly description: string | null;
      readonly favorite: boolean;
      readonly themeId: string;
      readonly now: string;
    },
  ): ProjectRow | undefined {
    const result = this.connection
      .prepare(
        `UPDATE projects SET
          name = ?, slug = ?, description = ?, favorite = ?, theme_id = ?,
          revision = revision + 1, updated_at = ?
         WHERE id = ? AND lifecycle_status = 'ACTIVE' AND revision = ?`,
      )
      .run(
        patch.name,
        patch.slug,
        patch.description,
        patch.favorite ? 1 : 0,
        patch.themeId,
        patch.now,
        projectId,
        expectedRevision,
      );
    return result.changes === 1 ? this.getRequired(projectId) : undefined;
  }

  updateIdentityDuringRestore(
    projectId: string,
    expectedRevision: number,
    identity: {
      readonly name: string;
      readonly slug: string;
      readonly now: string;
    },
  ): ProjectRow | undefined {
    const result = this.connection
      .prepare(
        `UPDATE projects SET name = ?, slug = ?, revision = revision + 1,
           updated_at = ?
         WHERE id = ? AND lifecycle_status IN ('TRASHED', 'RESTORING') AND revision = ?`,
      )
      .run(
        identity.name,
        identity.slug,
        identity.now,
        projectId,
        expectedRevision,
      );
    return result.changes === 1 ? this.getRequired(projectId) : undefined;
  }

  restoreIdentityAfterFailedRestore(
    projectId: string,
    identity: {
      readonly name: string;
      readonly slug: string;
      readonly revision: number;
      readonly now: string;
    },
  ): ProjectRow {
    const result = this.connection
      .prepare(
        `UPDATE projects SET name = ?, slug = ?, revision = ?, updated_at = ?
         WHERE id = ? AND lifecycle_status = 'RESTORING'`,
      )
      .run(
        identity.name,
        identity.slug,
        identity.revision,
        identity.now,
        projectId,
      );
    if (result.changes !== 1) {
      throw new Error("Failed restore identity could not be compensated");
    }
    return this.getRequired(projectId);
  }

  transition(
    projectId: string,
    from: readonly ProjectLifecycleStatus[],
    to: ProjectLifecycleStatus,
    expectedLifecycleRevision: number,
    now: string,
    deleted?: { readonly reason: string | null },
  ): ProjectRow | undefined {
    const placeholders = from.map(() => "?").join(", ");
    const result = this.connection
      .prepare(
        `UPDATE projects SET lifecycle_status = ?,
           lifecycle_revision = lifecycle_revision + 1,
           updated_at = ?,
           deleted_at = CASE WHEN ? = 'TRASHING' THEN ? WHEN ? = 'ACTIVE' THEN NULL ELSE deleted_at END,
           deleted_reason = CASE WHEN ? = 'TRASHING' THEN ? WHEN ? = 'ACTIVE' THEN NULL ELSE deleted_reason END,
           current_storage_path = CASE WHEN ? = 'TRASHED' THEN ? WHEN ? = 'ACTIVE' THEN ? WHEN ? = 'PURGED' THEN NULL ELSE current_storage_path END
         WHERE id = ? AND lifecycle_status IN (${placeholders})
           AND lifecycle_revision = ?`,
      )
      .run(
        to,
        now,
        to,
        now,
        to,
        to,
        deleted?.reason ?? null,
        to,
        to,
        `trash/${projectId}`,
        to,
        `active/${projectId}`,
        to,
        projectId,
        ...from,
        expectedLifecycleRevision,
      );
    return result.changes === 1 ? this.getRequired(projectId) : undefined;
  }

  setPurgeTombstone(projectId: string, checksum: string): void {
    this.connection
      .prepare(
        "UPDATE projects SET tombstone_checksum = ?, current_storage_path = NULL WHERE id = ?",
      )
      .run(checksum, projectId);
  }

  getRequired(projectId: string): ProjectRow {
    const row = this.get(projectId);
    if (row === undefined) {
      throw new Error(`Project ${projectId} disappeared during a transaction`);
    }
    return row;
  }

  toDto(row: ProjectRow, counts: ProjectCounts = emptyCounts): ProjectDto {
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      description: row.description,
      lifecycleStatus: row.lifecycle_status,
      status: row.status,
      schemaVersion: row.schema_version,
      revision: row.revision,
      lifecycleRevision: row.lifecycle_revision,
      favorite: row.favorite === 1,
      themeId: row.theme_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      deletedAt: row.deleted_at,
      deletedReason: row.deleted_reason,
      counts,
      pageCount: counts.pages,
      elementCount: counts.elements,
      bindingCount: counts.bindings,
      tableCount: counts.tables,
      assetCount: counts.assets,
    };
  }

  findOperation(
    projectId: string,
    idempotencyKey: string,
  ): LifecycleOperationRow | undefined {
    return this.connection
      .prepare(
        `SELECT id, project_id, operation_type, from_status, to_status,
           idempotency_key, request_hash, storage_from, storage_to, status,
           response_status, response_json, error_json, started_at, completed_at
         FROM project_lifecycle_operations
         WHERE project_id = ? AND idempotency_key = ?`,
      )
      .get(projectId, idempotencyKey) as LifecycleOperationRow | undefined;
  }

  beginOperation(operation: {
    readonly id: string;
    readonly projectId: string;
    readonly type: "TRASH" | "RESTORE" | "PURGE";
    readonly from: ProjectLifecycleStatus;
    readonly to: ProjectLifecycleStatus;
    readonly idempotencyKey: string;
    readonly requestHash: string;
    readonly storageFrom: string;
    readonly storageTo: string | null;
    readonly now: string;
  }): void {
    this.connection
      .prepare(
        `INSERT INTO project_lifecycle_operations (
          id, project_id, operation_type, from_status, to_status,
          idempotency_key, request_hash, storage_from, storage_to,
          status, started_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)`,
      )
      .run(
        operation.id,
        operation.projectId,
        operation.type,
        operation.from,
        operation.to,
        operation.idempotencyKey,
        operation.requestHash,
        operation.storageFrom,
        operation.storageTo,
        operation.now,
      );
  }

  completeOperation(
    operationId: string,
    statusCode: number,
    response: unknown,
    now: string,
  ): void {
    this.connection
      .prepare(
        `UPDATE project_lifecycle_operations
         SET status = 'COMPLETED', response_status = ?, response_json = ?,
             error_json = NULL, completed_at = ? WHERE id = ?`,
      )
      .run(statusCode, JSON.stringify(response), now, operationId);
    this.connection
      .prepare(
        `UPDATE lifecycle_outbox SET status = 'COMPLETED',
           attempt_count = attempt_count + 1, completed_at = ?
         WHERE operation_id = ?`,
      )
      .run(now, operationId);
  }

  failOperation(operationId: string, error: unknown, now: string): void {
    const detail =
      error instanceof Error
        ? { name: error.name, message: error.message }
        : { message: "Unknown lifecycle failure" };
    const apiError =
      error instanceof ApiError
        ? error
        : new ApiError(
            500,
            "INTERNAL_ERROR",
            "The server could not complete the request",
          );
    const response = {
      error: {
        code: apiError.code,
        message: apiError.message,
        ...(apiError.details === undefined
          ? {}
          : { details: apiError.details }),
      },
    };
    this.connection
      .prepare(
        `UPDATE project_lifecycle_operations
         SET status = 'FAILED', response_status = ?, response_json = ?,
             error_json = ?, completed_at = ? WHERE id = ?`,
      )
      .run(
        apiError.statusCode,
        JSON.stringify(response),
        JSON.stringify(detail),
        now,
        operationId,
      );
    this.connection
      .prepare(
        `UPDATE lifecycle_outbox SET status = 'FAILED',
           attempt_count = attempt_count + 1, next_attempt_at = ?
         WHERE operation_id = ?`,
      )
      .run(now, operationId);
  }

  createOutbox(
    operationId: string,
    projectId: string,
    eventType: string,
    payload: unknown,
    now: string,
  ): void {
    this.connection
      .prepare(
        `INSERT INTO lifecycle_outbox (
           id, project_id, operation_id, event_type, payload_json,
           status, attempt_count, created_at
         ) VALUES (?, ?, ?, ?, ?, 'PENDING', 0, ?)`,
      )
      .run(
        randomUUID(),
        projectId,
        operationId,
        eventType,
        JSON.stringify(payload),
        now,
      );
  }

  getOutboxPayload(operationId: string): unknown {
    const row = this.connection
      .prepare(
        "SELECT payload_json FROM lifecycle_outbox WHERE operation_id = ? ORDER BY created_at LIMIT 1",
      )
      .get(operationId) as { readonly payload_json: string } | undefined;
    return row === undefined ? undefined : JSON.parse(row.payload_json);
  }

  writeAudit(event: {
    readonly id?: string;
    readonly projectId: string;
    readonly action: string;
    readonly before: unknown;
    readonly after: unknown;
    readonly correlationId: string;
    readonly now: string;
  }): string {
    const id = event.id ?? randomUUID();
    this.connection
      .prepare(
        `INSERT INTO audit_logs (
          id, project_id, action, object_type, object_id, before_json,
          after_json, correlation_id, created_at
        ) VALUES (?, ?, ?, 'project', ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        event.projectId,
        event.action,
        event.projectId,
        JSON.stringify(event.before),
        JSON.stringify(event.after),
        event.correlationId,
        event.now,
      );
    return id;
  }

  putTrashManifest(manifest: TrashManifestRow): void {
    this.connection
      .prepare(
        `INSERT OR REPLACE INTO trash_manifests (
          project_id, operation_id, original_slug, original_storage_path,
          trash_storage_path, project_checksum, test_db_checksum,
          production_db_checksum, asset_count, deleted_at, manifest_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        manifest.project_id,
        manifest.operation_id,
        manifest.original_slug,
        manifest.original_storage_path,
        manifest.trash_storage_path,
        manifest.project_checksum,
        manifest.test_db_checksum,
        manifest.production_db_checksum,
        manifest.asset_count,
        manifest.deleted_at,
        manifest.manifest_json,
      );
  }

  getTrashManifest(projectId: string): TrashManifestRow | undefined {
    return this.connection
      .prepare("SELECT * FROM trash_manifests WHERE project_id = ?")
      .get(projectId) as TrashManifestRow | undefined;
  }

  removeTrashManifest(projectId: string): void {
    this.connection
      .prepare("DELETE FROM trash_manifests WHERE project_id = ?")
      .run(projectId);
  }

  metadataRecordCount(projectId: string): number {
    const tableNames = [
      "projects",
      "audit_logs",
      "project_lifecycle_operations",
      "lifecycle_outbox",
      "trash_manifests",
      "purge_plans",
      "project_tombstones",
      "pages",
      "page_commands",
      "project_definition_operations",
      "project_versions",
      "page_layout_revisions",
      "elements",
      "element_layouts",
      "element_commands",
    ] as const;
    return tableNames.reduce((total, tableName) => {
      const projectColumn = tableName === "projects" ? "id" : "project_id";
      const row = this.connection
        .prepare(
          `SELECT count(*) AS count FROM ${tableName} WHERE ${projectColumn} = ?`,
        )
        .get(projectId) as { readonly count: number };
      return total + row.count;
    }, 0);
  }

  putPurgePlan(plan: PurgePlanDto, createdAt: string): void {
    this.connection
      .prepare(
        `INSERT INTO purge_plans (
          id, project_id, project_name, lifecycle_revision, project_checksum,
          impact_json, created_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        plan.id,
        plan.projectId,
        plan.projectName,
        plan.lifecycleRevision,
        plan.projectChecksum,
        JSON.stringify(plan.impact),
        createdAt,
        plan.expiresAt,
      );
  }

  getPurgePlan(planId: string): PurgePlanDto | undefined {
    const row = this.connection
      .prepare("SELECT * FROM purge_plans WHERE id = ?")
      .get(planId) as PurgePlanRow | undefined;
    if (row === undefined || row.consumed_at !== null) {
      return undefined;
    }
    return {
      id: row.id,
      projectId: row.project_id,
      projectName: row.project_name,
      lifecycleRevision: row.lifecycle_revision,
      projectChecksum: row.project_checksum,
      expiresAt: row.expires_at,
      typedConfirmation: row.project_name,
      impact: JSON.parse(row.impact_json) as PurgePlanDto["impact"],
    };
  }

  consumePurgePlan(planId: string, now: string): void {
    this.connection
      .prepare(
        "UPDATE purge_plans SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL",
      )
      .run(now, planId);
  }

  putTombstone(
    tombstone: ProjectTombstoneDto,
    operationId: string,
    purgePlanId: string,
  ): void {
    this.connection
      .prepare(
        `INSERT INTO project_tombstones (
          project_id, project_name, project_checksum, operation_id,
          backup_retained, detail_json, purged_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        tombstone.projectId,
        tombstone.projectName,
        tombstone.projectChecksum,
        operationId,
        tombstone.backupRetained ? 1 : 0,
        JSON.stringify({ ...tombstone, purgePlanId }),
        tombstone.purgedAt,
      );
  }

  pendingOperations(): readonly LifecycleOperationRow[] {
    return this.connection
      .prepare(
        `SELECT id, project_id, operation_type, from_status, to_status,
          idempotency_key, request_hash, storage_from, storage_to, status,
          response_status, response_json, error_json, started_at, completed_at
         FROM project_lifecycle_operations WHERE status = 'PENDING'
         ORDER BY started_at`,
      )
      .all() as readonly LifecycleOperationRow[];
  }

  completedPurgeCleanups(): readonly {
    readonly operationId: string;
    readonly projectId: string;
    readonly detailJson: string;
  }[] {
    return this.connection
      .prepare(
        `SELECT o.id AS operationId, o.project_id AS projectId,
           t.detail_json AS detailJson
         FROM project_lifecycle_operations o
         JOIN project_tombstones t ON t.operation_id = o.id
         WHERE o.operation_type = 'PURGE' AND o.status = 'COMPLETED'`,
      )
      .all() as readonly {
      readonly operationId: string;
      readonly projectId: string;
      readonly detailJson: string;
    }[];
  }
}
