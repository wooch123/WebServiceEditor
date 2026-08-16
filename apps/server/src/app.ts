import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";

import { AuthService } from "./auth/auth-service.js";
import { BackupService } from "./backup/backup-service.js";
import {
  resolveAuthenticationConfig,
  resolveMetadataDatabasePath,
  resolveStorageRoot,
  type AuthenticationConfig,
} from "./config.js";
import { ApiError } from "./errors.js";
import {
  SchemaService,
  type SchemaFailurePoint,
} from "./data-schema/schema-service.js";
import { RelationshipService } from "./data-relationship/relationship-service.js";
import { SampleDataService } from "./data-relationship/sample-data-service.js";
import { RuntimeDefinitionService } from "./runtime/runtime-definition-service.js";
import { ProjectVariableService } from "./runtime/project-variable-service.js";
import {
  ElementService,
  type ElementFailureInjector,
} from "./elements/element-service.js";
import {
  LayoutPresetService,
  type LayoutPresetFailureInjector,
} from "./elements/layout-preset-service.js";
import { MetadataDatabase } from "./metadata/database.js";
import { PageService } from "./pages/page-service.js";
import { PerformanceMonitor } from "./performance/performance-monitor.js";
import { ProjectService } from "./projects/project-service.js";
import type { LifecycleFailureInjector } from "./projects/project-storage.js";
import { registerProjectRoutes } from "./routes/projects.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerBackupRoutes } from "./routes/backups.js";
import { registerElementRoutes } from "./routes/elements.js";
import { registerLayoutPresetRoutes } from "./routes/layout-presets.js";
import { registerPageRoutes } from "./routes/pages.js";
import { registerSystemRoutes } from "./routes/system.js";
import { registerDataSchemaRoutes } from "./routes/data-schema.js";
import { registerDataRelationshipRoutes } from "./routes/data-relationship.js";
import { registerSampleDataRoutes } from "./routes/sample-data.js";
import { registerProjectVariableRoutes } from "./routes/project-variables.js";
import { registerThemeRoutes } from "./routes/themes.js";
import { registerValidationRoutes } from "./routes/validation.js";
import { ThemeRevisionService } from "./themes/theme-revision-service.js";
import { ValidationService } from "./validation/validation-service.js";

export interface BuildServerOptions {
  readonly logger?: boolean;
  readonly metadataDatabasePath?: string;
  readonly storageRoot?: string;
  readonly failureInjector?: LifecycleFailureInjector;
  readonly elementFailureInjector?: ElementFailureInjector;
  readonly layoutPresetFailureInjector?: LayoutPresetFailureInjector;
  readonly schemaFailureInjector?: (point: SchemaFailurePoint) => void;
  readonly clock?: () => Date;
  readonly authentication?: AuthenticationConfig;
  readonly staticRoot?: string | false;
}

