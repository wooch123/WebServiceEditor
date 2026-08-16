import type {
  GenerateSampleDataRequest,
  ResetSampleDataRequest,
} from "@webeditor/domain";
import type { FastifyInstance } from "fastify";

import type { SampleDataService } from "../data-relationship/sample-data-service.js";
import { assertApi } from "../errors.js";

function exactBody(
  body: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  assertApi(
    body !== null && typeof body === "object" && !Array.isArray(body),
    400,
    "INVALID_REQUEST_BODY",
    "Request body must be an object",
  );
  const value = body as Record<string, unknown>;
  const unknown = Object.keys(value).filter((key) => !keys.includes(key));
  assertApi(
    unknown.length === 0,
    400,
    "UNKNOWN_REQUEST_FIELD",
    "Request contains unknown fields",
    { fields: unknown },
  );
  return value;
}

export async function registerSampleDataRoutes(
  server: FastifyInstance,
  options: { readonly sampleDataService: SampleDataService },
): Promise<void> {
  server.post<{ Params: { projectId: string } }>(
    "/api/v1/projects/:projectId/sample-data/generate",
    async (request) =>
      options.sampleDataService.generate(
        request.params.projectId,
        exactBody(request.body, [
          "rowCount",
          "reset",
          "idempotencyKey",
        ]) as unknown as GenerateSampleDataRequest,
      ),
  );
  server.post<{ Params: { projectId: string } }>(
    "/api/v1/projects/:projectId/sample-data/reset",
    async (request) =>
      options.sampleDataService.reset(
        request.params.projectId,
        exactBody(request.body, [
          "idempotencyKey",
        ]) as unknown as ResetSampleDataRequest,
      ),
  );
}
