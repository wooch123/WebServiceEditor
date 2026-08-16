import type { FastifyInstance } from "fastify";

import { assertApi } from "../errors.js";
import type {
  CreateThemeRevisionRequest,
  ThemeRevisionCommandRequest,
  ThemeRevisionService,
  UpdateRuntimeThemePolicyRequest,
} from "../themes/theme-revision-service.js";

function exactBody(
  body: unknown,
  allowed: readonly string[],
): Record<string, unknown> {
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

export async function registerThemeRoutes(
  server: FastifyInstance,
  options: { readonly themeRevisionService: ThemeRevisionService },
): Promise<void> {
  const service = options.themeRevisionService;

  server.get("/api/v1/themes/presets", async () => service.listPresets());
  server.get<{ Params: { themeId: string } }>(
    "/api/v1/themes/presets/:themeId",
    async (request) => service.preset(request.params.themeId),
  );
  server.get<{ Params: { projectId: string } }>(
    "/api/v1/projects/:projectId/runtime-theme-policy",
    async (request) => ({ policy: service.policy(request.params.projectId) }),
  );
  server.post<{ Params: { projectId: string } }>(
    "/api/v1/projects/:projectId/theme-revisions",
    async (request, reply) => {
      const body = exactBody(request.body, [
        "presetId",
        "tokens",
        "expectedProjectRevision",
        "idempotencyKey",
      ]);
      return reply
        .code(201)
        .send(
          service.create(
            request.params.projectId,
            body as unknown as CreateThemeRevisionRequest,
          ),
        );
    },
  );
  for (const operation of ["validate", "publish", "rollback"] as const) {
    server.post<{
      Params: { projectId: string; revisionId: string };
    }>(
      `/api/v1/projects/:projectId/theme-revisions/:revisionId/${operation}`,
      async (request) => {
        const body = exactBody(request.body, [
          "expectedRevision",
          "expectedProjectRevision",
          "idempotencyKey",
        ]) as unknown as ThemeRevisionCommandRequest;
        return service[operation](
          request.params.projectId,
          request.params.revisionId,
          body,
        );
      },
    );
  }
  server.patch<{ Params: { projectId: string } }>(
    "/api/v1/projects/:projectId/runtime-theme-policy",
    async (request) => {
      const body = exactBody(request.body, [
        "defaultThemePresetId",
        "autoApplyThemeToRuntime",
        "allowRuntimeThemeSelection",
        "allowedRuntimeThemeIds",
        "expectedProjectRevision",
        "idempotencyKey",
      ]);
      return service.updatePolicy(
        request.params.projectId,
        body as unknown as UpdateRuntimeThemePolicyRequest,
      );
    },
  );
  server.get<{ Params: { projectId: string } }>(
    "/api/v1/runtime/:projectId/theme-manifest",
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      return service.manifest(request.params.projectId);
    },
  );
}
