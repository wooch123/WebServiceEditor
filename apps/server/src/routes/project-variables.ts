import type {
  CreateProjectVariableRequestDto,
  DeleteProjectVariableRequestDto,
  UpdateProjectVariableRequestDto,
} from "@webeditor/domain";
import type { FastifyInstance } from "fastify";

import { assertApi } from "../errors.js";
import type { ProjectVariableService } from "../runtime/project-variable-service.js";

function exactBody(body: unknown, allowed: readonly string[]) {
  assertApi(
    typeof body === "object" && body !== null && !Array.isArray(body),
    400,
    "INVALID_REQUEST_BODY",
    "Request body must be an object",
  );
  const source = body as Record<string, unknown>;
  const unknown = Object.keys(source).filter((key) => !allowed.includes(key));
  assertApi(
    unknown.length === 0,
    400,
    "UNKNOWN_REQUEST_FIELD",
    "Request contains unknown fields",
    { fields: unknown },
  );
  return source;
}

export async function registerProjectVariableRoutes(
  server: FastifyInstance,
  options: { readonly projectVariableService: ProjectVariableService },
): Promise<void> {
  const service = options.projectVariableService;
  server.get<{ Params: { projectId: string } }>(
    "/api/v1/projects/:projectId/variables",
    async (request) => service.list(request.params.projectId),
  );
  server.post<{ Params: { projectId: string } }>(
    "/api/v1/projects/:projectId/variables",
    async (request, reply) => {
      const body = exactBody(request.body, [
        "key",
        "name",
        "valueType",
        "scope",
        "transport",
        "sensitive",
        "defaultValue",
        "expectedProjectRevision",
        "idempotencyKey",
      ]);
      return reply
        .code(201)
        .send(
          service.create(
            request.params.projectId,
            body as unknown as CreateProjectVariableRequestDto,
          ),
        );
    },
  );
  server.patch<{ Params: { variableId: string } }>(
    "/api/v1/variables/:variableId",
    async (request) => {
      const body = exactBody(request.body, [
        "key",
        "name",
        "scope",
        "transport",
        "sensitive",
        "defaultValue",
        "expectedRevision",
        "expectedProjectRevision",
        "idempotencyKey",
      ]);
      return service.update(
        request.params.variableId,
        body as unknown as UpdateProjectVariableRequestDto,
      );
    },
  );
  server.delete<{ Params: { variableId: string } }>(
    "/api/v1/variables/:variableId",
    async (request) => {
      const body = exactBody(request.body, [
        "expectedRevision",
        "expectedProjectRevision",
        "idempotencyKey",
      ]);
      return service.delete(
        request.params.variableId,
        body as unknown as DeleteProjectVariableRequestDto,
      );
    },
  );
}
