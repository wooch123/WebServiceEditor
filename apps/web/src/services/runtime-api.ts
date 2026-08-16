import type {
  BindingMutationOperation,
  BindingScalar,
  BindingExecutionDto,
  DraftRuntimePageDto,
  PublishedRuntimeDefinitionPageDto,
  RuntimeBindingResultDto,
  RuntimeBindingMutationDto,
} from "@webeditor/domain";

interface ApiErrorEnvelope {
  readonly error?: {
    readonly code?: unknown;
    readonly message?: unknown;
    readonly details?: unknown;
  };
}

export class RuntimeApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(
    message: string,
    options: {
      readonly status: number;
      readonly code?: string;
      readonly details?: unknown;
    },
  ) {
    super(message);
    this.name = "RuntimeApiError";
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
      // A concise status fallback is sufficient for an invalid error body.
    }
    throw new RuntimeApiError(
      typeof envelope.error?.message === "string"
        ? envelope.error.message
        : "런타임 요청 실패",
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

export type RuntimeDefinitionPage =
  PublishedRuntimeDefinitionPageDto | DraftRuntimePageDto;

export function getPublishedRuntimeDefinitionPage(
  projectId: string,
  pageId: string,
  signal?: AbortSignal,
) {
  return request<PublishedRuntimeDefinitionPageDto>(
    `/api/v1/runtime/${encodeURIComponent(projectId)}/pages/${encodeURIComponent(pageId)}`,
    { ...(signal ? { signal } : {}) },
  );
}

export function getDraftRuntimePage(
  previewId: string,
  pageId: string,
  signal?: AbortSignal,
) {
  return request<DraftRuntimePageDto>(
    `/api/v1/draft-previews/${encodeURIComponent(previewId)}/pages/${encodeURIComponent(pageId)}`,
    { ...(signal ? { signal } : {}) },
  );
}

function executeBinding(
  path: string,
  signal?: AbortSignal,
): Promise<RuntimeBindingResultDto> {
  return request<RuntimeBindingResultDto>(path, {
    method: "POST",
    body: JSON.stringify({ parameters: {} }),
    ...(signal ? { signal } : {}),
  });
}

export function executePublishedRuntimeBinding(
  projectId: string,
  bindingId: string,
  signal?: AbortSignal,
) {
  return executeBinding(
    `/api/v1/runtime/${encodeURIComponent(projectId)}/query/${encodeURIComponent(bindingId)}`,
    signal,
  );
}

export function executeDraftRuntimeBinding(
  previewId: string,
  bindingId: string,
  signal?: AbortSignal,
) {
  return executeBinding(
    `/api/v1/draft-previews/${encodeURIComponent(previewId)}/query/${encodeURIComponent(bindingId)}`,
    signal,
  );
}

function executeMutation(
  scope: "runtime" | "draft-previews",
  sourceId: string,
  operation: BindingMutationOperation,
  bindingId: string,
  values: Readonly<Record<string, BindingScalar>>,
  idempotencyKey: string,
  signal?: AbortSignal,
) {
  return request<RuntimeBindingMutationDto>(
    `/api/v1/${scope}/${encodeURIComponent(sourceId)}/${operation.toLowerCase()}/${encodeURIComponent(bindingId)}`,
    {
      method: "POST",
      body: JSON.stringify({ values, idempotencyKey }),
      ...(signal ? { signal } : {}),
    },
  );
}

export function executePublishedRuntimeMutation(
  projectId: string,
  operation: BindingMutationOperation,
  bindingId: string,
  values: Readonly<Record<string, BindingScalar>>,
  idempotencyKey: string,
  signal?: AbortSignal,
) {
  return executeMutation(
    "runtime",
    projectId,
    operation,
    bindingId,
    values,
    idempotencyKey,
    signal,
  );
}

export function executeDraftRuntimeMutation(
  previewId: string,
  operation: BindingMutationOperation,
  bindingId: string,
  values: Readonly<Record<string, BindingScalar>>,
  idempotencyKey: string,
  signal?: AbortSignal,
) {
  return executeMutation(
    "draft-previews",
    previewId,
    operation,
    bindingId,
    values,
    idempotencyKey,
    signal,
  );
}

export type RuntimeBindingExecution = BindingExecutionDto;
