import {
  RELATIONSHIP_BINDING_STATUSES,
  RELATIONSHIP_BINDING_TYPES,
  RELATIONSHIP_NODE_TYPES,
  type BindingEndpointDto,
  type DataSchemaExportDto,
  type ElementEntryDto,
  type PageDto,
  type RelationshipBindingDto,
  type RelationshipBindingsExportDto,
  type RelationshipBindingStatus,
  type RelationshipBindingType,
  type RelationshipNodeType,
} from "@webeditor/domain";

import { assertApi } from "../errors.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const bindingTypes = new Set<string>(RELATIONSHIP_BINDING_TYPES);
const bindingStatuses = new Set<string>(RELATIONSHIP_BINDING_STATUSES);
const nodeTypes = new Set<string>(RELATIONSHIP_NODE_TYPES);

function record(value: unknown, label: string): Record<string, unknown> {
  assertApi(
    typeof value === "object" && value !== null && !Array.isArray(value),
    400,
    "INVALID_RELATIONSHIP_EXPORT",
    `${label} must be an object`,
  );
  return value as Record<string, unknown>;
}

function string(value: unknown, label: string, max = 500): string {
  assertApi(
    typeof value === "string" && value.length > 0 && value.length <= max,
    400,
    "INVALID_RELATIONSHIP_EXPORT",
    `${label} is invalid`,
  );
  return value;
}

function uuid(value: unknown, label: string): string {
  const parsed = string(value, label, 36);
  assertApi(
    UUID_PATTERN.test(parsed),
    400,
    "INVALID_RELATIONSHIP_EXPORT",
    `${label} is invalid`,
  );
  return parsed;
}

function integer(value: unknown, label: string, minimum = 0): number {
  assertApi(
    Number.isSafeInteger(value) && (value as number) >= minimum,
    400,
    "INVALID_RELATIONSHIP_EXPORT",
    `${label} is invalid`,
  );
  return value as number;
}

function configuration(value: unknown, label: string): Record<string, unknown> {
  const parsed = record(value, label);
  assertApi(
    JSON.stringify(parsed).length <= 64_000,
    400,
    "INVALID_RELATIONSHIP_EXPORT",
    `${label} is too large`,
  );
  return JSON.parse(JSON.stringify(parsed)) as Record<string, unknown>;
}

function endpoint(
  value: unknown,
  direction: "input" | "output",
  label: string,
  validNodeIds: ReadonlySet<string>,
  validObjectsByNode: ReadonlyMap<string, ReadonlySet<string>>,
): BindingEndpointDto {
  const source = record(value, label);
  const nodeType = string(source.nodeType, `${label} node type`) as
    RelationshipNodeType | string;
  assertApi(
    nodeTypes.has(nodeType),
    400,
    "INVALID_RELATIONSHIP_EXPORT",
    `${label} node type is invalid`,
  );
  const nodeId = string(source.nodeId, `${label} node ID`, 200);
  const objectId = uuid(source.objectId, `${label} object ID`);
  const portId = string(source.portId, `${label} port ID`, 240);
  const portRole = string(source.portRole, `${label} port role`, 180);
  assertApi(
    validNodeIds.has(nodeId) && validObjectsByNode.get(nodeId)?.has(objectId),
    400,
    "INVALID_RELATIONSHIP_EXPORT_TOPOLOGY",
    `${label} references an unknown object`,
  );
  assertApi(
    portId.startsWith(`${objectId}:`) &&
      source.direction === direction &&
      source.side === (direction === "input" ? "left" : "right"),
    400,
    "INVALID_RELATIONSHIP_EXPORT_DIRECTION",
    `${label} direction or side is invalid`,
  );
  return {
    nodeType: nodeType as RelationshipNodeType,
    nodeId,
    objectId,
    portId,
    portRole,
    direction,
    side: direction === "input" ? "left" : "right",
    valueType: string(source.valueType, `${label} value type`, 120),
  };
}

