import { createHash } from "node:crypto";
import { join } from "node:path";

import {
  BINDING_QUERY_SCHEMA_VERSION,
  BINDING_RENDER_SHAPES,
  READ_AGGREGATE_FUNCTIONS,
  READ_FILTER_OPERATORS,
  READ_QUERY_MODES,
  READ_SORT_DIRECTIONS,
  type BindingEndpointDto,
  type BindingMappingSpecDto,
  type BindingQueryColumnDto,
  type BindingQueryResultDto,
  type BindingRenderDataDto,
  type BindingRenderShape,
  type BindingScalar,
  type DataFieldDto,
  type DataSchemaExportDto,
  type PreviewBindingQueryRequest,
  type ReadAggregateFunction,
  type ReadFilterDto,
  type ReadQuerySpecDto,
} from "@webeditor/domain";
import Database from "better-sqlite3";

import { assertApi } from "../errors.js";
import type { MetadataDatabase } from "../metadata/database.js";
import type { ProjectStorage } from "../projects/project-storage.js";
import { SchemaRepository } from "../data-schema/schema-repository.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PHYSICAL_TABLE_PATTERN = /^t_[0-9a-f]{32}$/;
const PHYSICAL_FIELD_PATTERN = /^c_[0-9a-f]{32}$/;
const queryModes = new Set<string>(READ_QUERY_MODES);
const filterOperators = new Set<string>(READ_FILTER_OPERATORS);
const sortDirections = new Set<string>(READ_SORT_DIRECTIONS);
const aggregateFunctions = new Set<string>(READ_AGGREGATE_FUNCTIONS);
const renderShapes = new Set<string>(BINDING_RENDER_SHAPES);

export interface StoredReadQueryConfiguration {
  readonly schemaVersion: typeof BINDING_QUERY_SCHEMA_VERSION;
  readonly tableId: string;
  readonly spec: ReadQuerySpecDto;
}

export interface StoredReadMappingConfiguration {
  readonly target: {
    readonly nodeType: string;
    readonly objectId: string;
    readonly portRole: string;
  };
  readonly render: BindingMappingSpecDto;
}

