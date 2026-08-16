import type { FastifyInstance } from "fastify";

import type { BackupService } from "../backup/backup-service.js";
import type { MetadataDatabase } from "../metadata/database.js";
import type { ProjectService } from "../projects/project-service.js";
import type { PerformanceMonitor } from "../performance/performance-monitor.js";

export interface SystemRoutesOptions {
  readonly metadataDatabase: MetadataDatabase;
  readonly projectService: ProjectService;
  readonly backupService: BackupService;
  readonly performanceMonitor: PerformanceMonitor;
}

export async function registerSystemRoutes(
  app: FastifyInstance,
  options: SystemRoutesOptions,
): Promise<void> {
  app.get("/api/v1/health", async () => ({
    service: "webeditor-server",
    status: "ok",
  }));

  app.get("/api/v1/ready", async (_request, reply) => {
    try {
      const readiness = options.metadataDatabase.assertReady();
      options.projectService.assertReady();
      options.backupService.assertReady();
      return {
        checks: {
          backupStorage: "ready",
          metadataDatabase: "ready",
          projectStorage: "ready",
        },
        schemaVersion: readiness.schemaVersion,
        status: "ready",
      };
    } catch (error) {
      app.log.error({ err: error }, "Readiness check failed");
      return reply.code(503).send({
        checks: {
          backupStorage: "not_ready",
          metadataDatabase: "not_ready",
          projectStorage: "not_ready",
        },
        status: "not_ready",
      });
    }
  });

  app.get("/api/v1/performance/summary", async () =>
    options.performanceMonitor.summary(),
  );
}
