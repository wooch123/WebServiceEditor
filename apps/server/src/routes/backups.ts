import type {
  CreateProjectBackupRequest,
  RestoreProjectBackupRequest,
  VerifyProjectBackupRequest,
} from "@webeditor/domain";
import type { FastifyInstance } from "fastify";

import type { BackupService } from "../backup/backup-service.js";
import { assertApi } from "../errors.js";

export interface BackupRoutesOptions {
  readonly backupService: BackupService;
}

function bodyRecord(body: unknown): Record<string, unknown> {
  assertApi(
    typeof body === "object" && body !== null && !Array.isArray(body),
    400,
    "INVALID_REQUEST_BODY",
    "Request body must be a JSON object",
  );
  return body as Record<string, unknown>;
}

export async function registerBackupRoutes(
  server: FastifyInstance,
  options: BackupRoutesOptions,
): Promise<void> {
  const service = options.backupService;

  server.get("/api/v1/backups", async () => ({ backups: service.list() }));

  server.get<{ Params: { backupId: string } }>(
    "/api/v1/backups/:backupId",
    async (request) => ({ backup: service.get(request.params.backupId) }),
  );

  server.post<{ Params: { projectId: string } }>(
    "/api/v1/projects/:projectId/backups",
    async (request, reply) => {
      const backup = service.create(
        request.params.projectId,
        bodyRecord(request.body) as unknown as CreateProjectBackupRequest,
      );
      return reply.code(201).send({ backup });
    },
  );

  server.post<{ Params: { backupId: string } }>(
    "/api/v1/backups/:backupId/verify",
    async (request) => ({
      drill: service.verify(
        request.params.backupId,
        bodyRecord(request.body) as unknown as VerifyProjectBackupRequest,
      ),
    }),
  );

  server.post<{ Params: { backupId: string } }>(
    "/api/v1/backups/:backupId/restore",
    async (request, reply) => {
      const restored = service.restore(
        request.params.backupId,
        bodyRecord(request.body) as unknown as RestoreProjectBackupRequest,
      );
      return reply.code(201).send({ restored });
    },
  );
}
