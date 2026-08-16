import type {
  CreateProjectBackupRequest,
  ProjectBackupDrillDto,
  ProjectBackupDto,
  ProjectBackupRestoreDto,
  RestoreProjectBackupRequest,
} from "@webeditor/domain";

import { ProjectsApiError } from "./projects-api";

interface ErrorEnvelope {
  readonly error?: {
    readonly code?: unknown;
    readonly message?: unknown;
    readonly details?: unknown;
  };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  if (init.body !== undefined) headers.set("content-type", "application/json");
  const response = await fetch(path, { ...init, headers });
  if (!response.ok) {
    let body: ErrorEnvelope = {};
    try {
      body = (await response.json()) as ErrorEnvelope;
    } catch {
      // Status text is the fallback for non-JSON server errors.
    }
    throw new ProjectsApiError(
      typeof body.error?.message === "string"
        ? body.error.message
        : response.statusText || "백업 요청을 처리하지 못했습니다.",
      {
        status: response.status,
        ...(typeof body.error?.code === "string"
          ? { code: body.error.code }
          : {}),
        ...(body.error?.details === undefined
          ? {}
          : { details: body.error.details }),
      },
    );
  }
  return (await response.json()) as T;
}

export async function listProjectBackups(): Promise<ProjectBackupDto[]> {
  return (await request<{ backups: ProjectBackupDto[] }>("/api/v1/backups"))
    .backups;
}

export async function createProjectBackup(
  projectId: string,
  input: CreateProjectBackupRequest,
): Promise<ProjectBackupDto> {
  return (
    await request<{ backup: ProjectBackupDto }>(
      `/api/v1/projects/${projectId}/backups`,
      { method: "POST", body: JSON.stringify(input) },
    )
  ).backup;
}

export async function verifyProjectBackup(
  backupId: string,
  idempotencyKey: string,
): Promise<ProjectBackupDrillDto> {
  return (
    await request<{ drill: ProjectBackupDrillDto }>(
      `/api/v1/backups/${backupId}/verify`,
      { method: "POST", body: JSON.stringify({ idempotencyKey }) },
    )
  ).drill;
}

export async function restoreProjectBackup(
  backupId: string,
  input: RestoreProjectBackupRequest,
): Promise<ProjectBackupRestoreDto> {
  return (
    await request<{ restored: ProjectBackupRestoreDto }>(
      `/api/v1/backups/${backupId}/restore`,
      { method: "POST", body: JSON.stringify(input) },
    )
  ).restored;
}
