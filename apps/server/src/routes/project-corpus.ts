import type {
  GenerateProjectCorpusRequest,
  VerifyProjectCorpusRequest,
} from "@webeditor/domain";
import type { FastifyInstance } from "fastify";

import { assertApi } from "../errors.js";
import type { ProjectCorpusService } from "../project-corpus/project-corpus-service.js";

function generationRequest(body: unknown): GenerateProjectCorpusRequest {
  assertApi(
    typeof body === "object" && body !== null && !Array.isArray(body),
    400,
    "INVALID_PROJECT_CORPUS_REQUEST",
    "Corpus request must be an object",
  );
  const source = body as Record<string, unknown>;
  const unknown = Object.keys(source).filter(
    (key) => !["seed", "idempotencyKey"].includes(key),
  );
  assertApi(
    unknown.length === 0,
    400,
    "UNKNOWN_REQUEST_FIELD",
    "Corpus request contains unknown fields",
    { fields: unknown },
  );
  return source as unknown as GenerateProjectCorpusRequest;
}

function verificationRequest(body: unknown): VerifyProjectCorpusRequest {
  assertApi(
    typeof body === "object" && body !== null && !Array.isArray(body),
    400,
    "INVALID_PROJECT_CORPUS_VERIFICATION_REQUEST",
    "Corpus verification request must be an object",
  );
  const source = body as Record<string, unknown>;
  const unknown = Object.keys(source).filter((key) => key !== "idempotencyKey");
  assertApi(
    unknown.length === 0,
    400,
    "UNKNOWN_REQUEST_FIELD",
    "Corpus verification request contains unknown fields",
    { fields: unknown },
  );
  return source as unknown as VerifyProjectCorpusRequest;
}

export async function registerProjectCorpusRoutes(
  server: FastifyInstance,
  options: { readonly projectCorpusService: ProjectCorpusService },
): Promise<void> {
  const service = options.projectCorpusService;

  server.post(
    "/api/v1/internal/project-corpus/generate",
    async (request, reply) =>
      reply
        .code(201)
        .send({ run: service.generate(generationRequest(request.body)) }),
  );
  server.get<{ Params: { runId: string } }>(
    "/api/v1/internal/project-corpus/:runId",
    async (request) => service.get(request.params.runId),
  );
  server.get<{ Params: { runId: string } }>(
    "/api/v1/internal/project-corpus/:runId/results",
    async (request) => service.results(request.params.runId),
  );
  server.post<{ Params: { runId: string } }>(
    "/api/v1/internal/project-corpus/:runId/verify",
    async (request) => ({
      verification: await service.verify(
        request.params.runId,
        verificationRequest(request.body),
      ),
    }),
  );
  server.post(
    "/api/v1/internal/sample-projects/feature-showcase",
    async (_request, reply) =>
      reply.code(201).send({
        project: await service.createFeatureShowcase(),
      }),
  );
}
