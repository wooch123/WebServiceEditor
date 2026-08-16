import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";

import { buildServer } from "../app.js";

const configuredWorkspace = process.env.WEBEDITOR_CORPUS_WORKSPACE_ROOT;
if (configuredWorkspace === undefined || configuredWorkspace.trim() === "") {
  throw new Error(
    "WEBEDITOR_CORPUS_WORKSPACE_ROOT is required for isolated Corpus generation",
  );
}
const repositoryRoot = resolve(process.cwd(), "../..");
const workspaceRoot = resolve(configuredWorkspace);
const productionDataRoot = resolve(repositoryRoot, "data");
if (
  workspaceRoot === repositoryRoot ||
  workspaceRoot === productionDataRoot ||
  productionDataRoot.startsWith(`${workspaceRoot}${sep}`)
) {
  throw new Error(
    "Corpus workspace must be isolated from repository runtime data",
  );
}
const evidencePath = resolve(
  process.env.WEBEDITOR_CORPUS_EVIDENCE_PATH ??
    join(repositoryRoot, "artifacts/phase20/project-corpus-manifest.json"),
);
if (!isAbsolute(workspaceRoot) || !isAbsolute(evidencePath)) {
  throw new Error(
    "Corpus workspace and evidence paths must resolve absolutely",
  );
}
mkdirSync(workspaceRoot, { recursive: true });

const app = buildServer({
  metadataDatabasePath: join(workspaceRoot, "metadata.sqlite"),
  storageRoot: join(workspaceRoot, "storage"),
  projectCorpusManifestPath: join(
    repositoryRoot,
    "webeditor_project_corpus_v3.json",
  ),
  staticRoot: false,
});

try {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/internal/project-corpus/generate",
    payload: {
      seed: process.env.WEBEDITOR_CORPUS_SEED ?? "webeditor-project-corpus-v3",
      idempotencyKey:
        process.env.WEBEDITOR_CORPUS_IDEMPOTENCY_KEY ??
        "phase20-operational-generation",
    },
  });
  if (response.statusCode !== 201) {
    throw new Error(`Corpus generation failed (${response.statusCode})`);
  }
  const run = response.json().run as {
    readonly id: string;
    readonly status: string;
    readonly evidencePath: string;
  };
  if (run.status !== "GENERATED") {
    throw new Error(`Corpus run did not finish: ${run.status}`);
  }
  const sourceReportPath = join(workspaceRoot, "storage", run.evidencePath);
  mkdirSync(dirname(evidencePath), { recursive: true });
  copyFileSync(sourceReportPath, evidencePath);
  const report = JSON.parse(readFileSync(sourceReportPath, "utf8"));
  writeFileSync(
    join(dirname(evidencePath), "corpus-generation-run.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        result: "PASS",
        target: "isolated real Metadata and Runtime workspace",
        workspaceRoot,
        run,
        manifestChecksum: report.manifestChecksum,
        generatedProjectCount: report.projectCount,
        generatedAt: report.completedAt,
      },
      null,
      2,
    )}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  process.stdout.write(
    `${JSON.stringify({
      result: "PASS",
      runId: run.id,
      projectCount: report.projectCount,
      manifestChecksum: report.manifestChecksum,
      evidencePath,
    })}\n`,
  );
} finally {
  await app.close();
}
