import type { ProjectDto } from "./project.js";

export const PROJECT_BACKUP_STATUSES = ["VERIFIED", "INVALID"] as const;

export type ProjectBackupStatus = (typeof PROJECT_BACKUP_STATUSES)[number];

export interface ProjectBackupDto {
  readonly id: string;
  readonly sourceProjectId: string;
  readonly sourceProjectName: string;
  readonly sourceProjectSlug: string;
  readonly sourceProjectRevision: number;
  readonly status: ProjectBackupStatus;
  readonly label: string | null;
  readonly payloadChecksum: string;
  readonly contentChecksum: string;
  readonly fileCount: number;
  readonly totalBytes: number;
  readonly createdAt: string;
  readonly verifiedAt: string;
}

export interface CreateProjectBackupRequest {
  readonly expectedRevision: number;
  readonly idempotencyKey: string;
  readonly label?: string;
}

export interface RestoreProjectBackupRequest {
  readonly idempotencyKey: string;
  readonly name?: string;
  readonly slug?: string;
}

export interface VerifyProjectBackupRequest {
  readonly idempotencyKey: string;
}

export interface ProjectBackupRestoreDto {
  readonly backup: ProjectBackupDto;
  readonly project: ProjectDto;
  readonly sourcePayloadChecksum: string;
  readonly restoredFileCount: number;
  readonly restoredAt: string;
}

export interface ProjectBackupDrillDto {
  readonly id: string;
  readonly backupId: string;
  readonly status: "PASS" | "FAIL";
  readonly payloadChecksum: string;
  readonly contentChecksum: string;
  readonly fileCount: number;
  readonly checkedAt: string;
}

export interface ProjectBackupListDto {
  readonly backups: readonly ProjectBackupDto[];
}
