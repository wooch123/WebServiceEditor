import type {
  ApplyLayoutPresetRequest,
  PreviewLayoutPresetRequest,
} from "@webeditor/domain";
import type { FastifyInstance } from "fastify";

import type { LayoutPresetService } from "../elements/layout-preset-service.js";
import { assertApi } from "../errors.js";

export interface LayoutPresetRoutesOptions {
  readonly layoutPresetService: LayoutPresetService;
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

export async function registerLayoutPresetRoutes(
  server: FastifyInstance,
  options: LayoutPresetRoutesOptions,
): Promise<void> {
  const service = options.layoutPresetService;

  server.get("/api/v1/layout-presets", async () => service.registry());

  server.get<{ Params: { presetId: string } }>(
    "/api/v1/layout-presets/:presetId",
    async (request) => service.registryDefinition(request.params.presetId),
  );

  server.get<{ Params: { pageId: string } }>(
    "/api/v1/pages/:pageId/layout-preset-instances",
    async (request) => service.instances(request.params.pageId),
  );

  server.post<{ Params: { pageId: string; presetId: string } }>(
    "/api/v1/pages/:pageId/layout-presets/:presetId/preview",
    async (request) => {
      const body = exactBody(request.body, [
        "mode",
        "expectedLayoutRevision",
        "expectedProjectRevision",
      ]);
      return service.preview(
        request.params.pageId,
        request.params.presetId,
        body as unknown as PreviewLayoutPresetRequest,
      );
    },
  );

  server.post<{ Params: { pageId: string; presetId: string } }>(
    "/api/v1/pages/:pageId/layout-presets/:presetId/apply",
    async (request, reply) => {
      const body = exactBody(request.body, [
        "previewId",
        "expectedLayoutRevision",
        "expectedProjectRevision",
        "idempotencyKey",
      ]);
      return reply
        .code(201)
        .send(
          service.apply(
            request.params.pageId,
            request.params.presetId,
            body as unknown as ApplyLayoutPresetRequest,
          ),
        );
    },
  );
}
