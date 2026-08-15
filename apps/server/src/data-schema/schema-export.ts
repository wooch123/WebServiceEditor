import {
  DATA_FIELD_TYPES,
  DATA_RELATION_DELETE_ACTIONS,
  DATA_RELATION_TYPES,
  DATA_SCHEMA_VERSION,
  type DataFieldDto,
  type DataRelationDto,
  type DataSchemaExportDto,
  type DataTableDto,
} from "@webeditor/domain";

import { assertApi } from "../errors.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PHYSICAL_TABLE_PATTERN = /^t_[0-9a-f]{32}$/;
const PHYSICAL_FIELD_PATTERN = /^c_[0-9a-f]{32}$/;
const SHA_PATTERN = /^[0-9a-f]{64}$/;
const fieldTypes = new Set<string>(DATA_FIELD_TYPES);
const relationTypes = new Set<string>(DATA_RELATION_TYPES);
const deleteActions = new Set<string>(DATA_RELATION_DELETE_ACTIONS);

function record(value: unknown, label: string): Record<string, unknown> {
  assertApi(
    typeof value === "object" && value !== null && !Array.isArray(value),
    400,
    "INVALID_DATA_SCHEMA_EXPORT",
    `${label} must be an object`,
  );
  return value as Record<string, unknown>;
}

function string(value: unknown, label: string, maximum = 1000): string {
  assertApi(
    typeof value === "string" &&
      value.trim().length > 0 &&
      value.length <= maximum,
    400,
    "INVALID_DATA_SCHEMA_EXPORT",
    `${label} is invalid`,
  );
  return value;
}

function nullableString(
  value: unknown,
  label: string,
  maximum = 1000,
): string | null {
  if (value === null) return null;
  return string(value, label, maximum);
}

function integer(value: unknown, label: string, minimum = 0): number {
  assertApi(
    Number.isSafeInteger(value) && (value as number) >= minimum,
    400,
    "INVALID_DATA_SCHEMA_EXPORT",
    `${label} is invalid`,
  );
  return value as number;
}

function bool(value: unknown, label: string): boolean {
  assertApi(
    typeof value === "boolean",
    400,
    "INVALID_DATA_SCHEMA_EXPORT",
    `${label} must be boolean`,
  );
  return value;
}

function uuid(value: unknown, label: string): string {
  const parsed = string(value, label, 36);
  assertApi(
    UUID_PATTERN.test(parsed),
    400,
    "INVALID_DATA_SCHEMA_EXPORT",
    `${label} must be a UUID`,
  );
  return parsed;
}

function checksum(value: unknown, label: string): string | null {
  if (value === null) return null;
  const parsed = string(value, label, 64);
  assertApi(
    SHA_PATTERN.test(parsed),
    400,
    "INVALID_DATA_SCHEMA_EXPORT",
    `${label} is invalid`,
  );
  return parsed;
}

function parseField(
  value: unknown,
  projectId: string,
  tableId: string,
): DataFieldDto {
  const field = record(value, "Data field");
  const id = uuid(field.id, "Field ID");
  const physicalName = string(field.physicalName, "Field physical name", 34);
  assertApi(
    PHYSICAL_FIELD_PATTERN.test(physicalName),
    400,
    "INVALID_DATA_SCHEMA_EXPORT",
    "Field physical name is invalid",
  );
  assertApi(
    field.projectId === projectId && field.tableId === tableId,
    400,
    "INVALID_DATA_SCHEMA_EXPORT",
    "Field ownership is invalid",
  );
  assertApi(
    typeof field.type === "string" && fieldTypes.has(field.type),
    400,
    "INVALID_DATA_SCHEMA_EXPORT",
    "Field type is invalid",
  );
  const primaryKey = bool(field.primaryKey, "Primary key");
  const autoIncrement = bool(field.autoIncrement, "Auto increment");
  const nullable = bool(field.nullable, "Nullable");
  assertApi(
    !autoIncrement || (primaryKey && field.type === "INTEGER"),
    400,
    "INVALID_DATA_SCHEMA_EXPORT",
    "Auto increment is invalid",
  );
  assertApi(
    !primaryKey || !nullable,
    400,
    "INVALID_DATA_SCHEMA_EXPORT",
    "Primary key cannot be nullable",
  );
  return {
    id,
    projectId,
    tableId,
    displayName: string(field.displayName, "Field display name", 120),
    physicalName,
    type: field.type as DataFieldDto["type"],
    primaryKey,
    autoIncrement,
    nullable,
    unique: bool(field.unique, "Unique"),
    defaultValue: nullableString(field.defaultValue, "Field default"),
    indexed: bool(field.indexed, "Indexed"),
    unit: nullableString(field.unit, "Field unit", 100),
    description: nullableString(field.description, "Field description"),
    sortOrder: integer(field.sortOrder, "Field sort order"),
    revision: integer(field.revision, "Field revision", 1),
    createdAt: string(field.createdAt, "Field created at", 100),
    updatedAt: string(field.updatedAt, "Field updated at", 100),
  };
}

