export const DATA_SCHEMA_VERSION = 1 as const;
export const DATA_FIELD_TYPES = [
  "INTEGER",
  "REAL",
  "TEXT",
  "BOOLEAN",
  "DATE",
  "DATETIME",
  "JSON",
  "BLOB",
] as const;
export const DATA_RELATION_TYPES = [
  "ONE_TO_ONE",
  "ONE_TO_MANY",
  "MANY_TO_ONE",
] as const;
export const DATA_RELATION_DELETE_ACTIONS = [
  "RESTRICT",
  "CASCADE",
  "SET_NULL",
] as const;
export const DATA_TABLE_TEMPLATES = ["BLANK", "ENTITY", "TIME_SERIES"] as const;
export const SCHEMA_PLAN_STATUSES = [
  "READY",
  "APPLYING",
  "APPLIED",
  "FAILED",
  "EXPIRED",
] as const;

export type DataFieldType = (typeof DATA_FIELD_TYPES)[number];
export type DataRelationType = (typeof DATA_RELATION_TYPES)[number];
export type DataRelationDeleteAction =
  (typeof DATA_RELATION_DELETE_ACTIONS)[number];
export type DataTableTemplate = (typeof DATA_TABLE_TEMPLATES)[number];
export type SchemaPlanStatus = (typeof SCHEMA_PLAN_STATUSES)[number];

