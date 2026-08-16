export const BINDING_QUERY_SCHEMA_VERSION = 1 as const;

export const BINDING_TYPES = [
  "read",
  "read-one",
  "list",
  "create",
  "update",
  "delete",
  "filter",
  "sort",
  "aggregate",
  "parameter",
  "navigation",
] as const;

export const READ_QUERY_MODES = [
  "LIST",
  "SINGLE",
  "AGGREGATE",
  "CHART_SERIES",
] as const;
export const READ_FILTER_OPERATORS = [
  "EQ",
  "NE",
  "GT",
  "GTE",
  "LT",
  "LTE",
  "CONTAINS",
  "STARTS_WITH",
  "IS_NULL",
  "IS_NOT_NULL",
] as const;
export const READ_SORT_DIRECTIONS = ["ASC", "DESC"] as const;
export const READ_AGGREGATE_FUNCTIONS = [
  "COUNT",
  "SUM",
  "AVG",
  "MIN",
  "MAX",
  "MEDIAN",
  "STDDEV",
  "VARIANCE",
] as const;
export const BINDING_RENDER_SHAPES = [
  "ROWS",
  "SCALAR",
  "SERIES",
  "VALUES",
  "SCATTER",
  "BOXES",
  "SUMMARY",
] as const;

export type BindingType = (typeof BINDING_TYPES)[number];
export type ReadQueryMode = (typeof READ_QUERY_MODES)[number];
export type ReadFilterOperator = (typeof READ_FILTER_OPERATORS)[number];
export type ReadSortDirection = (typeof READ_SORT_DIRECTIONS)[number];
export type ReadAggregateFunction = (typeof READ_AGGREGATE_FUNCTIONS)[number];
export type BindingRenderShape = (typeof BINDING_RENDER_SHAPES)[number];
export type BindingScalar = string | number | boolean | null;

export const BINDING_MUTATION_SCHEMA_VERSION = 1 as const;
export const BINDING_MUTATION_OPERATIONS = [
  "CREATE",
  "UPDATE",
  "DELETE",
] as const;

export type BindingMutationOperation =
  (typeof BINDING_MUTATION_OPERATIONS)[number];

export interface BindingMutationFieldMappingDto {
  readonly fieldId: string;
  readonly inputElementId: string;
}

/** Wizard input. The operation and Table come from the canonical Binding. */
export interface ConfigureBindingMutationRequestDto {
  readonly fieldMappings: readonly BindingMutationFieldMappingDto[];
}

export interface StoredBindingMutationQueryDto {
  readonly schemaVersion: typeof BINDING_MUTATION_SCHEMA_VERSION;
  readonly operation: BindingMutationOperation;
  readonly tableId: string;
  readonly primaryKeyFieldId: string;
}

export interface StoredBindingMutationMappingDto {
  readonly fields: readonly BindingMutationFieldMappingDto[];
}

export interface RuntimeBindingMutationRequestDto {
  readonly values: Readonly<Record<string, BindingScalar>>;
  readonly idempotencyKey: string;
}

export interface RuntimeBindingMutationFieldErrorDto {
  readonly fieldId: string;
  readonly inputElementId: string;
  readonly code: string;
  readonly message: string;
}

export interface RuntimeBindingMutationDto {
  readonly bindingId: string;
  readonly projectId: string;
  readonly operation: BindingMutationOperation;
  readonly environment: "test" | "production";
  readonly affectedRows: number;
  readonly insertedPrimaryKey: BindingScalar;
  readonly refreshBindingIds: readonly string[];
  readonly snapshotId: string;
  readonly definitionChecksum: string;
  readonly commandId: string;
}

export interface ReadFilterDto {
  readonly fieldId: string;
  readonly operator: ReadFilterOperator;
  readonly value?: BindingScalar;
}

export interface ReadSortDto {
  readonly fieldId: string;
  readonly direction: ReadSortDirection;
}

export interface ReadAggregateDto {
  readonly function: ReadAggregateFunction;
  readonly fieldId: string | null;
}

export interface ReadQuerySpecDto {
  readonly mode: ReadQueryMode;
  readonly selectFieldIds: readonly string[];
  readonly filters: readonly ReadFilterDto[];
  readonly orderBy: readonly ReadSortDto[];
  readonly aggregate: ReadAggregateDto | null;
  readonly groupByFieldId: string | null;
  readonly limit: number;
}

export interface BindingMappingSpecDto {
  readonly shape: BindingRenderShape;
  readonly labelFieldId: string | null;
  readonly valueFieldId: string | null;
  readonly secondaryFieldId: string | null;
}

export interface BindingQueryColumnDto {
  readonly fieldId: string;
  readonly label: string;
  readonly valueType: string;
}

export interface BindingSeriesPointDto {
  readonly label: string;
  readonly value: number;
}

export interface BindingScatterPointDto {
  readonly x: number;
  readonly y: number;
  readonly label?: string;
}

export interface BindingBoxPointDto {
  readonly label: string;
  readonly minimum: number;
  readonly firstQuartile: number;
  readonly median: number;
  readonly thirdQuartile: number;
  readonly maximum: number;
  readonly outliers: readonly number[];
}

export interface BindingSummaryPointDto {
  readonly label: string;
  readonly value: number;
}

export interface BindingRenderDataDto {
  readonly columns?: readonly string[];
  readonly rows?: readonly Readonly<Record<string, BindingScalar>>[];
  readonly scalar?: BindingScalar;
  readonly series?: readonly BindingSeriesPointDto[];
  readonly values?: readonly number[];
  readonly scatter?: readonly BindingScatterPointDto[];
  readonly boxes?: readonly BindingBoxPointDto[];
  readonly summary?: readonly BindingSummaryPointDto[];
}

export interface BindingQueryResultDto {
  readonly columns: readonly BindingQueryColumnDto[];
  readonly rows: readonly Readonly<Record<string, BindingScalar>>[];
  readonly rowCount: number;
  readonly truncated: boolean;
  readonly renderState: "EMPTY" | "DATA";
  readonly renderData: BindingRenderDataDto;
}

export interface PreviewBindingQueryRequest {
  readonly connectionPreviewId: string;
  readonly spec: ReadQuerySpecDto;
  readonly mapping: BindingMappingSpecDto;
  readonly expectedGraphRevision: number;
  readonly expectedProjectRevision: number;
}

export interface BindingQueryPreviewDto {
  readonly queryPreviewId: string;
  readonly connectionPreviewId: string;
  readonly projectId: string;
  readonly sourceTableId: string;
  readonly targetElementId: string;
  readonly spec: ReadQuerySpecDto;
  readonly mapping: BindingMappingSpecDto;
  readonly result: BindingQueryResultDto;
  readonly planChecksum: string;
  readonly graphRevision: number;
  readonly projectRevision: number;
  readonly expiresAt: string;
}

export interface ExecuteBindingQueryRequest {
  readonly parameters?: Readonly<Record<string, BindingScalar>>;
}

export interface BindingExecutionDto {
  readonly bindingId: string;
  readonly projectId: string;
  readonly targetElementId: string;
  readonly environment: "test" | "production";
  readonly planChecksum: string;
  readonly result: BindingQueryResultDto;
}

export interface GenerateSampleDataRequest {
  readonly rowCount: number;
  readonly reset: boolean;
  readonly idempotencyKey: string;
}

export interface ResetSampleDataRequest {
  readonly idempotencyKey: string;
}

export interface SampleDataMutationDto {
  readonly projectId: string;
  readonly tableCount: number;
  readonly rowCount: number;
  readonly databaseChecksum: string;
}
