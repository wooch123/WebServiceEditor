import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";

import { buildServer } from "../app.js";

const configuredWorkspace = process.env.WEBEDITOR_CORPUS_WORKSPACE_ROOT;
const runId = process.env.WEBEDITOR_CORPUS_RUN_ID;
if (configuredWorkspace === undefined || configuredWorkspace.trim() === "") {
  throw new Error(
    "WEBEDITOR_CORPUS_WORKSPACE_ROOT is required for isolated Corpus verification",
  );
}
if (runId === undefined || !/^[0-9a-f-]{36}$/u.test(runId)) {
  throw new Error(
    "WEBEDITOR_CORPUS_RUN_ID is required for Corpus verification",
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
const evidenceRoot = resolve(
  process.env.WEBEDITOR_CORPUS_VERIFICATION_EVIDENCE_ROOT ??
    join(repositoryRoot, "artifacts/phase21"),
);
if (!isAbsolute(workspaceRoot) || !isAbsolute(evidenceRoot)) {
  throw new Error("Corpus workspace and evidence root must resolve absolutely");
}
mkdirSync(evidenceRoot, { recursive: true });

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
    url: `/api/v1/internal/project-corpus/${runId}/verify`,
    payload: {
      idempotencyKey:
        process.env.WEBEDITOR_CORPUS_VERIFY_IDEMPOTENCY_KEY ??
        "phase21-operational-verification",
    },
  });
  if (response.statusCode !== 200) {
    throw new Error(
      `Corpus verification failed (${response.statusCode}): ${response.body}`,
    );
  }
  const verification = response.json().verification as {
    readonly status: string;
    readonly verificationChecksum: string;
    readonly resultsEvidencePath: string;
    readonly performanceEvidencePath: string;
    readonly summary: { readonly passCount: number };
  };
  if (verification.status !== "VERIFIED") {
    throw new Error(`Corpus verification did not pass: ${verification.status}`);
  }
  for (const [source, target] of [
    [verification.resultsEvidencePath, "project-corpus-results.json"],
    [verification.performanceEvidencePath, "project-corpus-performance.json"],
  ] as const) {
    const sourcePath = join(workspaceRoot, "storage", source);
    const targetPath = join(evidenceRoot, target);
    mkdirSync(dirname(targetPath), { recursive: true });
    copyFileSync(sourcePath, targetPath);
  }
  const results = JSON.parse(
    readFileSync(join(evidenceRoot, "project-corpus-results.json"), "utf8"),
  );
  writeFileSync(
    join(evidenceRoot, "corpus-verification-run.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        result: "PASS",
        target: "isolated real Metadata and Runtime workspace after restart",
        workspaceRoot,
        runId,
        passCount: verification.summary.passCount,
        verificationChecksum: verification.verificationChecksum,
        generatedAt: results.completedAt,
      },
      null,
      2,
    )}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  process.stdout.write(
    `${JSON.stringify({
      result: "PASS",
      runId,
      passCount: verification.summary.passCount,
      verificationChecksum: verification.verificationChecksum,
      evidenceRoot,
    })}\n`,
  );
} finally {
  await app.close();
}
