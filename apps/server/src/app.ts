import Fastify, { type FastifyInstance } from "fastify";

import { resolveMetadataDatabasePath, resolveStorageRoot } from "./config.js";
import { ApiError } from "./errors.js";
import { MetadataDatabase } from "./metadata/database.js";
import { PageService } from "./pages/page-service.js";
import { ProjectService } from "./projects/project-service.js";
import type { LifecycleFailureInjector } from "./projects/project-storage.js";
import { registerProjectRoutes } from "./routes/projects.js";
import { registerPageRoutes } from "./routes/pages.js";
import { registerSystemRoutes } from "./routes/system.js";

export interface BuildServerOptions {
  readonly logger?: boolean;
  readonly metadataDatabasePath?: string;
  readonly storageRoot?: string;
  readonly failureInjector?: LifecycleFailureInjector;
  readonly clock?: () => Date;
}

export function buildServer(options: BuildServerOptions = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });
  const metadataDatabase = new MetadataDatabase(
    resolveMetadataDatabasePath(options.metadataDatabasePath),
  );
  let projectService: ProjectService;
  try {
    projectService = new ProjectService({
      metadataDatabase,
      storageRoot: resolveStorageRoot(options.storageRoot),
      ...(options.failureInjector === undefined
        ? {}
        : { failureInjector: options.failureInjector }),
      ...(options.clock === undefined ? {} : { clock: options.clock }),
    });
  } catch (error) {
    metadataDatabase.close();
    throw error;
  }
  const pageService = new PageService({
    metadataDatabase,
    ...(options.clock === undefined ? {} : { clock: options.clock }),
  });

  app.setErrorHandler(async (error, _request, reply) => {
    if (error instanceof ApiError) {
      return reply.code(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          ...(error.details === undefined ? {} : { details: error.details }),
        },
      });
    }
    if (
      typeof error === "object" &&
      error !== null &&
      "statusCode" in error &&
      typeof error.statusCode === "number" &&
      error.statusCode >= 400 &&
      error.statusCode < 500
    ) {
      return reply.code(error.statusCode).send({
        error: {
          code:
            error.statusCode === 413 ? "PAYLOAD_TOO_LARGE" : "INVALID_REQUEST",
          message:
            error.statusCode === 413
              ? "Request payload exceeds the configured limit"
              : "Request could not be parsed",
        },
      });
    }
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "SQLITE_CONSTRAINT_UNIQUE"
    ) {
      return reply.code(409).send({
        error: {
          code: "PROJECT_IDENTITY_CONFLICT",
          message: "An active project already uses this identity",
        },
      });
    }
    app.log.error({ err: error }, "Unhandled request error");
    return reply.code(500).send({
      error: {
        code: "INTERNAL_ERROR",
        message: "The server could not complete the request",
      },
    });
  });
  app.addHook("onClose", async () => {
    metadataDatabase.close();
  });
  void app.register(registerSystemRoutes, { metadataDatabase, projectService });
  void app.register(registerProjectRoutes, { projectService });
  void app.register(registerPageRoutes, { pageService });

  return app;
}