export interface CompiledBindingQuery {
  readonly query: StoredReadQueryConfiguration;
  readonly mapping: StoredReadMappingConfiguration;
  readonly sql: string;
  readonly parameters: readonly BindingScalar[];
  readonly fields: readonly DataFieldDto[];
  readonly resultKeys: readonly string[];
  readonly planChecksum: string;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

function exactObject(
  value: unknown,
  keys: readonly string[],
  label: string,
): Record<string, unknown> {
  assertApi(
    value !== null && typeof value === "object" && !Array.isArray(value),
    400,
    "INVALID_BINDING_QUERY",
    `${label} must be an object`,
  );
  const source = value as Record<string, unknown>;
  const unknown = Object.keys(source).filter((key) => !keys.includes(key));
  assertApi(
    unknown.length === 0,
    400,
    "UNKNOWN_BINDING_QUERY_FIELD",
    `${label} contains unknown fields`,
    { fields: unknown },
  );
  return source;
}

function uuid(value: unknown, label: string): string {
  assertApi(
    typeof value === "string" && UUID_PATTERN.test(value),
    400,
    "INVALID_BINDING_FIELD_ID",
    `${label} is invalid`,
  );
  return value;
}

function identifier(value: string, type: "table" | "field"): string {
  const pattern =
    type === "table" ? PHYSICAL_TABLE_PATTERN : PHYSICAL_FIELD_PATTERN;
  assertApi(
    pattern.test(value),
    500,
    "INVALID_PHYSICAL_IDENTIFIER",
    `Stored ${type} identifier is invalid`,
  );
  return `"${value}"`;
}

function finiteScalar(value: unknown): value is BindingScalar {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

function numericField(field: DataFieldDto | undefined): boolean {
  return field?.type === "INTEGER" || field?.type === "REAL";
}

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0;
  const index = (values.length - 1) * fraction;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const left = values[lower] as number;
  const right = values[upper] as number;
  return left + (right - left) * (index - lower);
}

function aggregate(
  values: readonly number[],
  operation: ReadAggregateFunction,
  rowCount: number,
): number {
  if (operation === "COUNT") return rowCount;
  if (values.length === 0) return 0;
  if (operation === "SUM")
    return values.reduce((total, value) => total + value, 0);
  if (operation === "AVG")
    return values.reduce((total, value) => total + value, 0) / values.length;
  if (operation === "MIN") return Math.min(...values);
  if (operation === "MAX") return Math.max(...values);
  const sorted = [...values].sort((left, right) => left - right);
  if (operation === "MEDIAN") return percentile(sorted, 0.5);
  const mean =
    sorted.reduce((total, value) => total + value, 0) / sorted.length;
  const variance =
    sorted.reduce((total, value) => total + (value - mean) ** 2, 0) /
    sorted.length;
  return operation === "STDDEV" ? Math.sqrt(variance) : variance;
}

function box(label: string, values: readonly number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  const firstQuartile = percentile(sorted, 0.25);
  const thirdQuartile = percentile(sorted, 0.75);
  const range = thirdQuartile - firstQuartile;
  const lowFence = firstQuartile - range * 1.5;
  const highFence = thirdQuartile + range * 1.5;
  const body = sorted.filter(
    (value) => value >= lowFence && value <= highFence,
  );
  return {
    label,
    minimum: body[0] ?? sorted[0] ?? 0,
    firstQuartile,
    median: percentile(sorted, 0.5),
    thirdQuartile,
    maximum: body.at(-1) ?? sorted.at(-1) ?? 0,
    outliers: sorted.filter((value) => value < lowFence || value > highFence),
  };
}

function renderData(
  mapping: BindingMappingSpecDto,
  fields: readonly DataFieldDto[],
  rows: readonly Readonly<Record<string, BindingScalar>>[],
): BindingRenderDataDto {
  const labelId = mapping.labelFieldId;
  const valueId = mapping.valueFieldId;
  const secondaryId = mapping.secondaryFieldId;
  const numberValues = (id: string | null) =>
    id === null
      ? []
      : rows
          .map((row) => row[id])
          .filter(
            (value): value is number =>
              typeof value === "number" && Number.isFinite(value),
          );
  if (mapping.shape === "ROWS") {
    const columns = fields.map((field) => field.displayName);
    return {
      columns,
      rows: rows.map((row) =>
        Object.fromEntries(
          fields.map((field) => [field.displayName, row[field.id] ?? null]),
        ),
      ),
    };
  }
  if (mapping.shape === "SCALAR") {
    return { scalar: valueId === null ? null : (rows[0]?.[valueId] ?? null) };
  }
  if (mapping.shape === "VALUES") return { values: numberValues(valueId) };
  if (mapping.shape === "SERIES") {
    return {
      series: rows.flatMap((row, index) => {
        const value = valueId === null ? undefined : row[valueId];
        if (typeof value !== "number" || !Number.isFinite(value)) return [];
        return [
          {
            label: String(
              labelId === null ? index + 1 : (row[labelId] ?? index + 1),
            ),
            value,
          },
        ];
      }),
    };
  }
  if (mapping.shape === "SCATTER") {
    return {
      scatter: rows.flatMap((row) => {
        const x = labelId === null ? undefined : row[labelId];
        const y = valueId === null ? undefined : row[valueId];
        if (typeof x !== "number" || typeof y !== "number") return [];
        const label = secondaryId === null ? undefined : row[secondaryId];
        return [
          { x, y, ...(label === undefined ? {} : { label: String(label) }) },
        ];
      }),
    };
  }
  if (mapping.shape === "BOXES") {
    const groups = new Map<string, number[]>();
    for (const row of rows) {
      const value = valueId === null ? undefined : row[valueId];
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      const label = String(
        labelId === null ? "전체" : (row[labelId] ?? "전체"),
      );
      const values = groups.get(label) ?? [];
      values.push(value);
      groups.set(label, values);
    }
    return { boxes: [...groups].map(([label, values]) => box(label, values)) };
  }
  const values = numberValues(valueId);
  if (mapping.shape === "SUMMARY") {
    const sorted = [...values].sort((left, right) => left - right);
    const mean = values.length
      ? values.reduce((total, value) => total + value, 0) / values.length
      : 0;
    const variance = values.length
      ? values.reduce((total, value) => total + (value - mean) ** 2, 0) /
        values.length
      : 0;
    return {
      summary: [
        { label: "Count", value: values.length },
        { label: "Mean", value: mean },
        { label: "Median", value: percentile(sorted, 0.5) },
        { label: "Std. Dev.", value: Math.sqrt(variance) },
        { label: "Minimum", value: sorted[0] ?? 0 },
        { label: "Maximum", value: sorted.at(-1) ?? 0 },
      ],
    };
  }
  throw new Error(`Unsupported render shape ${mapping.shape}`);
}

export class BindingQueryCompiler {
  readonly schemaRepository: SchemaRepository;

