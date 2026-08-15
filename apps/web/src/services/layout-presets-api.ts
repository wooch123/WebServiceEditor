import type {
  ApplyLayoutPresetDto,
  LayoutPresetApplyMode,
  LayoutPresetCategory,
  LayoutPresetDefinition,
  LayoutPresetInstanceDto,
  LayoutPresetId,
  LayoutPresetPreviewDto,
  LayoutPresetProposedElementDto,
  LayoutPresetRegistryDto,
} from "@webeditor/domain";

export type LayoutPresetMode = LayoutPresetApplyMode;
export type {
  ApplyLayoutPresetDto,
  LayoutPresetCategory,
  LayoutPresetDefinition,
  LayoutPresetInstanceDto,
  LayoutPresetId,
  LayoutPresetPreviewDto,
  LayoutPresetProposedElementDto,
  LayoutPresetRegistryDto,
};

interface ApiErrorEnvelope {
  readonly error?: {
    readonly code?: unknown;
    readonly message?: unknown;
    readonly details?: unknown;
  };
}

export class LayoutPresetsApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(
    message: string,
    options: { status: number; code?: string; details?: unknown },
  ) {
    super(message);
    this.name = "LayoutPresetsApiError";
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
      // A concise status fallback remains available for invalid bodies.
    }
    const error = envelope.error;
    throw new LayoutPresetsApiError(
      typeof error?.message === "string" ? error.message : "요청 실패",
      {
        status: response.status,
        ...(typeof error?.code === "string" ? { code: error.code } : {}),
        ...(error?.details === undefined ? {} : { details: error.details }),
      },
    );
  }
  return (await response.json()) as T;
}

export function listLayoutPresets(signal?: AbortSignal) {
  return request<LayoutPresetRegistryDto>("/api/v1/layout-presets", {
    ...(signal ? { signal } : {}),
  });
}

export function getLayoutPreset(
  presetId: LayoutPresetId,
  signal?: AbortSignal,
) {
  return request<{
    definition: LayoutPresetDefinition;
    registryChecksum: string;
  }>(`/api/v1/layout-presets/${encodeURIComponent(presetId)}`, {
    ...(signal ? { signal } : {}),
  });
}

export function previewLayoutPreset(input: {
  pageId: string;
  presetId: LayoutPresetId;
  mode: LayoutPresetMode;
  expectedLayoutRevision: number;
  expectedProjectRevision: number;
  signal?: AbortSignal;
}) {
  return request<{ preview: LayoutPresetPreviewDto }>(
    `/api/v1/pages/${encodeURIComponent(input.pageId)}/layout-presets/${encodeURIComponent(input.presetId)}/preview`,
    {
      method: "POST",
      ...(input.signal ? { signal: input.signal } : {}),
      body: JSON.stringify({
        mode: input.mode,
        expectedLayoutRevision: input.expectedLayoutRevision,
        expectedProjectRevision: input.expectedProjectRevision,
      }),
    },
  );
}

export function applyLayoutPreset(input: {
  pageId: string;
  presetId: LayoutPresetId;
  previewId: string;
  expectedLayoutRevision: number;
  expectedProjectRevision: number;
  idempotencyKey: string;
}) {
  return request<ApplyLayoutPresetDto>(
    `/api/v1/pages/${encodeURIComponent(input.pageId)}/layout-presets/${encodeURIComponent(input.presetId)}/apply`,
    {
      method: "POST",
      body: JSON.stringify({
        previewId: input.previewId,
        expectedLayoutRevision: input.expectedLayoutRevision,
        expectedProjectRevision: input.expectedProjectRevision,
        idempotencyKey: input.idempotencyKey,
      }),
    },
  );
}

export function listLayoutPresetInstances(
  pageId: string,
  signal?: AbortSignal,
) {
  return request<{
    pageId: string;
    instances: readonly LayoutPresetInstanceDto[];
  }>(`/api/v1/pages/${encodeURIComponent(pageId)}/layout-preset-instances`, {
    ...(signal ? { signal } : {}),
  });
}
