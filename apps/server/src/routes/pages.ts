import type {
  CreatePageRequest,
  DeletePageRequest,
  PatchPageIconRequest,
  PatchPageRequest,
  ReorderPagesRequest,
  UndoPageCommandRequest,
} from "@webeditor/domain";
import type { FastifyInstance } from "fastify";

import { assertApi } from "../errors.js";
import type { PageService } from "../pages/page-service.js";

export interface PageRoutesOptions {
  readonly pageService: PageService;
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

export async function registerPageRoutes(
  server: FastifyInstance,
  options: PageRoutesOptions,
): Promise<void> {
  const service = options.pageService;

  server.get<{ Params: { projectId: string } }>(
    "/api/v1/projects/:projectId/pages",
    async (request) => service.list(request.params.projectId),
  );

  server.post<{ Params: { projectId: string } }>(
    "/api/v1/projects/:projectId/pages",
    async (request, reply) => {
      const body = exactBody(request.body, [
        "name",
        "pageType",
        "expectedProjectRevision",
        "idempotencyKey",
      ]);
      const response = service.create(
        request.params.projectId,
        body as unknown as CreatePageRequest,
      );
      return reply.code(201).send(response);
    },
  );

  server.patch<{ Params: { pageId: string } }>(
    "/api/v1/pages/:pageId",
    async (request) => {
      const body = exactBody(request.body, [
        "expectedRevision",
        "expectedProjectRevision",
        "name",
        "route",
        "navigationVisible",
        "navigationGroup",
      ]);
      return service.patch(
        request.params.pageId,
        body as unknown as PatchPageRequest,
      );
    },
  );

  server.patch<{ Params: { pageId: string } }>(
    "/api/v1/pages/:pageId/icon",
    async (request) => {
      const body = exactBody(request.body, [
        "iconName",
        "iconCatalogVersion",
        "expectedRevision",
        "expectedProjectRevision",
      ]);
      return service.patchIcon(
        request.params.pageId,
        body as unknown as PatchPageIconRequest,
      );
    },
  );

  server.post<{ Params: { projectId: string } }>(
    "/api/v1/projects/:projectId/pages/reorder",
    async (request) => {
      const body = exactBody(request.body, [
        "pageIds",
        "expectedProjectRevision",
        "idempotencyKey",
      ]);
      return service.reorder(
        request.params.projectId,
        body as unknown as ReorderPagesRequest,
      );
    },
  );

  server.post<{ Params: { pageId: string } }>(
    "/api/v1/pages/:pageId/delete-plan",
    async (request) => {
      const body = exactBody(request.body, [
        "expectedRevision",
        "expectedProjectRevision",
      ]);
      return service.deletePlan(request.params.pageId, {
        expectedRevision: body.expectedRevision as number,
        expectedProjectRevision: body.expectedProjectRevision as number,
      });
    },
  );

  server.delete<{ Params: { pageId: string } }>(
    "/api/v1/pages/:pageId",
    async (request) => {
      const body = exactBody(request.body, [
        "expectedRevision",
        "expectedProjectRevision",
        "idempotencyKey",
        "resolution",
        "reassignNavigationToPageId",
      ]);
      return service.delete(
        request.params.pageId,
        body as unknown as DeletePageRequest,
      );
    },
  );

  server.post<{
    Params: { projectId: string; commandId: string };
  }>(
    "/api/v1/projects/:projectId/pages/commands/:commandId/undo",
    async (request) => {
      const body = exactBody(request.body, [
        "expectedProjectRevision",
        "idempotencyKey",
      ]);
      return service.undo(
        request.params.projectId,
        request.params.commandId,
        body as unknown as UndoPageCommandRequest,
      );
    },
  );

  server.get("/api/v1/ui/icons", async (request) =>
    service.listIcons(request.query as Record<string, unknown>),
  );

  server.get<{ Params: { iconName: string } }>(
    "/api/v1/ui/icons/:iconName",
    async (request) => ({ item: service.getIcon(request.params.iconName) }),
  );

  server.post<{ Params: { projectId: string } }>(
    "/api/v1/projects/:projectId/publish/plan",
    async (request) => {
      const body = exactBody(request.body, ["expectedProjectRevision"]);
      return service.publishPlan(
        request.params.projectId,
        body.expectedProjectRevision,
      );
    },
  );

  server.post<{ Params: { projectId: string } }>(
    "/api/v1/projects/:projectId/publish",
    async (request) => {
      const body = exactBody(request.body, [
        "expectedProjectRevision",
        "idempotencyKey",
      ]);
      return service.publish(request.params.projectId, {
        expectedProjectRevision: body.expectedProjectRevision as number,
        idempotencyKey: body.idempotencyKey as string,
      });
    },
  );

  server.post<{ Params: { projectId: string } }>(
    "/api/v1/projects/:projectId/draft-previews",
    async (request, reply) => {
      const body = exactBody(request.body, ["expectedProjectRevision"]);
      return reply
        .code(201)
        .send(
          service.createDraftPreview(
            request.params.projectId,
            body.expectedProjectRevision,
          ),
        );
    },
  );

  server.get<{ Params: { previewId: string } }>(
    "/api/v1/draft-previews/:previewId/navigation",
    async (request) => service.draftPreviewNavigation(request.params.previewId),
  );

  server.get<{ Params: { previewId: string; pageId: string } }>(
    "/api/v1/draft-previews/:previewId/pages/:pageId",
    async (request) =>
      service.draftPreviewPage(request.params.previewId, request.params.pageId),
  );

  server.get<{ Params: { projectId: string } }>(
    "/api/v1/runtime/:projectId/navigation",
    async (request) => service.runtimeNavigation(request.params.projectId),
  );

  server.get<{ Params: { projectId: string; pageId: string } }>(
    "/api/v1/runtime/:projectId/pages/:pageId",
    async (request) =>
      service.runtimePage(request.params.projectId, request.params.pageId),
  );
}