  constructor(
    readonly metadataDatabase: MetadataDatabase,
    readonly storage: ProjectStorage,
  ) {
    this.schemaRepository = new SchemaRepository(metadataDatabase);
  }

  compile(
    projectId: string,
    source: BindingEndpointDto,
    target: BindingEndpointDto,
    specValue: unknown,
    mappingValue: unknown,
    snapshotSchema?: DataSchemaExportDto,
  ): CompiledBindingQuery {
    const specSource = exactObject(
      specValue,
      [
        "mode",
        "selectFieldIds",
        "filters",
        "orderBy",
        "aggregate",
        "groupByFieldId",
        "limit",
      ],
      "Query spec",
    );
    const mappingSource = exactObject(
      mappingValue,
      ["shape", "labelFieldId", "valueFieldId", "secondaryFieldId"],
      "Mapping",
    );
    assertApi(
      source.nodeType === "table" && target.nodeType === "element",
      400,
      "INVALID_READ_ENDPOINTS",
      "READ must connect a Table output to an Element input",
    );
    const tableId = source.nodeId.slice("table:".length);
    uuid(tableId, "Source Table ID");
    const storedTable = this.schemaRepository.table(tableId);
    const snapshotTable = snapshotSchema?.tables.find(
      (candidate) => candidate.id === tableId,
    );
    const tablePhysicalName =
      snapshotTable?.physicalName ?? storedTable?.physical_name;
    assertApi(
      tablePhysicalName !== undefined &&
        (snapshotTable
          ? snapshotTable.projectId === projectId
          : storedTable?.project_id === projectId &&
            storedTable.deleted_at === null),
      404,
      "BINDING_SOURCE_TABLE_NOT_FOUND",
      "Source Table was not found",
    );
    const fields = snapshotTable
      ? [...snapshotTable.fields]
      : this.schemaRepository
          .fields(projectId)
          .filter((field) => field.table_id === tableId)
          .map((field) => this.schemaRepository.fieldDto(field));
    const fieldById = new Map(
      fields.map((field) => [field.id, field] as const),
    );
    const mode = specSource.mode;
    assertApi(
      typeof mode === "string" && queryModes.has(mode),
      400,
      "INVALID_READ_QUERY_MODE",
      "Query mode is invalid",
    );
    assertApi(
      Array.isArray(specSource.selectFieldIds) &&
        specSource.selectFieldIds.length >= 1 &&
        specSource.selectFieldIds.length <= 32,
      400,
      "INVALID_READ_SELECTION",
      "Select between 1 and 32 Fields",
    );
    const selectFieldIds = specSource.selectFieldIds.map((value) =>
      uuid(value, "Selected Field ID"),
    );
    assertApi(
      new Set(selectFieldIds).size === selectFieldIds.length &&
        selectFieldIds.every((fieldId) => fieldById.has(fieldId)),
      400,
      "INVALID_READ_SELECTION",
      "Selected Fields must be unique members of the source Table",
    );
    assertApi(
      Array.isArray(specSource.filters) && specSource.filters.length <= 10,
      400,
      "INVALID_READ_FILTER",
      "Filters are invalid",
    );
    const filters: ReadFilterDto[] = specSource.filters.map((value) => {
      const filter = exactObject(
        value,
        ["fieldId", "operator", "value"],
        "Filter",
      );
      const fieldId = uuid(filter.fieldId, "Filter Field ID");
      assertApi(
        fieldById.has(fieldId),
        400,
        "INVALID_READ_FILTER",
        "Filter Field is outside the source Table",
      );
      assertApi(
        typeof filter.operator === "string" &&
          filterOperators.has(filter.operator),
        400,
        "INVALID_READ_FILTER",
        "Filter operator is invalid",
      );
      const nullary =
        filter.operator === "IS_NULL" || filter.operator === "IS_NOT_NULL";
      assertApi(
        nullary || finiteScalar(filter.value),
        400,
        "INVALID_READ_FILTER",
        "Filter value is invalid",
      );
      return {
        fieldId,
        operator: filter.operator as ReadFilterDto["operator"],
        ...(nullary ? {} : { value: filter.value as BindingScalar }),
      };
    });
    assertApi(
      Array.isArray(specSource.orderBy) && specSource.orderBy.length <= 3,
      400,
      "INVALID_READ_SORT",
      "Sort is invalid",
    );
    const orderBy = specSource.orderBy.map((value) => {
      const sort = exactObject(value, ["fieldId", "direction"], "Sort");
      const fieldId = uuid(sort.fieldId, "Sort Field ID");
      assertApi(
        fieldById.has(fieldId),
        400,
        "INVALID_READ_SORT",
        "Sort Field is outside the source Table",
      );
      assertApi(
        typeof sort.direction === "string" &&
          sortDirections.has(sort.direction),
        400,
        "INVALID_READ_SORT",
        "Sort direction is invalid",
      );
      return { fieldId, direction: sort.direction as "ASC" | "DESC" };
    });
    const groupByFieldId =
      specSource.groupByFieldId === null
        ? null
        : uuid(specSource.groupByFieldId, "Group Field ID");
    assertApi(
      groupByFieldId === null || fieldById.has(groupByFieldId),
      400,
      "INVALID_READ_AGGREGATE",
      "Group Field is outside the source Table",
    );
    let aggregateSpec: ReadQuerySpecDto["aggregate"] = null;
    if (specSource.aggregate !== null) {
      const input = exactObject(
        specSource.aggregate,
        ["function", "fieldId"],
        "Aggregate",
      );
      assertApi(
        typeof input.function === "string" &&
          aggregateFunctions.has(input.function),
        400,
        "INVALID_READ_AGGREGATE",
        "Aggregate function is invalid",
      );
      const fieldId =
        input.fieldId === null
          ? null
          : uuid(input.fieldId, "Aggregate Field ID");
      assertApi(
        fieldId === null || fieldById.has(fieldId),
        400,
        "INVALID_READ_AGGREGATE",
        "Aggregate Field is outside the source Table",
      );
      assertApi(
        input.function === "COUNT" ||
          (fieldId !== null && numericField(fieldById.get(fieldId))),
        400,
        "INVALID_READ_AGGREGATE",
        "Aggregate requires a numeric Field",
      );
      aggregateSpec = {
        function: input.function as ReadAggregateFunction,
        fieldId,
      };
    }
    assertApi(
      (mode === "AGGREGATE") === (aggregateSpec !== null),
      400,
      "INVALID_READ_AGGREGATE",
      "AGGREGATE mode requires exactly one aggregate",
    );
    assertApi(
      Number.isSafeInteger(specSource.limit) &&
        (specSource.limit as number) >= 1 &&
        (specSource.limit as number) <= 500,
      400,
      "INVALID_READ_LIMIT",
      "Limit must be between 1 and 500",
    );
    const shape = mappingSource.shape;
    assertApi(
      typeof shape === "string" && renderShapes.has(shape),
      400,
      "INVALID_BINDING_MAPPING",
      "Render shape is invalid",
    );
    const mappingField = (value: unknown, label: string) =>
      value === null ? null : uuid(value, label);
    const mapping: BindingMappingSpecDto = {
      shape: shape as BindingRenderShape,
      labelFieldId: mappingField(mappingSource.labelFieldId, "Label Field ID"),
      valueFieldId: mappingField(mappingSource.valueFieldId, "Value Field ID"),
      secondaryFieldId: mappingField(
        mappingSource.secondaryFieldId,
        "Secondary Field ID",
      ),
    };
    for (const fieldId of [
      mapping.labelFieldId,
      mapping.valueFieldId,
      mapping.secondaryFieldId,
    ]) {
      assertApi(
        fieldId === null || fieldById.has(fieldId),
        400,
        "INVALID_BINDING_MAPPING",
        "Mapping Field is outside the source Table",
      );
    }
    const allowedShapeByTarget: Record<string, readonly BindingRenderShape[]> =
      {
        records: ["ROWS"],
        number: ["SCALAR"],
        "chart-series": ["SERIES"],
        numbers: ["VALUES", "SUMMARY"],
        "xy-points": ["SCATTER"],
        "grouped-numbers": ["BOXES"],
      };
    assertApi(
      (allowedShapeByTarget[target.valueType] ?? []).includes(mapping.shape),
      400,
      "INVALID_BINDING_MAPPING",
      "Render shape is incompatible with the target port",
    );
    assertApi(
      mapping.shape === "ROWS" || mapping.valueFieldId !== null,
      400,
      "INVALID_BINDING_MAPPING",
      "This mapping requires a value Field",
    );
    assertApi(
      mapping.valueFieldId === null ||
        numericField(fieldById.get(mapping.valueFieldId)) ||
        mapping.shape === "ROWS",
      400,
      "INVALID_BINDING_MAPPING",
      "Value Field must be numeric",
    );

    const requiredIds = new Set(selectFieldIds);
    for (const filter of filters) requiredIds.add(filter.fieldId);
    for (const sort of orderBy) requiredIds.add(sort.fieldId);
    for (const id of [
      groupByFieldId,
      aggregateSpec?.fieldId,
      mapping.labelFieldId,
      mapping.valueFieldId,
      mapping.secondaryFieldId,
    ])
      if (id) requiredIds.add(id);
    const resultFields = fields.filter((field) => requiredIds.has(field.id));
    const resultKeys = resultFields.map((_, index) => `v${index}`);
    const aliases = resultFields.map(
      (field, index) =>
        `${identifier(field.physicalName, "field")} AS "v${index}"`,
    );
    const parameters: BindingScalar[] = [];
    const where = filters.map((filter) => {
      const field = fieldById.get(filter.fieldId) as DataFieldDto;
      const name = identifier(field.physicalName, "field");
      if (filter.operator === "IS_NULL") return `${name} IS NULL`;
      if (filter.operator === "IS_NOT_NULL") return `${name} IS NOT NULL`;
      parameters.push(filter.value ?? null);
      if (filter.operator === "CONTAINS")
        return `${name} LIKE '%' || ? || '%' ESCAPE '\\'`;
      if (filter.operator === "STARTS_WITH")
        return `${name} LIKE ? || '%' ESCAPE '\\'`;
      const operator = {
        EQ: "=",
        NE: "<>",
        GT: ">",
        GTE: ">=",
        LT: "<",
        LTE: "<=",
      }[filter.operator];
      return `${name} ${operator} ?`;
    });
    const order = orderBy.map(
      (sort) =>
        `${identifier((fieldById.get(sort.fieldId) as DataFieldDto).physicalName, "field")} ${sort.direction}`,
    );
    const limit = mode === "SINGLE" ? 1 : (specSource.limit as number);
    const sql = `SELECT ${aliases.join(", ")} FROM ${identifier(tablePhysicalName, "table")}${where.length ? ` WHERE ${where.join(" AND ")}` : ""}${order.length ? ` ORDER BY ${order.join(", ")}` : ""} LIMIT ${limit + 1}`;
    const spec: ReadQuerySpecDto = {
      mode: mode as ReadQuerySpecDto["mode"],
      selectFieldIds,
      filters,
      orderBy,
      aggregate: aggregateSpec,
      groupByFieldId,
      limit,
    };
    const query: StoredReadQueryConfiguration = {
      schemaVersion: BINDING_QUERY_SCHEMA_VERSION,
      tableId,
      spec,
    };
    const storedMapping: StoredReadMappingConfiguration = {
      target: {
        nodeType: target.nodeType,
        objectId: target.objectId,
        portRole: target.portRole,
      },
      render: mapping,
    };
    return {
      query,
      mapping: storedMapping,
      sql,
      parameters,
      fields: resultFields,
      resultKeys,
      planChecksum: createHash("sha256")
        .update(stableJson({ query, mapping: storedMapping }))
        .digest("hex"),
    };
  }

