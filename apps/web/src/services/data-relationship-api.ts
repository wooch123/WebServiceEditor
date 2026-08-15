import type {
  CreateRelationshipBindingRequest,
  DataRelationshipGraphDto,
  DeleteRelationshipBindingDto,
  DeleteRelationshipBindingRequest,
  PreviewRelationshipConnectionRequest,
  RelationshipBindingMutationDto,
  RelationshipConnectionPreviewDto,
  RelationshipHistoryDto,
  RelationshipHistoryMutationDto,
  RelationshipHistoryMutationRequest,
} from "@webeditor/domain";

export class RelationshipApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "RelationshipApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body === undefined
        ? {}
        : { "content-type": "application/json" }),
      ...init?.headers,
    },
  });
  const body = (await response.json()) as
    | T
    | {
        readonly error?: {
          readonly code?: string;
          readonly message?: string;
          readonly details?: unknown;
        };
      };
  if (!response.ok) {
    const error = (
      body as {
        readonly error?: {
          readonly code?: string;
          readonly message?: string;
          readonly details?: unknown;
        };
      }
    ).error;
    throw new RelationshipApiError(
      response.status,
      error?.code ?? "RELATIONSHIP_REQUEST_FAILED",
      error?.message ?? "요청 실패",
      error?.details,
    );
  }
  return body as T;
}

export const dataRelationshipApi = {
  graph(projectId: string): Promise<DataRelationshipGraphDto> {
    return request(`/api/v1/projects/${projectId}/relationship-graph`);
  },

  history(projectId: string): Promise<RelationshipHistoryDto> {
    return request(`/api/v1/projects/${projectId}/binding-history`);
  },

  preview(
    projectId: string,
    payload: PreviewRelationshipConnectionRequest,
  ): Promise<RelationshipConnectionPreviewDto> {
    return request(`/api/v1/projects/${projectId}/connections/preview`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  create(
    projectId: string,
    payload: CreateRelationshipBindingRequest,
  ): Promise<RelationshipBindingMutationDto> {
    return request(`/api/v1/projects/${projectId}/bindings`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  delete(
    bindingId: string,
    payload: DeleteRelationshipBindingRequest,
  ): Promise<DeleteRelationshipBindingDto> {
    return request(`/api/v1/bindings/${bindingId}`, {
      method: "DELETE",
      body: JSON.stringify(payload),
    });
  },

  historyMutation(
    projectId: string,
    operation: "undo" | "redo",
    payload: RelationshipHistoryMutationRequest,
  ): Promise<RelationshipHistoryMutationDto> {
    return request(
      `/api/v1/projects/${projectId}/binding-history/${operation}`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    );
  },
};
