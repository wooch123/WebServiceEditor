import type {
  BindingExecutionDto,
  DraftRuntimePageDto,
  PublishedRuntimeDefinitionPageDto,
  RuntimeBindingResultDto,
} from "@webeditor/domain";

interface ApiErrorEnvelope {
  readonly error?: { readonly message?: unknown };
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
    throw new Error(
      typeof envelope.error?.message === "string"
        ? envelope.error.message
        : "런타임 요청 실패",
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

export type RuntimeBindingExecution = BindingExecutionDto;