  execute(
    projectId: string,
    environment: "test" | "production",
    compiled: CompiledBindingQuery,
    expectedAppliedRevision?: number,
  ): BindingQueryResultDto {
    const state = this.schemaRepository.state(projectId);
    assertApi(
      state !== undefined,
      409,
      "SCHEMA_STATE_MISSING",
      "Project schema state is missing",
    );
    const appliedRevision =
      environment === "test"
        ? state.test_applied_revision
        : state.production_applied_revision;
    assertApi(
      appliedRevision > 0 &&
        (expectedAppliedRevision === undefined
          ? appliedRevision === state.draft_revision
          : appliedRevision === expectedAppliedRevision),
      409,
      "RUNTIME_SCHEMA_NOT_APPLIED",
      `${environment} schema is not applied`,
    );
    const database = new Database(
      join(this.storage.activePath(projectId), `${environment}.sqlite`),
      { readonly: true, fileMustExist: true },
    );
    try {
      database.pragma("query_only = ON");
      database.pragma("trusted_schema = OFF");
      const raw = database
        .prepare(compiled.sql)
        .all(...compiled.parameters) as readonly Record<string, unknown>[];
      const truncated = raw.length > compiled.query.spec.limit;
      const limited = raw.slice(0, compiled.query.spec.limit);
      let rows = limited.map(
        (row) =>
          Object.fromEntries(
            compiled.fields.map((field, index) => {
              const value = row[compiled.resultKeys[index] as string];
              assertApi(
                finiteScalar(value),
                500,
                "UNSAFE_QUERY_RESULT",
                "Query returned an unsupported value",
              );
              return [field.id, value];
            }),
          ) as Readonly<Record<string, BindingScalar>>,
      );
      const aggregateSpec = compiled.query.spec.aggregate;
      if (aggregateSpec !== null) {
        const groups = new Map<
          string,
          readonly Readonly<Record<string, BindingScalar>>[]
        >();
        if (compiled.query.spec.groupByFieldId === null)
          groups.set("전체", rows);
        else {
          for (const row of rows) {
            const label = String(
              row[compiled.query.spec.groupByFieldId] ?? "NULL",
            );
            groups.set(label, [...(groups.get(label) ?? []), row]);
          }
        }
        rows = [...groups].map(([label, groupRows]) => {
          const values =
            aggregateSpec.fieldId === null
              ? []
              : groupRows
                  .map((row) => row[aggregateSpec.fieldId as string])
                  .filter(
                    (value): value is number =>
                      typeof value === "number" && Number.isFinite(value),
                  );
          return {
            ...(compiled.query.spec.groupByFieldId === null
              ? {}
              : { [compiled.query.spec.groupByFieldId]: label }),
            [aggregateSpec.fieldId ??
            compiled.mapping.render.valueFieldId ??
            "count"]: aggregate(
              values,
              aggregateSpec.function,
              groupRows.length,
            ),
          };
        });
      }
      const columns: BindingQueryColumnDto[] = compiled.fields.map((field) => ({
        fieldId: field.id,
        label: field.displayName,
        valueType: field.type,
      }));
      const data = renderData(compiled.mapping.render, compiled.fields, rows);
      return {
        columns,
        rows,
        rowCount: rows.length,
        truncated,
        renderState: rows.length === 0 ? "EMPTY" : "DATA",
        renderData: data,
      };
    } finally {
      database.close();
    }
  }

