export type ProjectLifecycleStatus =
  | "ACTIVE"
  | "TRASHING"
  | "TRASHED"
  | "RESTORING"
  | "PURGING"
  | "PURGE_FAILED"
  | "PURGED";

export interface ProjectDto {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  lifecycleStatus: ProjectLifecycleStatus;
  status: string;
  schemaVersion: number;
  revision: number;
  lifecycleRevision: number;
  favorite: boolean;
  themeId: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
  deletedReason?: string | null;
  counts?: {
    pages: number;
    elements: number;
    bindings: number;
    tables: number;
    assets: number;
  };
  pageCount: number;
  elementCount: number;
  bindingCount: number;
  tableCount: number;
  assetCount: number;
}

export interface CreateProjectInput {
  name: string;
  description: string;
  themeId: string;
}

export interface UpdateProjectInput {
  expectedRevision: number;
  favorite?: boolean;
  themeId?: string;
  name?: string;
  description?: string;
}

export interface TrashProjectInput {
  expectedRevision: number;
  expectedLifecycleRevision: number;
  idempotencyKey: string;
  reason: string;
}

export type RestoreConflictResolution = "KEEP_ORIGINAL" | "RENAME" | "NEW_SLUG";

export interface RestoreProjectInput {
  expectedLifecycleRevision: number;
  idempotencyKey: string;
  conflictResolution: RestoreConflictResolution;
  name?: string;
  slug?: string;
}

export interface PurgePlanDto {
  purgePlanId: string;
  projectId: string;
  projectName: string;
  lifecycleRevision: number;
  metadataRecordCount: number;
  fileCount: number;
  estimatedBytes: number;
  blockers: string[];
  expiresAt: string;
  backupAvailable: boolean;
}

export interface PurgeProjectInput {
  purgePlanId: string;
  expectedLifecycleRevision: number;
  typedConfirmation: string;
  idempotencyKey: string;
  backupBeforePurge: boolean;
}

export interface ProjectExportPayload {
  format: "webeditor-project-v1";
  project: ProjectDto;
  manifest: Record<string, unknown>;
  files: unknown[];
}

export interface ImportProjectOverrides {
  name?: string;
  slug?: string;
}

export interface LifecycleBatchError {
  code: string;
  message: string;
  statusCode: number;
}

export interface LifecycleBatchResult<T> {
  projectId: string;
  ok: boolean;
  value?: T;
  error?: LifecycleBatchError;
}

export type BatchRestoreProjectInput = RestoreProjectInput & {
  projectId: string;
};

export type BatchPurgeProjectInput = PurgeProjectInput & {
  projectId: string;
};

interface ApiErrorBody {
  code?: unknown;
  message?: unknown;
  details?: unknown;
  error?: ApiErrorBody;
}

export class ProjectsApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(
    message: string,
    options: { status: number; code?: string; details?: unknown },
  ) {
    super(message);
    this.name = "ProjectsApiError";
    this.status = options.status;
    this.code = options.code ?? "HTTP_ERROR";
    this.details = options.details;
  }
}

async function parseError(response: Response): Promise<ProjectsApiError> {
  let body: ApiErrorBody = {};
  try {
    body = (await response.json()) as ApiErrorBody;
  } catch {
    // The status text remains a trustworthy fallback for non-JSON failures.
  }

  const errorBody =
    body.error !== null && typeof body.error === "object" ? body.error : body;
  const message =
    typeof errorBody.message === "string" && errorBody.message.trim()
      ? errorBody.message
      : response.statusText || "프로젝트 요청을 처리하지 못했습니다.";
  const code = typeof errorBody.code === "string" ? errorBody.code : undefined;
  return new ProjectsApiError(message, {
    status: response.status,
    ...(code === undefined ? {} : { code }),
    ...(errorBody.details === undefined ? {} : { details: errorBody.details }),
  });
}

async function requestJson<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  headers.set("accept", "application/json");

  const response = await fetch(path, { ...init, headers });
  if (!response.ok) throw await parseError(response);
  return (await response.json()) as T;
}

function unwrapProjects(payload: unknown): ProjectDto[] {
  if (Array.isArray(payload)) return payload as ProjectDto[];
  if (
    payload !== null &&
    typeof payload === "object" &&
    "projects" in payload &&
    Array.isArray(payload.projects)
  ) {
    return payload.projects as ProjectDto[];
  }
  throw new ProjectsApiError("프로젝트 목록 응답 형식이 올바르지 않습니다.", {
    status: 502,
    code: "INVALID_RESPONSE",
  });
}

function unwrapProject(payload: unknown): ProjectDto {
  if (
    payload !== null &&
    typeof payload === "object" &&
    "project" in payload &&
    payload.project !== null &&
    typeof payload.project === "object"
  ) {
    return payload.project as ProjectDto;
  }
  if (payload !== null && typeof payload === "object" && "id" in payload) {
    return payload as ProjectDto;
  }
  throw new ProjectsApiError("프로젝트 응답 형식이 올바르지 않습니다.", {
    status: 502,
    code: "INVALID_RESPONSE",
  });
}

