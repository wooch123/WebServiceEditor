import type { BindingScalar } from "./binding-query.js";

export const PROJECT_VARIABLE_SCHEMA_VERSION = 1 as const;
export const PROJECT_VARIABLE_TYPES = [
  "string",
  "number",
  "boolean",
  "date",
  "datetime",
] as const;
export const PROJECT_VARIABLE_SCOPES = ["project", "session", "page"] as const;
export const PROJECT_VARIABLE_TRANSPORTS = [
  "URL_QUERY",
  "SESSION_STATE",
] as const;

export type ProjectVariableType = (typeof PROJECT_VARIABLE_TYPES)[number];
export type ProjectVariableScope = (typeof PROJECT_VARIABLE_SCOPES)[number];
export type ProjectVariableTransport =
  (typeof PROJECT_VARIABLE_TRANSPORTS)[number];

export interface ProjectVariableDto {
  readonly id: string;
  readonly projectId: string;
  readonly key: string;
  readonly name: string;
  readonly valueType: ProjectVariableType;
  readonly scope: ProjectVariableScope;
  readonly transport: ProjectVariableTransport;
  readonly sensitive: boolean;
  readonly defaultValue: BindingScalar;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ProjectVariableListDto {
  readonly schemaVersion: typeof PROJECT_VARIABLE_SCHEMA_VERSION;
  readonly projectId: string;
  readonly projectRevision: number;
  readonly variables: readonly ProjectVariableDto[];
}

export interface CreateProjectVariableRequestDto {
  readonly key: string;
  readonly name: string;
  readonly valueType: ProjectVariableType;
  readonly scope: ProjectVariableScope;
  readonly transport: ProjectVariableTransport;
  readonly sensitive: boolean;
  readonly defaultValue: BindingScalar;
  readonly expectedProjectRevision: number;
  readonly idempotencyKey: string;
}

export interface UpdateProjectVariableRequestDto {
  readonly key?: string;
  readonly name?: string;
  readonly scope?: ProjectVariableScope;
  readonly transport?: ProjectVariableTransport;
  readonly sensitive?: boolean;
  readonly defaultValue?: BindingScalar;
  readonly expectedRevision: number;
  readonly expectedProjectRevision: number;
  readonly idempotencyKey: string;
}

export interface DeleteProjectVariableRequestDto {
  readonly expectedRevision: number;
  readonly expectedProjectRevision: number;
  readonly idempotencyKey: string;
}

export interface ProjectVariableMutationDto {
  readonly variable: ProjectVariableDto;
  readonly projectRevision: number;
  readonly commandId: string;
}

export interface DeleteProjectVariableDto {
  readonly deletedVariableId: string;
  readonly projectRevision: number;
  readonly commandId: string;
}

export interface ConfigureFilterDependencyRequestDto {
  readonly kind: "FILTER";
  readonly variableId: string;
  readonly sourceFieldId: string;
  readonly targetReadBindingId: string;
  readonly targetFieldId: string;
  readonly operator: "EQ";
}

export interface ConfigureNavigationDependencyRequestDto {
  readonly kind: "NAVIGATE";
  readonly variableId: string;
  readonly sourceFieldId: string;
  readonly targetPageId: string;
  readonly transport: ProjectVariableTransport;
}

export type ConfigureBindingDependencyRequestDto =
  ConfigureFilterDependencyRequestDto | ConfigureNavigationDependencyRequestDto;

export interface RuntimeFilterDependencyDto extends ConfigureFilterDependencyRequestDto {
  readonly bindingId: string;
  readonly sourceElementId: string;
  readonly targetElementId: string;
}

export interface RuntimeNavigationDependencyDto extends ConfigureNavigationDependencyRequestDto {
  readonly bindingId: string;
  readonly sourceElementId: string;
}

export interface RuntimeActionChainDto {
  readonly sourceElementId: string;
  readonly variableId: string;
  readonly sourceFieldId: string;
  readonly filter: RuntimeFilterDependencyDto;
  readonly navigation: RuntimeNavigationDependencyDto;
}