  compileRequest(
    projectId: string,
    source: BindingEndpointDto,
    target: BindingEndpointDto,
    request: PreviewBindingQueryRequest,
  ): CompiledBindingQuery {
    return this.compile(
      projectId,
      source,
      target,
      request.spec,
      request.mapping,
    );
  }

  compileStored(
    projectId: string,
    source: BindingEndpointDto,
    target: BindingEndpointDto,
    queryValue: unknown,
    mappingValue: unknown,
    snapshotSchema?: DataSchemaExportDto,
  ): CompiledBindingQuery {
    const query = exactObject(
      queryValue,
      ["schemaVersion", "tableId", "spec"],
      "Stored query",
    );
    assertApi(
      query.schemaVersion === BINDING_QUERY_SCHEMA_VERSION,
      409,
      "BINDING_QUERY_VERSION_UNSUPPORTED",
      "Binding query version is unsupported",
    );
    const mapping = exactObject(
      mappingValue,
      ["target", "render"],
      "Stored mapping",
    );
    const tableId = uuid(query.tableId, "Stored source Table ID");
    assertApi(
      source.nodeId === `table:${tableId}`,
      409,
      "BINDING_QUERY_SOURCE_MISMATCH",
      "Stored query source does not match the Binding endpoint",
    );
    const targetSnapshot = exactObject(
      mapping.target,
      ["nodeType", "objectId", "portRole"],
      "Stored mapping target",
    );
    assertApi(
      targetSnapshot.nodeType === target.nodeType &&
        targetSnapshot.objectId === target.objectId &&
        targetSnapshot.portRole === target.portRole,
      409,
      "BINDING_MAPPING_TARGET_MISMATCH",
      "Stored mapping target does not match the Binding endpoint",
    );
    return this.compile(
      projectId,
      source,
      target,
      query.spec,
      mapping.render,
      snapshotSchema,
    );
  }
}
