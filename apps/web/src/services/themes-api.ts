import type {
  RuntimeThemeManifest,
  RuntimeThemePolicy,
  ThemeRevisionStatus,
  ThemeRevisionValidation,
  ThemeTokens,
} from "@webeditor/theme-core";

export interface ThemeRevisionDto {
  id: string;
  projectId: string;
  presetId: string;
  tokenHash: string;
  tokens: ThemeTokens;
  status: ThemeRevisionStatus;
  revision: number;
  createdAt: string;
  updatedAt: string;
  basedOnRevisionId: string | null;
  validationRunId: string | null;
  publishedAt: string | null;
  validation: ThemeRevisionValidation | null;
}

export interface ThemeRevisionMutationDto {
  revision: ThemeRevisionDto;
  policy: RuntimeThemePolicy;
  projectRevision: number;
  commandId: string;
  runtimeApplied: boolean;
}

interface ApiErrorEnvelope {
  error?: { code?: unknown; message?: unknown; details?: unknown };
}

export class ThemesApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(
    message: string,
    options: { status: number; code?: string; details?: unknown },
  ) {
    super(message);
    this.name = "ThemesApiError";
    this.status = options.status;
    this.code = options.code ?? "HTTP_ERROR";
    this.details = options.details;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  if (init.body !== undefined) headers.set("content-type", "application/json");
  const response = await fetch(path, { ...init, headers });
  if (!response.ok) {
    let envelope: ApiErrorEnvelope = {};
    try {
      envelope = (await response.json()) as ApiErrorEnvelope;
    } catch {
      // HTTP status remains the fallback for malformed error bodies.
    }
    throw new ThemesApiError(
      typeof envelope.error?.message === "string"
        ? envelope.error.message
        : "테마 요청 실패",
      {
        status: response.status,
        ...(typeof envelope.error?.code === "string"
          ? { code: envelope.error.code }
          : {}),
        ...(envelope.error?.details === undefined
          ? {}
          : { details: envelope.error.details }),
      },
    );
  }
  return (await response.json()) as T;
}

function key(scope: string): string {
  return `${scope}:${crypto.randomUUID()}`;
}

export function createThemeRevision(
  projectId: string,
  presetId: string,
  expectedProjectRevision: number,
) {
  return request<ThemeRevisionMutationDto>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/theme-revisions`,
    {
      method: "POST",
      body: JSON.stringify({
        presetId,
        expectedProjectRevision,
        idempotencyKey: key(`theme-create:${projectId}`),
      }),
    },
  );
}

export function validateThemeRevision(
  projectId: string,
  revision: ThemeRevisionDto,
  expectedProjectRevision: number,
) {
  return request<ThemeRevisionMutationDto>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/theme-revisions/${encodeURIComponent(revision.id)}/validate`,
    {
      method: "POST",
      body: JSON.stringify({
        expectedRevision: revision.revision,
        expectedProjectRevision,
        idempotencyKey: key(`theme-validate:${revision.id}`),
      }),
    },
  );
}

export function getRuntimeThemeManifest(
  projectId: string,
  signal?: AbortSignal,
) {
  return request<RuntimeThemeManifest>(
    `/api/v1/runtime/${encodeURIComponent(projectId)}/theme-manifest`,
    signal ? { signal } : {},
  );
}
