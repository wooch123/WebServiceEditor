import type {
  CanvasPointerDto,
  ElementChange,
  ElementCommandSummaryDto,
  ElementDefinition,
  ElementEntryDto,
  ElementHistoryDto,
  ElementHistoryMutationDto,
  ElementInspectorDto,
  ElementLayoutDto,
  ElementMutationDto,
  ElementPropertyField,
  ElementPropertyTabId,
  ElementPropertyValue,
  ElementRegistryDto,
  ElementRenderState,
  PlacementCandidateDto,
  PublishedRuntimePageDto,
  ResizeHandle,
  ElementType,
} from "@webeditor/domain";

export type {
  CanvasPointerDto,
  ElementEntryDto,
  ElementHistoryDto,
  ElementHistoryMutationDto,
  ElementLayoutDto,
  ElementMutationDto,
  ElementPropertyTabId,
  ElementPropertyValue,
  ElementRegistryDto,
  ElementRenderState,
  ElementType,
  PlacementCandidateDto,
  PublishedRuntimePageDto,
  ResizeHandle,
};

export type ElementChangeDto = ElementChange;
export type ElementDefinitionDto = ElementDefinition;
export type ElementDetailDto = ElementInspectorDto;
export type ElementHistoryCommandDto = ElementCommandSummaryDto;
export type ElementPropertyFieldDto = ElementPropertyField;
export type ElementCategory = ElementDefinition["category"];
export type ElementPropertyControl = ElementPropertyField["control"];
export type ElementPropertyTabDto = ElementRegistryDto["tabs"][number];

interface ApiErrorEnvelope {
  error?: { code?: unknown; message?: unknown; details?: unknown };
}