export function parseDataSchemaExport(
  value: unknown,
  projectId: string,
): DataSchemaExportDto {
  if (value === undefined) {
    return {
      schemaVersion: DATA_SCHEMA_VERSION,
      schemaRevision: 0,
      testAppliedRevision: 0,
      testSchemaChecksum: null,
      productionAppliedRevision: 0,
      productionSchemaChecksum: null,
      tables: [],
      relations: [],
    };
  }
  const schema = record(value, "Data schema");
  assertApi(
    schema.schemaVersion === DATA_SCHEMA_VERSION,
    400,
    "INVALID_DATA_SCHEMA_EXPORT",
    "Data schema version is unsupported",
  );
  assertApi(
    Array.isArray(schema.tables) && Array.isArray(schema.relations),
    400,
    "INVALID_DATA_SCHEMA_EXPORT",
    "Data schema inventories are invalid",
  );
  const ids = new Set<string>();
  const physicalTables = new Set<string>();
  const tables = schema.tables.map((value): DataTableDto => {
    const table = record(value, "Data table");
    const id = uuid(table.id, "Table ID");
    assertApi(
      !ids.has(id),
      400,
      "INVALID_DATA_SCHEMA_EXPORT",
      "Data schema ID is duplicated",
    );
    ids.add(id);
    assertApi(
      table.projectId === projectId,
      400,
      "INVALID_DATA_SCHEMA_EXPORT",
      "Table ownership is invalid",
    );
    const physicalName = string(table.physicalName, "Table physical name", 34);
    assertApi(
      PHYSICAL_TABLE_PATTERN.test(physicalName) &&
        !physicalTables.has(physicalName),
      400,
      "INVALID_DATA_SCHEMA_EXPORT",
      "Table physical name is invalid or duplicated",
    );
    physicalTables.add(physicalName);
    assertApi(
      Array.isArray(table.fields) && table.fields.length > 0,
      400,
      "INVALID_DATA_SCHEMA_EXPORT",
      "Table fields are invalid",
    );
    const fields = table.fields.map((field) =>
      parseField(field, projectId, id),
    );
    const fieldIds = new Set<string>();
    const physicalFields = new Set<string>();
    const sortOrders = new Set<number>();
    for (const field of fields) {
      assertApi(
        !ids.has(field.id) &&
          !fieldIds.has(field.id) &&
          !physicalFields.has(field.physicalName) &&
          !sortOrders.has(field.sortOrder),
        400,
        "INVALID_DATA_SCHEMA_EXPORT",
        "Field identity, name, or order is duplicated",
      );
      ids.add(field.id);
      fieldIds.add(field.id);
      physicalFields.add(field.physicalName);
      sortOrders.add(field.sortOrder);
    }
    return {
      id,
      projectId,
      displayName: string(table.displayName, "Table display name", 120),
      physicalName,
      description: nullableString(table.description, "Table description"),
      revision: integer(table.revision, "Table revision", 1),
      rowCount: integer(table.rowCount, "Table row count"),
      fields,
      createdAt: string(table.createdAt, "Table created at", 100),
      updatedAt: string(table.updatedAt, "Table updated at", 100),
    };
  });
  const tableById = new Map(tables.map((table) => [table.id, table]));
  const fieldById = new Map(
    tables.flatMap((table) =>
      table.fields.map((field) => [field.id, field] as const),
    ),
  );
  const endpoints = new Set<string>();
  const relations = schema.relations.map((value): DataRelationDto => {
    const relation = record(value, "Data relation");
    const id = uuid(relation.id, "Relation ID");
    assertApi(
      !ids.has(id),
      400,
      "INVALID_DATA_SCHEMA_EXPORT",
      "Data schema ID is duplicated",
    );
    ids.add(id);
    assertApi(
      relation.projectId === projectId,
      400,
      "INVALID_DATA_SCHEMA_EXPORT",
      "Relation ownership is invalid",
    );
    const sourceTableId = uuid(relation.sourceTableId, "Source table ID");
    const sourceFieldId = uuid(relation.sourceFieldId, "Source field ID");
    const targetTableId = uuid(relation.targetTableId, "Target table ID");
    const targetFieldId = uuid(relation.targetFieldId, "Target field ID");
    const sourceField = fieldById.get(sourceFieldId);
    const targetField = fieldById.get(targetFieldId);
    assertApi(
      tableById.has(sourceTableId) &&
        tableById.has(targetTableId) &&
        sourceField?.tableId === sourceTableId &&
        targetField?.tableId === targetTableId &&
        sourceField.type === targetField.type,
      400,
      "INVALID_DATA_SCHEMA_EXPORT",
      "Relation endpoints are invalid",
    );
    assertApi(
      targetField.primaryKey || targetField.unique,
      400,
      "INVALID_DATA_SCHEMA_EXPORT",
      "Relation target is not unique",
    );
    assertApi(
      typeof relation.type === "string" && relationTypes.has(relation.type),
      400,
      "INVALID_DATA_SCHEMA_EXPORT",
      "Relation type is invalid",
    );
    assertApi(
      typeof relation.onDelete === "string" &&
        deleteActions.has(relation.onDelete),
      400,
      "INVALID_DATA_SCHEMA_EXPORT",
      "Relation delete action is invalid",
    );
    assertApi(
      relation.onDelete !== "SET_NULL" || sourceField.nullable,
      400,
      "INVALID_DATA_SCHEMA_EXPORT",
      "SET NULL source is not nullable",
    );
    const endpointKey = `${sourceFieldId}:${targetFieldId}`;
    assertApi(
      !endpoints.has(endpointKey),
      400,
      "INVALID_DATA_SCHEMA_EXPORT",
      "Relation endpoints are duplicated",
    );
    endpoints.add(endpointKey);
    return {
      id,
      projectId,
      displayName: string(relation.displayName, "Relation display name", 120),
      type: relation.type as DataRelationDto["type"],
      sourceTableId,
      sourceFieldId,
      targetTableId,
      targetFieldId,
      onDelete: relation.onDelete as DataRelationDto["onDelete"],
      revision: integer(relation.revision, "Relation revision", 1),
      createdAt: string(relation.createdAt, "Relation created at", 100),
      updatedAt: string(relation.updatedAt, "Relation updated at", 100),
    };
  });
  return {
    schemaVersion: DATA_SCHEMA_VERSION,
    schemaRevision: integer(schema.schemaRevision, "Schema revision"),
    testAppliedRevision: integer(
      schema.testAppliedRevision,
      "Test applied revision",
    ),
    testSchemaChecksum: checksum(
      schema.testSchemaChecksum,
      "Test schema checksum",
    ),
    productionAppliedRevision: integer(
      schema.productionAppliedRevision,
      "Production applied revision",
    ),
    productionSchemaChecksum: checksum(
      schema.productionSchemaChecksum,
      "Production schema checksum",
    ),
    tables,
    relations,
  };
}
