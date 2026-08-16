import type { ValidationRunDto, ValidationRunListDto } from "@webeditor/domain";

import { apiFetch } from "./api-fetch";

interface ErrorEnvelope {
  readonly error?: {
    readonly code?: unknown;
    readonly message?: unknown;
    readonly details?: unknown;
  };
}

export class ValidationApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ValidationApiError";
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  if (init.body !== undefined) headers.set("content-type", "application/json");
  const response = await apiFetch(path, { ...init, headers });
  if (!response.ok) {
    let envelope: ErrorEnvelope = {};
    try {
      envelope = (await response.json()) as ErrorEnvelope;
    } catch {
      // HTTP status is the safe fallback for malformed responses.
    }
    throw new ValidationApiError(
      typeof envelope.error?.message === "string"
        ? envelope.error.message
        : "검증 실패",
      response.status,
      typeof envelope.error?.code === "string"
        ? envelope.error.code
        : "HTTP_ERROR",
      envelope.error?.details,
    );
  }
  return (await response.json()) as T;
}

function key(scope: string): string {
  return `${scope}:${crypto.randomUUID()}`;
}

export function runProjectValidation(
  projectId: string,
  expectedProjectRevision: number,
  inventoryOnly = false,
) {
  const operation = inventoryOnly ? "validate-inventory" : "validate";
  return request<ValidationRunDto>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/${operation}`,
    {
      method: "POST",
      body: JSON.stringify({
        expectedProjectRevision,
        idempotencyKey: key(`${operation}:${projectId}`),
      }),
    },
  );
}

export function listValidationRuns(projectId: string, signal?: AbortSignal) {
  return request<ValidationRunListDto>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/validation-runs`,
    signal ? { signal } : {},
  );
}

export function getValidationRun(
  projectId: string,
  runId: string,
  signal?: AbortSignal,
) {
  return request<ValidationRunDto>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/validation-runs/${encodeURIComponent(runId)}`,
    signal ? { signal } : {},
  );
}