export function parseRelationshipBindingsExport(
  value: unknown,
  projectId: string,
  pages: readonly PageDto[],
  elements: readonly ElementEntryDto[],
  dataSchema: DataSchemaExportDto,
): RelationshipBindingsExportDto {
  const exportRecord = record(value, "Relationship export");
  assertApi(
    exportRecord.schemaVersion === 1,
    400,
    "UNSUPPORTED_RELATIONSHIP_EXPORT_VERSION",
    "Relationship export version is not supported",
  );
  const graphRevision = integer(exportRecord.graphRevision, "Graph revision");
  assertApi(
    Array.isArray(exportRecord.bindings) &&
      exportRecord.bindings.length <= 2_000,
    400,
    "INVALID_RELATIONSHIP_EXPORT",
    "Relationship export bindings are invalid",
  );
  const validNodeIds = new Set<string>();
  const validObjectsByNode = new Map<string, Set<string>>();
  for (const page of pages) {
    const nodeId = `page:${page.id}`;
    validNodeIds.add(nodeId);
    validObjectsByNode.set(nodeId, new Set([page.id]));
  }
  for (const entry of elements) {
    const nodeId = `element:${entry.element.id}`;
    validNodeIds.add(nodeId);
    validObjectsByNode.set(nodeId, new Set([entry.element.id]));
  }
  for (const table of dataSchema.tables) {
    const nodeId = `table:${table.id}`;
    validNodeIds.add(nodeId);
    validObjectsByNode.set(
      nodeId,
      new Set([table.id, ...table.fields.map(({ id }) => id)]),
    );
  }
  const seenIds = new Set<string>();
  const seenEndpoints = new Set<string>();
  const bindings = exportRecord.bindings.map(
    (value, index): RelationshipBindingDto => {
      const binding = record(value, `Binding ${index}`);
      const id = uuid(binding.id, `Binding ${index} ID`);
      assertApi(
        !seenIds.has(id),
        400,
        "DUPLICATE_RELATIONSHIP_BINDING_ID",
        "Relationship export contains a duplicate Binding ID",
      );
      seenIds.add(id);
      assertApi(
        binding.projectId === projectId,
        400,
        "INVALID_RELATIONSHIP_EXPORT_OWNERSHIP",
        "Relationship Binding belongs to another Project",
      );
      const bindingType = string(binding.bindingType, `Binding ${index} type`);
      const status = string(binding.status, `Binding ${index} status`);
      assertApi(
        bindingTypes.has(bindingType) && bindingStatuses.has(status),
        400,
        "INVALID_RELATIONSHIP_EXPORT",
        "Relationship Binding type or status is invalid",
      );
      const source = endpoint(
        binding.source,
        "output",
        `Binding ${index} source`,
        validNodeIds,
        validObjectsByNode,
      );
      const target = endpoint(
        binding.target,
        "input",
        `Binding ${index} target`,
        validNodeIds,
        validObjectsByNode,
      );
      const endpointKey = `${source.portId}\0${target.portId}`;
      assertApi(
        !seenEndpoints.has(endpointKey),
        400,
        "DUPLICATE_RELATIONSHIP_BINDING_ENDPOINTS",
        "Relationship export contains duplicate endpoints",
      );
      seenEndpoints.add(endpointKey);
      return {
        id,
        projectId,
        bindingType: bindingType as RelationshipBindingType,
        source,
        target,
        query: configuration(binding.query, `Binding ${index} query`),
        mapping: configuration(binding.mapping, `Binding ${index} mapping`),
        status: status as RelationshipBindingStatus,
        revision: integer(binding.revision, `Binding ${index} revision`, 1),
        createdAt: string(binding.createdAt, `Binding ${index} createdAt`, 80),
        updatedAt: string(binding.updatedAt, `Binding ${index} updatedAt`, 80),
      };
    },
  );
  return { schemaVersion: 1, graphRevision, bindings };
}