export interface DataFieldDto {
  readonly id: string;
  readonly projectId: string;
  readonly tableId: string;
  readonly displayName: string;
  readonly physicalName: string;
  readonly type: DataFieldType;
  readonly primaryKey: boolean;
  readonly autoIncrement: boolean;
  readonly nullable: boolean;
  readonly unique: boolean;
  readonly defaultValue: string | null;
  readonly indexed: boolean;
  readonly unit: string | null;
  readonly description: string | null;
  readonly sortOrder: number;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface DataTableDto {
  readonly id: string;
  readonly projectId: string;
  readonly displayName: string;
  readonly physicalName: string;
  readonly description: string | null;
  readonly revision: number;
  readonly rowCount: number;
  readonly fields: readonly DataFieldDto[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface DataRelationDto {
  readonly id: string;
  readonly projectId: string;
  readonly displayName: string;
  readonly type: DataRelationType;
  readonly sourceTableId: string;
  readonly sourceFieldId: string;
  readonly targetTableId: string;
  readonly targetFieldId: string;
  readonly onDelete: DataRelationDeleteAction;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface RuntimeSchemaStatusDto {
  readonly environment: "test" | "production";
  readonly appliedRevision: number;
  readonly schemaChecksum: string | null;
  readonly drift: boolean;
  readonly integrity: "ok";
}

export interface DataSchemaDto {
  readonly schemaVersion: typeof DATA_SCHEMA_VERSION;
  readonly projectId: string;
  readonly schemaRevision: number;
  readonly projectRevision: number;
  readonly tables: readonly DataTableDto[];
  readonly relations: readonly DataRelationDto[];
  readonly runtime: {
    readonly test: RuntimeSchemaStatusDto;
    readonly production: RuntimeSchemaStatusDto;
  };
}

export interface DataSchemaExportDto {
  readonly schemaVersion: typeof DATA_SCHEMA_VERSION;
  readonly schemaRevision: number;
  readonly testAppliedRevision: number;
  readonly testSchemaChecksum: string | null;
  readonly productionAppliedRevision: number;
  readonly productionSchemaChecksum: string | null;
  readonly tables: readonly DataTableDto[];
  readonly relations: readonly DataRelationDto[];
}

export interface CreateDataTableRequest {
  readonly displayName: string;
  readonly description?: string | null;
  readonly template: DataTableTemplate;
  readonly expectedSchemaRevision: number;
  readonly expectedProjectRevision: number;
  readonly idempotencyKey: string;
}

export interface PatchDataTableRequest {
  readonly displayName?: string;
  readonly description?: string | null;
  readonly expectedRevision: number;
  readonly expectedSchemaRevision: number;
  readonly expectedProjectRevision: number;
  readonly idempotencyKey: string;
}

export interface DeleteDataTableRequest {
  readonly expectedRevision: number;
  readonly expectedSchemaRevision: number;
  readonly expectedProjectRevision: number;
  readonly idempotencyKey: string;
}

export interface CreateDataFieldRequest {
  readonly displayName: string;
  readonly type: DataFieldType;
  readonly primaryKey?: boolean;
  readonly autoIncrement?: boolean;
  readonly nullable?: boolean;
  readonly unique?: boolean;
  readonly defaultValue?: string | null;
  readonly indexed?: boolean;
  readonly unit?: string | null;
  readonly description?: string | null;
  readonly expectedSchemaRevision: number;
  readonly expectedProjectRevision: number;
  readonly idempotencyKey: string;
}

export interface PatchDataFieldRequest {
  readonly displayName?: string;
  readonly type?: DataFieldType;
  readonly primaryKey?: boolean;
  readonly autoIncrement?: boolean;
  readonly nullable?: boolean;
  readonly unique?: boolean;
  readonly defaultValue?: string | null;
  readonly indexed?: boolean;
  readonly unit?: string | null;
  readonly description?: string | null;
  readonly expectedRevision: number;
  readonly expectedSchemaRevision: number;
  readonly expectedProjectRevision: number;
  readonly idempotencyKey: string;
}

export type DeleteDataFieldRequest = DeleteDataTableRequest;

export interface CreateDataRelationRequest {
  readonly displayName: string;
  readonly type: DataRelationType;
  readonly sourceTableId: string;
  readonly sourceFieldId: string;
  readonly targetTableId: string;
  readonly targetFieldId: string;
  readonly onDelete: DataRelationDeleteAction;
  readonly expectedSchemaRevision: number;
  readonly expectedProjectRevision: number;
  readonly idempotencyKey: string;
}

export interface PatchDataRelationRequest {
  readonly displayName?: string;
  readonly type?: DataRelationType;
  readonly onDelete?: DataRelationDeleteAction;
  readonly expectedRevision: number;
  readonly expectedSchemaRevision: number;
  readonly expectedProjectRevision: number;
  readonly idempotencyKey: string;
}

export type DeleteDataRelationRequest = DeleteDataTableRequest;

export type DataSchemaMutationDto = DataSchemaDto;

export interface SchemaMigrationStepDto {
  readonly order: number;
  readonly kind:
    | "CREATE_TABLE"
    | "REBUILD_TABLE"
    | "DROP_TABLE"
    | "CREATE_INDEX"
    | "CREATE_RELATION";
  readonly tableId: string | null;
  readonly label: string;
  readonly destructive: boolean;
  readonly affectedRows: number;
}

export interface SchemaImpactDto {
  readonly destructive: boolean;
  readonly droppedTableCount: number;
  readonly droppedFieldCount: number;
  readonly affectedRowCount: number;
  readonly relationCount: number;
}

export interface CreateSchemaMigrationPlanRequest {
  readonly expectedSchemaRevision: number;
  readonly expectedProjectRevision: number;
}

export interface SchemaMigrationPlanDto {
  readonly id: string;
  readonly projectId: string;
  readonly target: "test";
  readonly schemaRevision: number;
  readonly projectRevision: number;
  readonly schemaChecksum: string;
  readonly status: SchemaPlanStatus;
  readonly impact: SchemaImpactDto;
  readonly steps: readonly SchemaMigrationStepDto[];
  readonly createdAt: string;
  readonly expiresAt: string;
}

export interface ApplySchemaMigrationRequest {
  readonly planId: string;
  readonly expectedSchemaRevision: number;
  readonly expectedProjectRevision: number;
  readonly confirmDestructive: boolean;
  readonly idempotencyKey: string;
}

export interface ApplySchemaMigrationDto {
  readonly plan: SchemaMigrationPlanDto;
  readonly schema: DataSchemaDto;
  readonly backupId: string;
  readonly backupChecksum: string;
  readonly databaseChecksum: string;
  readonly rowCountBefore: number;
  readonly rowCountAfter: number;
  readonly integrity: "ok";
}