function unwrapPurgePlan(payload: unknown): PurgePlanDto {
  const candidate =
    payload !== null &&
    typeof payload === "object" &&
    "plan" in payload &&
    payload.plan !== null &&
    typeof payload.plan === "object"
      ? payload.plan
      : payload;

  if (
    candidate !== null &&
    typeof candidate === "object" &&
    "id" in candidate &&
    "impact" in candidate &&
    candidate.impact !== null &&
    typeof candidate.impact === "object"
  ) {
    const plan = candidate as {
      id: string;
      projectId: string;
      projectName: string;
      lifecycleRevision: number;
      expiresAt: string;
      impact: {
        metadataRecordCount: number;
        fileCount: number;
        estimatedBytes: number;
        blockedReasons: string[];
        hasBackup: boolean;
      };
    };
    return {
      purgePlanId: plan.id,
      projectId: plan.projectId,
      projectName: plan.projectName,
      lifecycleRevision: plan.lifecycleRevision,
      metadataRecordCount: plan.impact.metadataRecordCount,
      fileCount: plan.impact.fileCount,
      estimatedBytes: plan.impact.estimatedBytes,
      blockers: plan.impact.blockedReasons,
      expiresAt: plan.expiresAt,
      backupAvailable: plan.impact.hasBackup,
    };
  }
  if (
    candidate !== null &&
    typeof candidate === "object" &&
    "purgePlanId" in candidate
  ) {
    return candidate as PurgePlanDto;
  }
  throw new ProjectsApiError("영구 삭제 계획 응답 형식이 올바르지 않습니다.", {
    status: 502,
    code: "INVALID_RESPONSE",
  });
}

function unwrapBatchResults<T>(payload: unknown): LifecycleBatchResult<T>[] {
  if (
    payload !== null &&
    typeof payload === "object" &&
    "results" in payload &&
    Array.isArray(payload.results)
  ) {
    return payload.results as LifecycleBatchResult<T>[];
  }
  throw new ProjectsApiError("일괄 작업 응답 형식이 올바르지 않습니다.", {
    status: 502,
    code: "INVALID_RESPONSE",
  });
}

export async function listProjects(): Promise<ProjectDto[]> {
  return unwrapProjects(await requestJson<unknown>("/api/v1/projects"));
}

export async function listRecycleBinProjects(): Promise<ProjectDto[]> {
  return unwrapProjects(
    await requestJson<unknown>("/api/v1/recycle-bin/projects"),
  );
}

export async function createProject(
  input: CreateProjectInput,
): Promise<ProjectDto> {
  return unwrapProject(
    await requestJson<unknown>("/api/v1/projects", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  );
}

export async function updateProject(
  projectId: string,
  input: UpdateProjectInput,
): Promise<ProjectDto> {
  return unwrapProject(
    await requestJson<unknown>(`/api/v1/projects/${projectId}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  );
}

export async function cloneProject(projectId: string): Promise<ProjectDto> {
  return unwrapProject(
    await requestJson<unknown>(`/api/v1/projects/${projectId}/clone`, {
      method: "POST",
      body: JSON.stringify({}),
    }),
  );
}

export async function importProject(
  exportPayload: ProjectExportPayload,
  overrides: ImportProjectOverrides = {},
): Promise<ProjectDto> {
  return unwrapProject(
    await requestJson<unknown>("/api/v1/projects/import", {
      method: "POST",
      body: JSON.stringify({ export: exportPayload, ...overrides }),
    }),
  );
}

export interface ProjectExport {
  blob: Blob;
  filename: string;
}

export async function exportProject(projectId: string): Promise<ProjectExport> {
  const response = await fetch(`/api/v1/projects/${projectId}/export`, {
    method: "POST",
    headers: { accept: "application/json, application/octet-stream" },
  });
  if (!response.ok) throw await parseError(response);

  const disposition = response.headers.get("content-disposition") ?? "";
  const match = /filename\*?=(?:UTF-8''|")?([^";]+)/i.exec(disposition);
  const filename = match?.[1]
    ? decodeURIComponent(match[1].replace(/^"|"$/g, ""))
    : `${projectId}.webeditor.json`;
  return { blob: await response.blob(), filename };
}

export async function trashProject(
  projectId: string,
  input: TrashProjectInput,
): Promise<ProjectDto> {
  return unwrapProject(
    await requestJson<unknown>(`/api/v1/projects/${projectId}/trash`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  );
}

export async function restoreProject(
  projectId: string,
  input: RestoreProjectInput,
): Promise<ProjectDto> {
  return unwrapProject(
    await requestJson<unknown>(
      `/api/v1/recycle-bin/projects/${projectId}/restore`,
      { method: "POST", body: JSON.stringify(input) },
    ),
  );
}

export async function batchRestoreProjects(
  items: BatchRestoreProjectInput[],
): Promise<LifecycleBatchResult<ProjectDto>[]> {
  return unwrapBatchResults<ProjectDto>(
    await requestJson<unknown>("/api/v1/recycle-bin/projects/batch-restore", {
      method: "POST",
      body: JSON.stringify({ items }),
    }),
  );
}

export async function createPurgePlan(
  projectId: string,
  expectedLifecycleRevision: number,
): Promise<PurgePlanDto> {
  return unwrapPurgePlan(
    await requestJson<unknown>(
      `/api/v1/recycle-bin/projects/${projectId}/purge-plan`,
      {
        method: "POST",
        body: JSON.stringify({ expectedLifecycleRevision }),
      },
    ),
  );
}

export async function purgeProject(
  projectId: string,
  input: PurgeProjectInput,
): Promise<void> {
  await requestJson<unknown>(`/api/v1/recycle-bin/projects/${projectId}`, {
    method: "DELETE",
    body: JSON.stringify(input),
  });
}

export async function batchPurgeProjects(
  items: BatchPurgeProjectInput[],
): Promise<LifecycleBatchResult<unknown>[]> {
  return unwrapBatchResults<unknown>(
    await requestJson<unknown>("/api/v1/recycle-bin/projects/batch-purge", {
      method: "POST",
      body: JSON.stringify({ items }),
    }),
  );
}

export function newIdempotencyKey(operation: string): string {
  const id =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${operation}:${id}`;
}
