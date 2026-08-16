import type {
  CreateProjectVariableRequestDto,
  DeleteProjectVariableDto,
  DeleteProjectVariableRequestDto,
  ProjectVariableListDto,
  ProjectVariableMutationDto,
  UpdateProjectVariableRequestDto,
} from "@webeditor/domain";

import { apiFetch } from "./api-fetch";

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
    T | { readonly error?: { readonly message?: string } };
  if (!response.ok) {
    throw new Error(
      (body as { readonly error?: { readonly message?: string } }).error
        ?.message ?? "변수 요청 실패",
    );
  }
  return body as T;
}

export const projectVariablesApi = {
  list(projectId: string): Promise<ProjectVariableListDto> {
    return request(
      `/api/v1/projects/${encodeURIComponent(projectId)}/variables`,
    );
  },
  create(
    projectId: string,
    payload: CreateProjectVariableRequestDto,
  ): Promise<ProjectVariableMutationDto> {
    return request(
      `/api/v1/projects/${encodeURIComponent(projectId)}/variables`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    );
  },
  update(
    variableId: string,
    payload: UpdateProjectVariableRequestDto,
  ): Promise<ProjectVariableMutationDto> {
    return request(`/api/v1/variables/${encodeURIComponent(variableId)}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  },
  delete(
    variableId: string,
    payload: DeleteProjectVariableRequestDto,
  ): Promise<DeleteProjectVariableDto> {
    return request(`/api/v1/variables/${encodeURIComponent(variableId)}`, {
      method: "DELETE",
      body: JSON.stringify(payload),
    });
  },
};
