import type {
  CreateProjectRequest,
  PatchProjectRequest,
  ProjectDto,
  PurgePlanDto,
  PurgeProjectRequest,
  RestoreProjectRequest,
  TrashProjectRequest,
} from "@webeditor/domain";
import type { FastifyInstance } from "fastify";

import { assertApi } from "../errors.js";
import type { ProjectService } from "../projects/project-service.js";
import { PROJECT_IMPORT_DECODED_LIMIT_BYTES } from "../projects/project-storage.js";

const PROJECT_IMPORT_BODY_LIMIT =
  Math.ceil((PROJECT_IMPORT_DECODED_LIMIT_BYTES * 4) / 3) + 2 * 1024 * 1024;

export interface ProjectRoutesOptions {
  readonly projectService: ProjectService;
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

function serializePurgePlan(plan: PurgePlanDto) {
  return {
    ...plan,
    purgePlanId: plan.id,
    metadataRecordCount: plan.impact.metadataRecordCount,
    fileCount: plan.impact.fileCount,
    assetCount: plan.impact.assetCount,
    estimatedBytes: plan.impact.estimatedBytes,
    blockers: plan.impact.blockedReasons,
    backupAvailable: plan.impact.hasBackup,
  };
}

function filterAndSortProjects(
  projects: readonly ProjectDto[],
  query: Record<string, unknown>,
): readonly ProjectDto[] {
  const search =
    typeof query.q === "string" ? query.q.trim().toLocaleLowerCase() : "";
  assertApi(
    search.length <= 200,
    400,
    "INVALID_SEARCH",
    "Search query is too long",
  );
  const sort = typeof query.sort === "string" ? query.sort : "updatedAt";
  const direction = query.direction === "asc" ? "asc" : "desc";
  assertApi(
    sort === "updatedAt" || sort === "createdAt" || sort === "name",
    400,
    "INVALID_SORT",
    "Project sort field is invalid",
  );
  const filtered = projects.filter(
    (project) =>
      search.length === 0 ||
      project.name.toLocaleLowerCase().includes(search) ||
      project.slug.toLocaleLowerCase().includes(search) ||
      (project.description?.toLocaleLowerCase().includes(search) ?? false),
  );
  return [...filtered].sort((left, right) => {
    const comparison =
      sort === "name"
        ? left.name.localeCompare(right.name)
        : Date.parse(left[sort]) - Date.parse(right[sort]);
    return direction === "asc" ? comparison : -comparison;
  });
}

export async function registerProjectRoutes(
  server: FastifyInstance,
  options: ProjectRoutesOptions,
): Promise<void> {
  const service = options.projectService;

  server.get("/api/v1/projects", async (request) => ({
    projects: filterAndSortProjects(
      service.listActive(),
      request.query as Record<string, unknown>,
    ),
  }));

  server.post("/api/v1/projects", async (request, reply) => {
    const project = service.create(
      bodyRecord(request.body) as unknown as CreateProjectRequest,
    );
    return reply.code(201).send({ project });
  });

  server.get<{ Params: { projectId: string } }>(
    "/api/v1/projects/:projectId",
    async (request) => ({
      project: service.getActive(request.params.projectId),
    }),
  );

  server.patch<{ Params: { projectId: string } }>(
    "/api/v1/projects/:projectId",
    async (request) => ({
      project: service.patch(
        request.params.projectId,
        bodyRecord(request.body) as unknown as PatchProjectRequest,
      ),
    }),
  );

  server.post<{ Params: { projectId: string } }>(
    "/api/v1/projects/:projectId/clone",
    async (request, reply) => {
      const body = request.body === undefined ? {} : bodyRecord(request.body);
      const project = service.clone(request.params.projectId, {
        ...(typeof body.name === "string" ? { name: body.name } : {}),
        ...(typeof body.slug === "string" ? { slug: body.slug } : {}),
      });
      return reply.code(201).send({ project });
    },
  );

  server.post<{ Params: { projectId: string } }>(
    "/api/v1/projects/:projectId/export",
    async (request) => ({ export: service.export(request.params.projectId) }),
  );

  server.post(
    "/api/v1/projects/import",
    { bodyLimit: PROJECT_IMPORT_BODY_LIMIT },
    async (request, reply) => {
      const body = bodyRecord(request.body);
      const exportDto = body.export;
      assertApi(
        typeof exportDto === "object" && exportDto !== null,
        400,
        "PROJECT_EXPORT_REQUIRED",
        "Project export payload is required",
      );
      const project = service.import(exportDto, {
        ...(typeof body.name === "string" ? { name: body.name } : {}),
        ...(typeof body.slug === "string" ? { slug: body.slug } : {}),
      });
      return reply.code(201).send({ project });
    },
  );

  server.post<{ Params: { projectId: string } }>(
    "/api/v1/projects/:projectId/trash",
    async (request) => ({
      project: service.trash(
        request.params.projectId,
        bodyRecord(request.body) as unknown as TrashProjectRequest,
      ),
    }),
  );

  server.get("/api/v1/recycle-bin/projects", async (request) => ({
    projects: filterAndSortProjects(
      service.listRecycleBin(),
      request.query as Record<string, unknown>,
    ),
  }));

  server.get<{ Params: { projectId: string } }>(
    "/api/v1/recycle-bin/projects/:projectId",
    async (request) => ({
      project: service.getRecycleBinProject(request.params.projectId),
    }),
  );

  server.post<{ Params: { projectId: string } }>(
    "/api/v1/recycle-bin/projects/:projectId/restore",
    async (request) => ({
      project: service.restore(
        request.params.projectId,
        bodyRecord(request.body) as unknown as RestoreProjectRequest,
      ),
    }),
  );

  server.post<{ Params: { projectId: string } }>(
    "/api/v1/recycle-bin/projects/:projectId/purge-plan",
    async (request) => {
      const body = bodyRecord(request.body);
      const plan = service.createPurgePlan(request.params.projectId, {
        expectedLifecycleRevision: body.expectedLifecycleRevision as number,
      });
      return { plan: serializePurgePlan(plan) };
    },
  );

  server.delete<{ Params: { projectId: string } }>(
    "/api/v1/recycle-bin/projects/:projectId",
    async (request) => ({
      tombstone: service.purge(
        request.params.projectId,
        bodyRecord(request.body) as unknown as PurgeProjectRequest,
      ),
    }),
  );

  server.post("/api/v1/recycle-bin/projects/batch-restore", async (request) => {
    const body = bodyRecord(request.body);
    assertApi(
      Array.isArray(body.items),
      400,
      "BATCH_ITEMS_REQUIRED",
      "Batch items are required",
    );
    assertApi(
      body.items.length <= 100,
      400,
      "BATCH_TOO_LARGE",
      "Batch may contain at most 100 items",
    );
    const items = body.items.map((item) => {
      const record = bodyRecord(item);
      assertApi(
        typeof record.projectId === "string",
        400,
        "PROJECT_ID_REQUIRED",
        "Project ID is required",
      );
      return record as unknown as {
        readonly projectId: string;
      } & RestoreProjectRequest;
    });
    return { results: service.batchRestore(items) };
  });

  server.post("/api/v1/recycle-bin/projects/batch-purge", async (request) => {
    const body = bodyRecord(request.body);
    assertApi(
      Array.isArray(body.items),
      400,
      "BATCH_ITEMS_REQUIRED",
      "Batch items are required",
    );
    assertApi(
      body.items.length <= 100,
      400,
      "BATCH_TOO_LARGE",
      "Batch may contain at most 100 items",
    );
    const items = body.items.map((item) => {
      const record = bodyRecord(item);
      assertApi(
        typeof record.projectId === "string",
        400,
        "PROJECT_ID_REQUIRED",
        "Project ID is required",
      );
      return record as unknown as {
        readonly projectId: string;
      } & PurgeProjectRequest;
    });
    return { results: service.batchPurge(items) };
  });
}
