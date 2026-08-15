import type {
  ApplyRelationshipAutoLayoutRequest,
  CreateRelationshipBindingRequest,
  DeleteRelationshipBindingRequest,
  PatchRelationshipBindingRequest,
  PreviewRelationshipAutoLayoutRequest,
  PreviewRelationshipConnectionRequest,
  RelationshipHistoryMutationRequest,
  RelationshipLayoutHistoryMutationRequest,
  RelationshipRoutePreviewRequest,
  UpdateRelationshipNodePositionRequest,
  UpdateRelationshipViewportRequest,
} from "@webeditor/domain";
import type { FastifyInstance } from "fastify";

import type { RelationshipService } from "../data-relationship/relationship-service.js";
import { assertApi } from "../errors.js";

export interface DataRelationshipRoutesOptions {
  readonly relationshipService: RelationshipService;
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

const graphRevisions = [
  "expectedGraphRevision",
  "expectedProjectRevision",
] as const;

export async function registerDataRelationshipRoutes(
  server: FastifyInstance,
  options: DataRelationshipRoutesOptions,
): Promise<void> {
  const service = options.relationshipService;

  server.get<{ Params: { projectId: string } }>(
    "/api/v1/projects/:projectId/relationship-graph",
    async (request) => service.graph(request.params.projectId),
  );

  server.patch<{ Params: { projectId: string; nodeId: string } }>(
    "/api/v1/projects/:projectId/relationship-nodes/:nodeId",
    async (request) => {
      const body = exactBody(request.body, [
        "x",
        "y",
        "pinned",
        "expectedPositionRevision",
        ...graphRevisions,
        "idempotencyKey",
      ]);
      return service.updateNodePosition(
        request.params.projectId,
        request.params.nodeId,
        body as unknown as UpdateRelationshipNodePositionRequest,
      );
    },
  );

  server.patch<{ Params: { projectId: string } }>(
    "/api/v1/projects/:projectId/relationship-viewport",
    async (request) => {
      const body = exactBody(request.body, [
        "x",
        "y",
        "zoom",
        "expectedRevision",
      ]);
      return service.updateViewport(
        request.params.projectId,
        body as unknown as UpdateRelationshipViewportRequest,
      );
    },
  );

  server.post<{ Params: { projectId: string } }>(
    "/api/v1/projects/:projectId/edges/route-preview",
    async (request) => {
      const body = exactBody(request.body, ["positions", ...graphRevisions]);
      return service.routePreview(
        request.params.projectId,
        body as unknown as RelationshipRoutePreviewRequest,
      );
    },
  );

  server.post<{ Params: { projectId: string } }>(
    "/api/v1/projects/:projectId/auto-layout",
    async (request) => {
      const source = exactBody(request.body, [
        "action",
        "previewId",
        ...graphRevisions,
        "idempotencyKey",
      ]);
      if (source.action === "PREVIEW") {
        exactBody(request.body, ["action", ...graphRevisions]);
        return service.previewAutoLayout(
          request.params.projectId,
          source as unknown as PreviewRelationshipAutoLayoutRequest,
        );
      }
      return service.applyAutoLayout(
        request.params.projectId,
        source as unknown as ApplyRelationshipAutoLayoutRequest,
      );
    },
  );

  server.get<{ Params: { projectId: string } }>(
    "/api/v1/projects/:projectId/relationship-layout-history",
    async (request) => service.layoutHistory(request.params.projectId),
  );

  for (const operation of ["undo", "redo"] as const) {
    server.post<{ Params: { projectId: string } }>(
      `/api/v1/projects/:projectId/relationship-layout-history/${operation}`,
      async (request) => {
        const body = exactBody(request.body, [
          "expectedCommandId",
          ...graphRevisions,
          "idempotencyKey",
        ]);
        return service.layoutHistoryMutation(
          request.params.projectId,
          operation === "undo" ? "UNDO" : "REDO",
          body as unknown as RelationshipLayoutHistoryMutationRequest,
        );
      },
    );
  }

  server.get<{ Params: { projectId: string } }>(
    "/api/v1/projects/:projectId/bindings",
    async (request) => service.bindings(request.params.projectId),
  );

  server.post<{ Params: { projectId: string } }>(
    "/api/v1/projects/:projectId/connections/preview",
    async (request) => {
      const body = exactBody(request.body, [
        "sourcePortId",
        "targetPortId",
        ...graphRevisions,
      ]);
      return service.preview(
        request.params.projectId,
        body as unknown as PreviewRelationshipConnectionRequest,
      );
    },
  );

  server.post<{ Params: { projectId: string } }>(
    "/api/v1/projects/:projectId/bindings",
    async (request, reply) => {
      const body = exactBody(request.body, [
        "previewId",
        "bindingType",
        ...graphRevisions,
        "idempotencyKey",
      ]);
      return reply
        .code(201)
        .send(
          service.create(
            request.params.projectId,
            body as unknown as CreateRelationshipBindingRequest,
          ),
        );
    },
  );

  server.patch<{ Params: { bindingId: string } }>(
    "/api/v1/bindings/:bindingId",
    async (request) => {
      const body = exactBody(request.body, [
        "expectedRevision",
        ...graphRevisions,
        "idempotencyKey",
        "query",
        "mapping",
        "status",
      ]);
      return service.patch(
        request.params.bindingId,
        body as unknown as PatchRelationshipBindingRequest,
      );
    },
  );

  server.delete<{ Params: { bindingId: string } }>(
    "/api/v1/bindings/:bindingId",
    async (request) => {
      const body = exactBody(request.body, [
        "expectedRevision",
        ...graphRevisions,
        "idempotencyKey",
      ]);
      return service.delete(
        request.params.bindingId,
        body as unknown as DeleteRelationshipBindingRequest,
      );
    },
  );

  server.get<{ Params: { projectId: string } }>(
    "/api/v1/projects/:projectId/binding-history",
    async (request) => service.history(request.params.projectId),
  );

  for (const operation of ["undo", "redo"] as const) {
    server.post<{ Params: { projectId: string } }>(
      `/api/v1/projects/:projectId/binding-history/${operation}`,
      async (request) => {
        const body = exactBody(request.body, [
          "expectedCommandId",
          ...graphRevisions,
          "idempotencyKey",
        ]);
        return service.historyMutation(
          request.params.projectId,
          operation === "undo" ? "UNDO" : "REDO",
          body as unknown as RelationshipHistoryMutationRequest,
        );
      },
    );
  }
}
