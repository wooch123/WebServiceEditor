import type {
  ApplySchemaMigrationRequest,
  CreateDataFieldRequest,
  CreateDataRelationRequest,
  CreateDataTableRequest,
  CreateSchemaMigrationPlanRequest,
  DeleteDataFieldRequest,
  DeleteDataRelationRequest,
  DeleteDataTableRequest,
  PatchDataFieldRequest,
  PatchDataRelationRequest,
  PatchDataTableRequest,
} from "@webeditor/domain";
import type { FastifyInstance } from "fastify";

import type { SchemaService } from "../data-schema/schema-service.js";
import { assertApi } from "../errors.js";

export interface DataSchemaRoutesOptions {
  readonly schemaService: SchemaService;
}

function exactBody(
  body: unknown,
  allowedKeys: readonly string[],
): Record<string, unknown> {
  assertApi(
    typeof body === "object" && body !== null && !Array.isArray(body),
    400,
    "INVALID_REQUEST_BODY",
    "Request body must be an object",
  );
  const record = body as Record<string, unknown>;
  const unknown = Object.keys(record).filter(
    (key) => !allowedKeys.includes(key),
  );
  assertApi(
    unknown.length === 0,
    400,
    "UNKNOWN_REQUEST_FIELD",
    "Request contains unknown fields",
    { fields: unknown },
  );
  return record;
}

const revisionsAndKey = [
  "expectedSchemaRevision",
  "expectedProjectRevision",
  "idempotencyKey",
] as const;

export async function registerDataSchemaRoutes(
  server: FastifyInstance,
  options: DataSchemaRoutesOptions,
): Promise<void> {
  const service = options.schemaService;

  server.get<{ Params: { projectId: string } }>(
    "/api/v1/projects/:projectId/schema",
    async (request) => service.schema(request.params.projectId),
  );

  server.post<{ Params: { projectId: string } }>(
    "/api/v1/projects/:projectId/tables",
    async (request, reply) => {
      const body = exactBody(request.body, [
        "displayName",
        "description",
        "template",
        ...revisionsAndKey,
      ]);
      return reply
        .code(201)
        .send(
          service.createTable(
            request.params.projectId,
            body as unknown as CreateDataTableRequest,
          ),
        );
    },
  );

  server.patch<{ Params: { tableId: string } }>(
    "/api/v1/tables/:tableId",
    async (request) => {
      const body = exactBody(request.body, [
        "displayName",
        "description",
        "expectedRevision",
        ...revisionsAndKey,
      ]);
      return service.patchTable(
        request.params.tableId,
        body as unknown as PatchDataTableRequest,
      );
    },
  );

  server.delete<{ Params: { tableId: string } }>(
    "/api/v1/tables/:tableId",
    async (request) => {
      const body = exactBody(request.body, [
        "expectedRevision",
        ...revisionsAndKey,
      ]);
      return service.deleteTable(
        request.params.tableId,
        body as unknown as DeleteDataTableRequest,
      );
    },
  );

  server.post<{ Params: { tableId: string } }>(
    "/api/v1/tables/:tableId/fields",
    async (request, reply) => {
      const body = exactBody(request.body, [
        "displayName",
        "type",
        "primaryKey",
        "autoIncrement",
        "nullable",
        "unique",
        "defaultValue",
        "indexed",
        "unit",
        "description",
        ...revisionsAndKey,
      ]);
      return reply
        .code(201)
        .send(
          service.createField(
            request.params.tableId,
            body as unknown as CreateDataFieldRequest,
          ),
        );
    },
  );

  server.patch<{ Params: { fieldId: string } }>(
    "/api/v1/fields/:fieldId",
    async (request) => {
      const body = exactBody(request.body, [
        "displayName",
        "type",
        "primaryKey",
        "autoIncrement",
        "nullable",
        "unique",
        "defaultValue",
        "indexed",
        "unit",
        "description",
        "expectedRevision",
        ...revisionsAndKey,
      ]);
      return service.patchField(
        request.params.fieldId,
        body as unknown as PatchDataFieldRequest,
      );
    },
  );

  server.delete<{ Params: { fieldId: string } }>(
    "/api/v1/fields/:fieldId",
    async (request) => {
      const body = exactBody(request.body, [
        "expectedRevision",
        ...revisionsAndKey,
      ]);
      return service.deleteField(
        request.params.fieldId,
        body as unknown as DeleteDataFieldRequest,
      );
    },
  );

  server.post<{ Params: { projectId: string } }>(
    "/api/v1/projects/:projectId/relations",
    async (request, reply) => {
      const body = exactBody(request.body, [
        "displayName",
        "type",
        "sourceTableId",
        "sourceFieldId",
        "targetTableId",
        "targetFieldId",
        "onDelete",
        ...revisionsAndKey,
      ]);
      return reply
        .code(201)
        .send(
          service.createRelation(
            request.params.projectId,
            body as unknown as CreateDataRelationRequest,
          ),
        );
    },
  );

  server.patch<{ Params: { relationId: string } }>(
    "/api/v1/relations/:relationId",
    async (request) => {
      const body = exactBody(request.body, [
        "displayName",
        "type",
        "onDelete",
        "expectedRevision",
        ...revisionsAndKey,
      ]);
      return service.patchRelation(
        request.params.relationId,
        body as unknown as PatchDataRelationRequest,
      );
    },
  );

  server.delete<{ Params: { relationId: string } }>(
    "/api/v1/relations/:relationId",
    async (request) => {
      const body = exactBody(request.body, [
        "expectedRevision",
        ...revisionsAndKey,
      ]);
      return service.deleteRelation(
        request.params.relationId,
        body as unknown as DeleteDataRelationRequest,
      );
    },
  );

  server.post<{ Params: { projectId: string } }>(
    "/api/v1/projects/:projectId/schema/plan",
    async (request) => {
      const body = exactBody(request.body, [
        "expectedSchemaRevision",
        "expectedProjectRevision",
      ]);
      return service.plan(
        request.params.projectId,
        body as unknown as CreateSchemaMigrationPlanRequest,
      );
    },
  );

  server.post<{ Params: { projectId: string } }>(
    "/api/v1/projects/:projectId/schema/apply",
    async (request) => {
      const body = exactBody(request.body, [
        "planId",
        "expectedSchemaRevision",
        "expectedProjectRevision",
        "confirmDestructive",
        "idempotencyKey",
      ]);
      return service.apply(
        request.params.projectId,
        body as unknown as ApplySchemaMigrationRequest,
      );
    },
  );
}