export class ElementsApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(
    message: string,
    options: { status: number; code?: string; details?: unknown },
  ) {
    super(message);
    this.name = "ElementsApiError";
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
      // Status and a concise fallback remain available for invalid bodies.
    }
    const error = envelope.error;
    throw new ElementsApiError(
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

function idempotencyKey(scope: string): string {
  return `${scope}:${crypto.randomUUID()}`;
}

export function listElements(pageId: string, signal?: AbortSignal) {
  return request<{
    pageId: string;
    breakpoint: "desktop";
    layoutRevision: number;
    projectRevision: number;
    elements: ElementEntryDto[];
  }>(`/api/v1/pages/${encodeURIComponent(pageId)}/elements`, {
    ...(signal ? { signal } : {}),
  });
}

export function listElementRegistry(signal?: AbortSignal) {
  return request<ElementRegistryDto>("/api/v1/elements/registry", {
    ...(signal ? { signal } : {}),
  });
}

export function getElementDetail(elementId: string, signal?: AbortSignal) {
  return request<ElementDetailDto>(
    `/api/v1/elements/${encodeURIComponent(elementId)}`,
    { ...(signal ? { signal } : {}) },
  );
}

export function getElementHistory(projectId: string, signal?: AbortSignal) {
  return request<ElementHistoryDto>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/element-history`,
    { ...(signal ? { signal } : {}) },
  );
}

export function getPublishedRuntimePage(
  projectId: string,
  pageId: string,
  signal?: AbortSignal,
) {
  return request<PublishedRuntimePageDto>(
    `/api/v1/runtime/${encodeURIComponent(projectId)}/pages/${encodeURIComponent(pageId)}`,
    { ...(signal ? { signal } : {}) },
  );
}

export function mutateElementHistory(input: {
  projectId: string;
  operation: "undo" | "redo";
  expectedProjectRevision: number;
  expectedCommandId: string;
}) {
  return request<ElementHistoryMutationDto>(
    `/api/v1/projects/${encodeURIComponent(input.projectId)}/element-history/${input.operation}`,
    {
      method: "POST",
      body: JSON.stringify({
        expectedProjectRevision: input.expectedProjectRevision,
        expectedCommandId: input.expectedCommandId,
        idempotencyKey: idempotencyKey(
          `element-history:${input.projectId}:${input.operation}:${input.expectedCommandId}`,
        ),
      }),
    },
  );
}

export function createPlacementCandidate(input: {
  pageId: string;
  elementType: ElementType;
  pointer: CanvasPointerDto;
  canvasWidth: number;
  canvasHeight: number;
  expectedLayoutRevision: number;
  expectedProjectRevision: number;
  signal?: AbortSignal;
}) {
  return request<{ candidate: PlacementCandidateDto }>(
    `/api/v1/pages/${encodeURIComponent(input.pageId)}/placement-candidates`,
    {
      method: "POST",
      ...(input.signal ? { signal: input.signal } : {}),
      body: JSON.stringify({
        elementType: input.elementType,
        pointer: input.pointer,
        canvasWidth: input.canvasWidth,
        canvasHeight: input.canvasHeight,
        expectedLayoutRevision: input.expectedLayoutRevision,
        expectedProjectRevision: input.expectedProjectRevision,
      }),
    },
  );
}

export function createElementFromPlacement(input: {
  pageId: string;
  candidateId: string;
  expectedLayoutRevision: number;
  expectedProjectRevision: number;
}) {
  return request<ElementMutationDto>(
    `/api/v1/pages/${encodeURIComponent(input.pageId)}/elements/from-placement`,
    {
      method: "POST",
      body: JSON.stringify({
        candidateId: input.candidateId,
        expectedLayoutRevision: input.expectedLayoutRevision,
        expectedProjectRevision: input.expectedProjectRevision,
        idempotencyKey: idempotencyKey(
          `element-placement:${input.pageId}:${input.candidateId}`,
        ),
      }),
    },
  );
}

export function updateElement(input: {
  entry: ElementEntryDto;
  expectedLayoutRevision: number;
  expectedProjectRevision: number;
  change: ElementChangeDto;
  idempotencyKey?: string;
}) {
  return request<ElementMutationDto>(
    `/api/v1/elements/${encodeURIComponent(input.entry.element.id)}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        expectedRevision: input.entry.element.revision,
        expectedLayoutRevision: input.expectedLayoutRevision,
        expectedProjectRevision: input.expectedProjectRevision,
        idempotencyKey:
          input.idempotencyKey ??
          idempotencyKey(
            `element-${input.change.kind.toLowerCase()}:${input.entry.element.id}`,
          ),
        change: input.change,
      }),
    },
  );
}

export function deleteElement(input: {
  entry: ElementEntryDto;
  expectedLayoutRevision: number;
  expectedProjectRevision: number;
}) {
  return request<{
    deletedElementId: string;
    layoutRevision: number;
    projectRevision: number;
    commandId: string;
  }>(`/api/v1/elements/${encodeURIComponent(input.entry.element.id)}`, {
    method: "DELETE",
    body: JSON.stringify({
      expectedRevision: input.entry.element.revision,
      expectedLayoutRevision: input.expectedLayoutRevision,
      expectedProjectRevision: input.expectedProjectRevision,
      idempotencyKey: idempotencyKey(
        `element-delete:${input.entry.element.id}`,
      ),
    }),
  });
}

export function batchElementLayout(input: {
  pageId: string;
  expectedLayoutRevision: number;
  expectedProjectRevision: number;
  mode: "COMPLETE" | "PARTIAL";
  items: Array<{
    elementId: string;
    expectedRevision: number;
    x: number;
    y: number;
    w: number;
    h: number;
  }>;
}) {
  return request<{
    pageId: string;
    mode: "COMPLETE" | "PARTIAL";
    entries: ElementEntryDto[];
    layoutRevision: number;
    projectRevision: number;
    commandId: string;
  }>("/api/v1/elements/batch-layout", {
    method: "POST",
    body: JSON.stringify({
      pageId: input.pageId,
      expectedLayoutRevision: input.expectedLayoutRevision,
      expectedProjectRevision: input.expectedProjectRevision,
      idempotencyKey: idempotencyKey(`element-batch:${input.pageId}`),
      mode: input.mode,
      items: input.items,
    }),
  });
}
