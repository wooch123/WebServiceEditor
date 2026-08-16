import {
  PROJECT_VARIABLE_TRANSPORTS,
  type ConfigureBindingDependencyRequestDto,
  type DataSchemaExportDto,
  type ElementEntryDto,
  type ProjectVariableDto,
  type ProjectVariableTransport,
  type RelationshipBindingDto,
  type RuntimeFilterDependencyDto,
  type RuntimeNavigationDependencyDto,
} from "@webeditor/domain";

import { assertApi } from "../errors.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const DEPENDENCY_SCHEMA_VERSION = 1;

function exactObject(
  value: unknown,
  allowed: readonly string[],
  label: string,
) {
  assertApi(
    typeof value === "object" && value !== null && !Array.isArray(value),
    400,
    "INVALID_BINDING_DEPENDENCY",
    `${label} must be an object`,
  );
  const source = value as Record<string, unknown>;
  const unknown = Object.keys(source).filter((key) => !allowed.includes(key));
  assertApi(
    unknown.length === 0,
    400,
    "UNKNOWN_BINDING_DEPENDENCY_FIELD",
    `${label} contains unknown fields`,
    { fields: unknown },
  );
  return source;
}

function uuid(value: unknown, label: string): string {
  assertApi(
    typeof value === "string" && UUID_PATTERN.test(value),
    400,
    "INVALID_BINDING_DEPENDENCY",
    `${label} is invalid`,
  );
  return value;
}

function fieldType(type: string): ProjectVariableDto["valueType"] {
  if (type === "INTEGER" || type === "REAL") return "number";
  if (type === "BOOLEAN") return "boolean";
  if (type === "DATE") return "date";
  if (type === "DATETIME") return "datetime";
  return "string";
}

function storedRead(binding: RelationshipBindingDto) {
  assertApi(
    binding.bindingType === "READ" &&
      typeof binding.query === "object" &&
      binding.query !== null &&
      typeof binding.query.tableId === "string" &&
      typeof binding.query.spec === "object" &&
      binding.query.spec !== null,
    409,
    "DEPENDENCY_READ_BINDING_INVALID",
    "The dependent READ Binding is invalid",
  );
  return binding.query as {
    readonly tableId: string;
    readonly spec: { readonly selectFieldIds?: unknown };
  };
}

export interface CompiledBindingDependency {
  readonly query: Readonly<Record<string, unknown>>;
  readonly mapping: Readonly<Record<string, unknown>>;
}

