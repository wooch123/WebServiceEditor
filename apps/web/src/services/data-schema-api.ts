import type {
  ApplySchemaMigrationDto,
  CreateDataFieldRequest,
  CreateDataRelationRequest,
  CreateDataTableRequest,
  DataSchemaDto,
  DeleteDataFieldRequest,
  DeleteDataRelationRequest,
  DeleteDataTableRequest,
  PatchDataFieldRequest,
  PatchDataRelationRequest,
  PatchDataTableRequest,
  SchemaMigrationPlanDto,
  SampleDataMutationDto,
} from "@webeditor/domain";

import { apiFetch } from "./api-fetch";

export type {
  ApplySchemaMigrationDto,
  DataFieldDto,
  DataFieldType,
  DataRelationDto,
  DataRelationType,
  DataSchemaDto,
  DataTableDto,
  DataTableTemplate,
  SchemaMigrationPlanDto,
} from "@webeditor/domain";

interface ApiErrorEnvelope {
  readonly error?: {
    readonly code?: unknown;
    readonly message?: unknown;
    readonly details?: unknown;
  };
}

export class DataSchemaApiError extends Error {
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
    this.name = "DataSchemaApiError";
    this.status = options.status;
    this.code = options.code ?? "HTTP_ERROR";
    this.details = options.details;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  if (init.body !== undefined) headers.set("content-type", "application/json");
  const response = await apiFetch(path, { ...init, headers });
  if (!response.ok) {
    let envelope: ApiErrorEnvelope = {};
    try {
      envelope = (await response.json()) as ApiErrorEnvelope;
    } catch {
      // The status fallback remains concise when a proxy returns invalid JSON.
    }
    throw new DataSchemaApiError(
      typeof envelope.error?.message === "string"
        ? envelope.error.message
        : "요청 실패",
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

export function getDataSchema(projectId: string, signal?: AbortSignal) {
  return request<DataSchemaDto>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/schema`,
    signal ? { signal } : {},
  );
}

export function createDataTable(
  projectId: string,
  input: Omit<CreateDataTableRequest, "idempotencyKey">,
) {
  return request<DataSchemaDto>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/tables`,
    {
      method: "POST",
      body: JSON.stringify({
        ...input,
        idempotencyKey: key(`table-create:${projectId}`),
      }),
    },
  );
}

export function patchDataTable(
  tableId: string,
  input: Omit<PatchDataTableRequest, "idempotencyKey">,
) {
  return request<DataSchemaDto>(
    `/api/v1/tables/${encodeURIComponent(tableId)}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        ...input,
        idempotencyKey: key(`table-patch:${tableId}`),
      }),
    },
  );
}

export function deleteDataTable(
  tableId: string,
  input: Omit<DeleteDataTableRequest, "idempotencyKey">,
) {
  return request<DataSchemaDto>(
    `/api/v1/tables/${encodeURIComponent(tableId)}`,
    {
      method: "DELETE",
      body: JSON.stringify({
        ...input,
        idempotencyKey: key(`table-delete:${tableId}`),
      }),
    },
  );
}

export function createDataField(
  tableId: string,
  input: Omit<CreateDataFieldRequest, "idempotencyKey">,
) {
  return request<DataSchemaDto>(
    `/api/v1/tables/${encodeURIComponent(tableId)}/fields`,
    {
      method: "POST",
      body: JSON.stringify({
        ...input,
        idempotencyKey: key(`field-create:${tableId}`),
      }),
    },
  );
}

export function patchDataField(
  fieldId: string,
  input: Omit<PatchDataFieldRequest, "idempotencyKey">,
) {
  return request<DataSchemaDto>(
    `/api/v1/fields/${encodeURIComponent(fieldId)}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        ...input,
        idempotencyKey: key(`field-patch:${fieldId}`),
      }),
    },
  );
}

export function deleteDataField(
  fieldId: string,
  input: Omit<DeleteDataFieldRequest, "idempotencyKey">,
) {
  return request<DataSchemaDto>(
    `/api/v1/fields/${encodeURIComponent(fieldId)}`,
    {
      method: "DELETE",
      body: JSON.stringify({
        ...input,
        idempotencyKey: key(`field-delete:${fieldId}`),
      }),
    },
  );
}

export function createDataRelation(
  projectId: string,
  input: Omit<CreateDataRelationRequest, "idempotencyKey">,
) {
  return request<DataSchemaDto>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/relations`,
    {
      method: "POST",
      body: JSON.stringify({
        ...input,
        idempotencyKey: key(`relation-create:${projectId}`),
      }),
    },
  );
}

export function patchDataRelation(
  relationId: string,
  input: Omit<PatchDataRelationRequest, "idempotencyKey">,
) {
  return request<DataSchemaDto>(
    `/api/v1/relations/${encodeURIComponent(relationId)}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        ...input,
        idempotencyKey: key(`relation-patch:${relationId}`),
      }),
    },
  );
}

export function deleteDataRelation(
  relationId: string,
  input: Omit<DeleteDataRelationRequest, "idempotencyKey">,
) {
  return request<DataSchemaDto>(
    `/api/v1/relations/${encodeURIComponent(relationId)}`,
    {
      method: "DELETE",
      body: JSON.stringify({
        ...input,
        idempotencyKey: key(`relation-delete:${relationId}`),
      }),
    },
  );
}

export function createSchemaPlan(schema: DataSchemaDto) {
  return request<{ readonly plan: SchemaMigrationPlanDto }>(
    `/api/v1/projects/${encodeURIComponent(schema.projectId)}/schema/plan`,
    {
      method: "POST",
      body: JSON.stringify({
        expectedSchemaRevision: schema.schemaRevision,
        expectedProjectRevision: schema.projectRevision,
      }),
    },
  );
}

export function applySchemaPlan(
  schema: DataSchemaDto,
  planId: string,
  confirmDestructive: boolean,
  idempotencyKey = key(`schema-apply:${schema.projectId}`),
) {
  return request<ApplySchemaMigrationDto>(
    `/api/v1/projects/${encodeURIComponent(schema.projectId)}/schema/apply`,
    {
      method: "POST",
      body: JSON.stringify({
        planId,
        expectedSchemaRevision: schema.schemaRevision,
        expectedProjectRevision: schema.projectRevision,
        confirmDestructive,
        idempotencyKey,
      }),
    },
  );
}

export function generateSampleData(
  projectId: string,
  rowCount = 24,
  reset = true,
) {
  return request<SampleDataMutationDto>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/sample-data/generate`,
    {
      method: "POST",
      body: JSON.stringify({
        rowCount,
        reset,
        idempotencyKey: key(`sample-generate:${projectId}`),
      }),
    },
  );
}

export function resetSampleData(projectId: string) {
  return request<SampleDataMutationDto>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/sample-data/reset`,
    {
      method: "POST",
      body: JSON.stringify({
        idempotencyKey: key(`sample-reset:${projectId}`),
      }),
    },
  );
}
