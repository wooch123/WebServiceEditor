import type { RunValidationRequest } from "@webeditor/domain";
import type { FastifyInstance } from "fastify";

import { assertApi } from "../errors.js";
import type { ValidationService } from "../validation/validation-service.js";

function requestBody(body: unknown): RunValidationRequest {
  assertApi(
    typeof body === "object" && body !== null && !Array.isArray(body),
    400,
    "INVALID_REQUEST_BODY",
    "Request body must be an object",
  );
  const source = body as Record<string, unknown>;
  const unknown = Object.keys(source).filter(
    (key) => !["expectedProjectRevision", "idempotencyKey"].includes(key),
  );
  assertApi(
    unknown.length === 0,
    400,
    "UNKNOWN_REQUEST_FIELD",
    "Request contains unknown fields",
    { fields: unknown },
  );
  return source as unknown as RunValidationRequest;
}

export async function registerValidationRoutes(
  server: FastifyInstance,
  options: { readonly validationService: ValidationService },
): Promise<void> {
  const service = options.validationService;

  server.post<{ Params: { projectId: string } }>(
    "/api/v1/projects/:projectId/validate",
    async (request) =>
      service.run(request.params.projectId, requestBody(request.body)),
  );
  server.post<{ Params: { projectId: string } }>(
    "/api/v1/projects/:projectId/validate-inventory",
    async (request) =>
      service.run(
        request.params.projectId,
        requestBody(request.body),
        "VALIDATE_INVENTORY",
      ),
  );
  server.get<{ Params: { projectId: string } }>(
    "/api/v1/projects/:projectId/validation-runs",
    async (request) => service.list(request.params.projectId),
  );
  server.get<{ Params: { projectId: string; runId: string } }>(
    "/api/v1/projects/:projectId/validation-runs/:runId",
    async (request) =>
      service.get(request.params.projectId, request.params.runId),
  );
}
