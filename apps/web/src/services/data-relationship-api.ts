import type {
  ApplyRelationshipAutoLayoutRequest,
  BindingExecutionDto,
  BindingQueryPreviewDto,
  CreateRelationshipBindingRequest,
  DataRelationshipGraphDto,
  DeleteRelationshipBindingDto,
  DeleteRelationshipBindingRequest,
  PreviewRelationshipAutoLayoutRequest,
  PreviewBindingQueryRequest,
  PreviewRelationshipConnectionRequest,
  RelationshipAutoLayoutApplyDto,
  RelationshipAutoLayoutPreviewDto,
  RelationshipBindingMutationDto,
  RelationshipConnectionPreviewDto,
  RelationshipHistoryDto,
  RelationshipHistoryMutationDto,
  RelationshipHistoryMutationRequest,
  RelationshipLayoutHistoryDto,
  RelationshipLayoutHistoryMutationDto,
  RelationshipLayoutHistoryMutationRequest,
  RelationshipNodePositionMutationDto,
  RelationshipRoutePreviewDto,
  RelationshipRoutePreviewRequest,
  RelationshipViewportDto,
  UpdateRelationshipNodePositionRequest,
  UpdateRelationshipViewportRequest,
} from "@webeditor/domain";

import { apiFetch } from "./api-fetch";

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
  const response = await apiFetch(path, {
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

  moveNode(
    projectId: string,
    nodeId: string,
    payload: UpdateRelationshipNodePositionRequest,
  ): Promise<RelationshipNodePositionMutationDto> {
    return request(
      `/api/v1/projects/${projectId}/relationship-nodes/${encodeURIComponent(nodeId)}`,
      { method: "PATCH", body: JSON.stringify(payload) },
    );
  },

  updateViewport(
    projectId: string,
    payload: UpdateRelationshipViewportRequest,
  ): Promise<RelationshipViewportDto> {
    return request(`/api/v1/projects/${projectId}/relationship-viewport`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  },

  routePreview(
    projectId: string,
    payload: RelationshipRoutePreviewRequest,
  ): Promise<RelationshipRoutePreviewDto> {
    return request(`/api/v1/projects/${projectId}/edges/route-preview`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  previewAutoLayout(
    projectId: string,
    payload: PreviewRelationshipAutoLayoutRequest,
  ): Promise<RelationshipAutoLayoutPreviewDto> {
    return request(`/api/v1/projects/${projectId}/auto-layout`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  applyAutoLayout(
    projectId: string,
    payload: ApplyRelationshipAutoLayoutRequest,
  ): Promise<RelationshipAutoLayoutApplyDto> {
    return request(`/api/v1/projects/${projectId}/auto-layout`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  layoutHistory(projectId: string): Promise<RelationshipLayoutHistoryDto> {
    return request(`/api/v1/projects/${projectId}/relationship-layout-history`);
  },

  layoutHistoryMutation(
    projectId: string,
    operation: "undo" | "redo",
    payload: RelationshipLayoutHistoryMutationRequest,
  ): Promise<RelationshipLayoutHistoryMutationDto> {
    return request(
      `/api/v1/projects/${projectId}/relationship-layout-history/${operation}`,
      { method: "POST", body: JSON.stringify(payload) },
    );
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

  previewQuery(
    projectId: string,
    payload: PreviewBindingQueryRequest,
  ): Promise<BindingQueryPreviewDto> {
    return request(`/api/v1/projects/${projectId}/binding-query-previews`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  executePreview(bindingId: string): Promise<BindingExecutionDto> {
    return request(`/api/v1/bindings/${bindingId}/preview`, {
      method: "POST",
      body: JSON.stringify({}),
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
