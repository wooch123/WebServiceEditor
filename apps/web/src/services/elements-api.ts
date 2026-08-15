export type ElementType = "text" | "button" | "container" | "kpi-card";
export type ResizeHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export interface ElementDto {
  id: string;
  projectId: string;
  pageId: string;
  type: ElementType;
  typeVersion: number;
  name: string;
  props: Readonly<Record<string, unknown>>;
  style: Readonly<Record<string, unknown>>;
  events: readonly unknown[];
  locked: boolean;
  hidden: boolean;
  revision: number;
}

export interface ElementLayoutDto {
  elementId: string;
  breakpoint: "desktop";
  x: number;
  y: number;
  w: number;
  h: number;
  minW: number;
  minH: number;
  maxW: number;
  maxH: number;
}

export interface ElementEntryDto {
  element: ElementDto;
  layout: ElementLayoutDto;
}

export interface PlacementCandidateDto {
  candidateId: string;
  pageId: string;
  elementType: ElementType;
  breakpoint: "desktop";
  x: number;
  y: number;
  w: number;
  h: number;
  valid: boolean;
  collisionResolved: boolean;
  layoutRevision: number;
  projectRevision: number;
  expiresAt: string;
}

export interface CanvasPointerDto {
  rawCanvasX: number;
  rawCanvasY: number;
  correctedCanvasX: number;
  correctedCanvasY: number;
}

export type ElementChangeDto =
  | { kind: "MOVE"; x: number; y: number }
  | {
      kind: "RESIZE";
      handle: ResizeHandle;
      x: number;
      y: number;
      w: number;
      h: number;
    }
  | { kind: "LOCK"; locked: boolean };

export interface ElementMutationDto {
  entry: ElementEntryDto;
  layoutRevision: number;
  projectRevision: number;
  commandId: string;
}

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
}) {
  return request<ElementMutationDto>(
    `/api/v1/elements/${encodeURIComponent(input.entry.element.id)}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        expectedRevision: input.entry.element.revision,
        expectedLayoutRevision: input.expectedLayoutRevision,
        expectedProjectRevision: input.expectedProjectRevision,
        idempotencyKey: idempotencyKey(
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