export function buildServer(options: BuildServerOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? false,
    trustProxy: "127.0.0.1",
  });
  const registeredApiRoutes = new Set<string>();
  app.addHook("onRoute", (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methods) {
      if (route.url.startsWith("/api/v1") && method !== "HEAD") {
        registeredApiRoutes.add(`${method} ${route.url}`);
      }
    }
  });
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
  const runtimeDefinitionService = new RuntimeDefinitionService(
    metadataDatabase,
    projectService.storage,
    options.clock ?? (() => new Date()),
  );
  const projectVariableService = new ProjectVariableService(
    metadataDatabase,
    options.clock ?? (() => new Date()),
  );
  const themeRevisionService = new ThemeRevisionService(
    metadataDatabase,
    projectService.storage,
    options.clock ?? (() => new Date()),
  );
  const pageService = new PageService({
    metadataDatabase,
    runtimeDefinitionService,
    ...(options.clock === undefined ? {} : { clock: options.clock }),
  });
  const elementService = new ElementService({
    metadataDatabase,
    ...(options.elementFailureInjector === undefined
      ? {}
      : { failureInjector: options.elementFailureInjector }),
    ...(options.clock === undefined ? {} : { clock: options.clock }),
  });
  const layoutPresetService = new LayoutPresetService({
    metadataDatabase,
    ...(options.layoutPresetFailureInjector === undefined
      ? {}
      : { failureInjector: options.layoutPresetFailureInjector }),
    ...(options.clock === undefined ? {} : { clock: options.clock }),
  });
  const schemaService = new SchemaService({
    metadataDatabase,
    projectStorage: projectService.storage,
    ...(options.schemaFailureInjector === undefined
      ? {}
      : { failureInjector: options.schemaFailureInjector }),
    ...(options.clock === undefined ? {} : { clock: options.clock }),
  });
  const relationshipService = new RelationshipService({
    metadataDatabase,
    projectStorage: projectService.storage,
    runtimeDefinitionService,
    ...(options.clock === undefined ? {} : { clock: options.clock }),
  });
  const sampleDataService = new SampleDataService(
    metadataDatabase,
    projectService.storage,
    options.clock ?? (() => new Date()),
  );
  const validationService = new ValidationService(
    metadataDatabase,
    projectService.storage,
    () => [...registeredApiRoutes].sort(),
    options.clock ?? (() => new Date()),
  );
  const backupService = new BackupService(
    metadataDatabase,
    projectService,
    resolveStorageRoot(options.storageRoot),
    options.clock ?? (() => new Date()),
  );
  const authService = new AuthService(
    metadataDatabase,
    options.authentication ?? resolveAuthenticationConfig(),
    options.clock ?? (() => new Date()),
  );
  const performanceMonitor = new PerformanceMonitor(
    4096,
    options.clock ?? (() => new Date()),
  );

  void app.register(cookie);
  void app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", "data:"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        imgSrc: ["'self'", "data:", "blob:"],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    frameguard: { action: "deny" },
    hsts: {
      includeSubDomains: true,
      maxAge: 31_536_000,
      preload: true,
    },
    referrerPolicy: { policy: "no-referrer" },
  });
  void app.register(rateLimit, {
    global: false,
    max: 300,
    timeWindow: "1 minute",
  });
  app.addHook("preHandler", async (request) => {
    authService.guard(request);
  });
  app.addHook("onRequest", async (request) => {
    performanceMonitor.start(request);
  });
  app.addHook("onResponse", async (request) => {
    performanceMonitor.finish(request);
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
  void app.register(registerSystemRoutes, {
    metadataDatabase,
    projectService,
    backupService,
    performanceMonitor,
  });
  void app.register(registerAuthRoutes, { authService });
  void app.register(registerProjectRoutes, { projectService });
  void app.register(registerBackupRoutes, { backupService });
  void app.register(registerPageRoutes, { pageService });
  void app.register(registerElementRoutes, { elementService });
  void app.register(registerLayoutPresetRoutes, { layoutPresetService });
  void app.register(registerDataSchemaRoutes, { schemaService });
  void app.register(registerDataRelationshipRoutes, { relationshipService });
  void app.register(registerSampleDataRoutes, { sampleDataService });
  void app.register(registerProjectVariableRoutes, { projectVariableService });
  void app.register(registerThemeRoutes, { themeRevisionService });
  void app.register(registerValidationRoutes, { validationService });

  const defaultStaticRoot = fileURLToPath(
    new URL("../../web/dist", import.meta.url),
  );
  const staticRoot =
    options.staticRoot === false
      ? undefined
      : (options.staticRoot ?? defaultStaticRoot);
  if (staticRoot !== undefined && existsSync(staticRoot)) {
    void app.register(fastifyStatic, {
      root: staticRoot,
      wildcard: false,
      index: ["index.html"],
    });
    app.setNotFoundHandler(async (request, reply) => {
      if (
        request.method === "GET" &&
        !request.url.startsWith("/api/") &&
        request.headers.accept?.includes("text/html")
      ) {
        return reply.type("text/html; charset=utf-8").sendFile("index.html");
      }
      return reply.code(404).send({
        error: { code: "NOT_FOUND", message: "Resource was not found" },
      });
    });
  }

  return app;
}
