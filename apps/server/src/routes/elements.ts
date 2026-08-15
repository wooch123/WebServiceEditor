import type {
  BatchLayoutRequest,
  CreateElementFromPlacementRequest,
  CreateElementRequest,
  CreatePlacementCandidateRequest,
  DeleteElementRequest,
  ElementHistoryMutationRequest,
  PatchElementRequest,
} from "@webeditor/domain";
import type { FastifyInstance } from "fastify";

import type { ElementService } from "../elements/element-service.js";
import { assertApi } from "../errors.js";

export interface ElementRoutesOptions {
  readonly elementService: ElementService;
}

function bodyRecord(body: unknown): Record<string, unknown> {
  assertApi(
    typeof body === "object" && body !== null && !Array.isArray(body),
    400,
    "INVALID_REQUEST_BODY",
    "Request body must be an object",
  );
  return body as Record<string, unknown>;
}

function exactBody(
  body: unknown,
  allowedKeys: readonly string[],
): Record<string, unknown> {
  const record = bodyRecord(body);
  const unknownKeys = Object.keys(record).filter(
    (key) => !allowedKeys.includes(key),
  );
  assertApi(
    unknownKeys.length === 0,
    400,
    "UNKNOWN_REQUEST_FIELD",
    "Request contains unknown fields",
    { fields: unknownKeys },
  );
  return record;
}

function placementBody(body: unknown): CreatePlacementCandidateRequest {
  const record = exactBody(body, [
    "elementType",
    "pointer",
    "canvasWidth",
    "canvasHeight",
    "expectedLayoutRevision",
    "expectedProjectRevision",
  ]);
  const pointer = exactBody(record.pointer, [
    "rawCanvasX",
    "rawCanvasY",
    "correctedCanvasX",
    "correctedCanvasY",
  ]);
  return {
    ...record,
    pointer,
  } as unknown as CreatePlacementCandidateRequest;
}

export async function registerElementRoutes(
  server: FastifyInstance,
  options: ElementRoutesOptions,
): Promise<void> {
  const service = options.elementService;

  server.get("/api/v1/elements/registry", async () => service.registry());

  server.get<{ Params: { elementType: string } }>(
    "/api/v1/elements/registry/:elementType",
    async (request) => service.registryDefinition(request.params.elementType),
  );

  server.get<{ Params: { elementId: string } }>(
    "/api/v1/elements/:elementId",
    async (request) => service.inspect(request.params.elementId),
  );

  server.get<{ Params: { projectId: string } }>(
    "/api/v1/projects/:projectId/element-history",
    async (request) => service.history(request.params.projectId),
  );

  for (const operation of ["undo", "redo"] as const) {
    server.post<{ Params: { projectId: string } }>(
      `/api/v1/projects/:projectId/element-history/${operation}`,
      async (request) => {
        const body = exactBody(request.body, [
          "expectedProjectRevision",
          "expectedCommandId",
          "idempotencyKey",
        ]);
        return service[operation](
          request.params.projectId,
          body as unknown as ElementHistoryMutationRequest,
        );
      },
    );
  }

  server.get<{ Params: { pageId: string } }>(
    "/api/v1/pages/:pageId/elements",
    async (request) => service.list(request.params.pageId),
  );

  server.post<{ Params: { pageId: string } }>(
    "/api/v1/pages/:pageId/placement-candidates",
    async (request) =>
      service.placementCandidate(
        request.params.pageId,
        placementBody(request.body),
      ),
  );

  server.post<{ Params: { pageId: string } }>(
    "/api/v1/pages/:pageId/elements/from-placement",
    async (request, reply) => {
      const body = exactBody(request.body, [
        "candidateId",
        "expectedLayoutRevision",
        "expectedProjectRevision",
        "idempotencyKey",
      ]);
      return reply
        .code(201)
        .send(
          service.createFromPlacement(
            request.params.pageId,
            body as unknown as CreateElementFromPlacementRequest,
          ),
        );
    },
  );

  server.post<{ Params: { pageId: string } }>(
    "/api/v1/pages/:pageId/elements",
    async (request, reply) => {
      const body = exactBody(request.body, [
        "elementType",
        "expectedLayoutRevision",
        "expectedProjectRevision",
        "idempotencyKey",
      ]);
      return reply
        .code(201)
        .send(
          service.create(
            request.params.pageId,
            body as unknown as CreateElementRequest,
          ),
        );
    },
  );

  server.patch<{ Params: { elementId: string } }>(
    "/api/v1/elements/:elementId",
    async (request) => {
      const body = exactBody(request.body, [
        "expectedRevision",
        "expectedLayoutRevision",
        "expectedProjectRevision",
        "idempotencyKey",
        "change",
      ]);
      const change = bodyRecord(body.change);
      const allowedChangeKeys =
        change.kind === "MOVE"
          ? ["kind", "x", "y"]
          : change.kind === "RESIZE"
            ? ["kind", "handle", "x", "y", "w", "h"]
            : change.kind === "LOCK"
              ? ["kind", "locked"]
              : change.kind === "PROPERTIES"
                ? ["kind", "values"]
                : ["kind"];
      exactBody(change, allowedChangeKeys);
      if (change.kind === "PROPERTIES") {
        bodyRecord(change.values);
      }
      return service.patch(
        request.params.elementId,
        body as unknown as PatchElementRequest,
      );
    },
  );

  server.delete<{ Params: { elementId: string } }>(
    "/api/v1/elements/:elementId",
    async (request) => {
      const body = exactBody(request.body, [
        "expectedRevision",
        "expectedLayoutRevision",
        "expectedProjectRevision",
        "idempotencyKey",
      ]);
      return service.delete(
        request.params.elementId,
        body as unknown as DeleteElementRequest,
      );
    },
  );

  server.post("/api/v1/elements/batch-layout", async (request) => {
    const body = exactBody(request.body, [
      "pageId",
      "expectedLayoutRevision",
      "expectedProjectRevision",
      "idempotencyKey",
      "mode",
      "items",
    ]);
    assertApi(
      Array.isArray(body.items),
      400,
      "INVALID_BATCH_LAYOUT",
      "Batch layout items are invalid",
    );
    for (const item of body.items) {
      exactBody(item, ["elementId", "expectedRevision", "x", "y", "w", "h"]);
    }
    return service.batchLayout(body as unknown as BatchLayoutRequest);
  });
}