export class BindingDependencyCompiler {
  compileDefinition(input: {
    readonly projectId: string;
    readonly bindingType: "FILTER" | "NAVIGATE";
    readonly sourceElementId: string;
    readonly targetObjectId: string;
    readonly dependency: ConfigureBindingDependencyRequestDto | undefined;
    readonly variables: readonly ProjectVariableDto[];
    readonly bindings: readonly RelationshipBindingDto[];
    readonly elements: readonly ElementEntryDto[];
    readonly schema: DataSchemaExportDto;
    readonly pages: readonly { readonly id: string }[];
  }): CompiledBindingDependency {
    const dependency = exactObject(
      input.dependency,
      input.bindingType === "FILTER"
        ? [
            "kind",
            "variableId",
            "sourceFieldId",
            "targetReadBindingId",
            "targetFieldId",
            "operator",
          ]
        : ["kind", "variableId", "sourceFieldId", "targetPageId", "transport"],
      "Binding dependency",
    );
    assertApi(
      dependency.kind === input.bindingType,
      400,
      "BINDING_DEPENDENCY_KIND_MISMATCH",
      "Dependency kind must match the Binding type",
    );
    const variableId = uuid(dependency.variableId, "Variable ID");
    const sourceFieldId = uuid(dependency.sourceFieldId, "Source Field ID");
    const variable = input.variables.find(({ id }) => id === variableId);
    assertApi(
      variable !== undefined && variable.projectId === input.projectId,
      404,
      "VARIABLE_NOT_FOUND",
      "Variable was not found",
    );
    const sourceElement = input.elements.find(
      ({ element }) => element.id === input.sourceElementId,
    );
    assertApi(
      sourceElement?.element.type === "data-table",
      400,
      "DEPENDENCY_SOURCE_MUST_BE_DATA_TABLE",
      "Filter and Navigation actions must start from a Data Table",
    );
    const sourceReads = input.bindings.filter(
      (binding) =>
        binding.bindingType === "READ" &&
        binding.status === "READY" &&
        binding.target.objectId === input.sourceElementId,
    );
    assertApi(
      sourceReads.length === 1,
      409,
      "DEPENDENCY_SOURCE_READ_REQUIRED",
      "Data Table must have exactly one active READ Binding",
    );
    const sourceRead = sourceReads[0] as RelationshipBindingDto;
    const sourceQuery = storedRead(sourceRead);
    const sourceTable = input.schema.tables.find(
      ({ id }) => id === sourceQuery.tableId,
    );
    const sourceField = sourceTable?.fields.find(
      ({ id }) => id === sourceFieldId,
    );
    assertApi(
      sourceField !== undefined &&
        Array.isArray(sourceQuery.spec.selectFieldIds) &&
        sourceQuery.spec.selectFieldIds.includes(sourceFieldId),
      400,
      "DEPENDENCY_SOURCE_FIELD_INVALID",
      "Selected source Field is not returned by the Data Table Binding",
    );
    assertApi(
      fieldType(sourceField.type) === variable.valueType,
      400,
      "VARIABLE_FIELD_TYPE_MISMATCH",
      "Variable and source Field types do not match",
    );

    if (input.bindingType === "FILTER") {
      const targetReadBindingId = uuid(
        dependency.targetReadBindingId,
        "Target READ Binding ID",
      );
      const targetFieldId = uuid(dependency.targetFieldId, "Target Field ID");
      assertApi(
        dependency.operator === "EQ",
        400,
        "INVALID_DEPENDENCY_FILTER_OPERATOR",
        "Phase 14 Filter supports equality",
      );
      const targetRead = input.bindings.find(
        ({ id }) => id === targetReadBindingId,
      );
      assertApi(
        targetRead?.bindingType === "READ" &&
          targetRead.status === "READY" &&
          targetRead.target.objectId === input.targetObjectId,
        409,
        "DEPENDENCY_TARGET_READ_INVALID",
        "Target Element must have the selected READ Binding",
      );
      const targetQuery = storedRead(targetRead);
      const targetField = input.schema.tables
        .find(({ id }) => id === targetQuery.tableId)
        ?.fields.find(({ id }) => id === targetFieldId);
      assertApi(
        targetField !== undefined &&
          fieldType(targetField.type) === variable.valueType,
        400,
        "DEPENDENCY_TARGET_FIELD_INVALID",
        "Target filter Field is invalid or has another type",
      );
      return {
        query: {
          schemaVersion: DEPENDENCY_SCHEMA_VERSION,
          kind: "FILTER",
          variableId,
          sourceElementId: input.sourceElementId,
          sourceFieldId,
          sourceReadBindingId: sourceRead.id,
          targetReadBindingId,
          targetFieldId,
          operator: "EQ",
        },
        mapping: {
          targetElementId: input.targetObjectId,
          targetReadBindingId,
          targetFieldId,
        },
      };
    }

    const targetPageId = uuid(dependency.targetPageId, "Target Page ID");
    assertApi(
      targetPageId === input.targetObjectId &&
        input.pages.some(({ id }) => id === targetPageId),
      400,
      "DEPENDENCY_TARGET_PAGE_INVALID",
      "Navigation target Page is invalid",
    );
    assertApi(
      typeof dependency.transport === "string" &&
        PROJECT_VARIABLE_TRANSPORTS.includes(
          dependency.transport as ProjectVariableTransport,
        ) &&
        dependency.transport === variable.transport,
      400,
      "VARIABLE_TRANSPORT_MISMATCH",
      "Navigation transport must match the Variable",
    );
    return {
      query: {
        schemaVersion: DEPENDENCY_SCHEMA_VERSION,
        kind: "NAVIGATE",
        variableId,
        sourceElementId: input.sourceElementId,
        sourceFieldId,
        sourceReadBindingId: sourceRead.id,
        targetPageId,
        transport: dependency.transport,
      },
      mapping: { targetPageId },
    };
  }
}

export function runtimeFilterDependency(
  binding: RelationshipBindingDto,
): RuntimeFilterDependencyDto | null {
  const query = binding.query as Record<string, unknown>;
  if (binding.bindingType !== "FILTER" || query.kind !== "FILTER") return null;
  return {
    bindingId: binding.id,
    kind: "FILTER",
    variableId: String(query.variableId),
    sourceElementId: String(query.sourceElementId),
    sourceFieldId: String(query.sourceFieldId),
    targetElementId: binding.target.objectId,
    targetReadBindingId: String(query.targetReadBindingId),
    targetFieldId: String(query.targetFieldId),
    operator: "EQ",
  };
}

export function runtimeNavigationDependency(
  binding: RelationshipBindingDto,
): RuntimeNavigationDependencyDto | null {
  const query = binding.query as Record<string, unknown>;
  if (binding.bindingType !== "NAVIGATE" || query.kind !== "NAVIGATE")
    return null;
  return {
    bindingId: binding.id,
    kind: "NAVIGATE",
    variableId: String(query.variableId),
    sourceElementId: String(query.sourceElementId),
    sourceFieldId: String(query.sourceFieldId),
    targetPageId: String(query.targetPageId),
    transport: query.transport as ProjectVariableTransport,
  };
}
