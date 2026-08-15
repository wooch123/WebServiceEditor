import type { ProjectLifecycleStatus } from "./project-lifecycle.js";

export const PROJECT_STATUSES = ["DRAFT", "PUBLISHED"] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export interface ProjectCounts {
  readonly pages: number;
  readonly elements: number;
  readonly bindings: number;
  readonly tables: number;
  readonly assets: number;
}

/**
 * Public project representation. Server filesystem paths are deliberately not
 * part of this contract: a project is addressed only by its stable UUID.
 */
export interface ProjectDto {
  readonly id: string;
  readonly schemaVersion: number;
  readonly revision: number;
  readonly lifecycleRevision: number;
  readonly name: string;
  readonly slug: string;
  readonly description: string | null;
  readonly lifecycleStatus: ProjectLifecycleStatus;
  readonly status: ProjectStatus;
  readonly favorite: boolean;
  readonly themeId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly deletedAt: string | null;
  readonly deletedReason: string | null;
  readonly counts: ProjectCounts;
  readonly pageCount: number;
  readonly elementCount: number;
  readonly bindingCount: number;
  readonly tableCount: number;
  readonly assetCount: number;
}

export type Project = ProjectDto;

export interface CreateProjectRequest {
  readonly name: string;
  readonly slug?: string;
  readonly description?: string | null;
  readonly favorite?: boolean;
  readonly themeId?: string;
}

export interface PatchProjectRequest {
  readonly expectedRevision: number;
  readonly name?: string;
  readonly slug?: string;
  readonly description?: string | null;
  readonly favorite?: boolean;
  readonly themeId?: string;
}

export interface TrashProjectRequest {
  readonly expectedRevision: number;
  readonly expectedLifecycleRevision?: number;
  readonly idempotencyKey: string;
  readonly reason?: string;
}

export const RESTORE_CONFLICT_RESOLUTIONS = [
  "KEEP_ORIGINAL",
  "RENAME",
  "NEW_SLUG",
] as const;

export type RestoreConflictResolution =
  (typeof RESTORE_CONFLICT_RESOLUTIONS)[number];

export interface RestoreProjectRequest {
  readonly expectedLifecycleRevision: number;
  readonly idempotencyKey: string;
  readonly conflictResolution: RestoreConflictResolution;
  readonly name?: string;
  readonly slug?: string;
}

export interface PurgePlanRequest {
  readonly expectedLifecycleRevision: number;
}

export interface PurgeProjectRequest {
  readonly purgePlanId: string;
  readonly expectedLifecycleRevision: number;
  readonly typedConfirmation: string;
  readonly idempotencyKey: string;
  readonly backupBeforePurge: boolean;
}

export interface PurgePlanImpact {
  readonly metadataRecordCount: number;
  readonly fileCount: number;
  readonly assetCount: number;
  readonly estimatedBytes: number;
  readonly hasBackup: boolean;
  readonly blockedReasons: readonly string[];
}

export interface PurgePlanDto {
  readonly id: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly lifecycleRevision: number;
  readonly projectChecksum: string;
  readonly expiresAt: string;
  readonly typedConfirmation: string;
  readonly impact: PurgePlanImpact;
}

export interface ProjectTombstoneDto {
  readonly projectId: string;
  readonly projectName: string;
  readonly projectChecksum: string;
  readonly purgedAt: string;
  readonly backupRetained: boolean;
}

export interface ProjectExportDto {
  readonly format: "webeditor-project-v1";
  readonly project: ProjectDto;
  readonly manifest: Record<string, unknown>;
  readonly files: readonly ProjectExportFile[];
}

export interface ProjectExportFile {
  readonly path: string;
  readonly sha256: string;
  readonly contentBase64: string;
}
