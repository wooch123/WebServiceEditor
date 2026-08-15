import {
  Validation,
  finishVerification,
  isMainModule,
  isPlainObject,
  readJson,
  readRepositoryFile,
  repositoryFileSize,
  sha256,
  unexpectedFailure,
  validateExactSet,
} from "./lib/verification.mjs";

const PUBLISHED_ARTIFACTS = Object.freeze([
  {
    path: "webeditor_codex_spec_v3.txt",
    sha256: "e63196785f71e134a895aae2efde9e15954beccf330a4cc7f3cfacebcd18f76b",
    bytes: 216942,
  },
  {
    path: "webeditor_theme_presets_v3.json",
    sha256: "3c015925c48318b25ee1adb61021b924306f07c859efbbbb396bde4c69b2bb98",
    bytes: 172303,
  },
  {
    path: "webeditor_project_corpus_v3.json",
    sha256: "fcbd357c5fe98b21c80ba26e96337864d08c3561849e1300109820ec62680fce",
    bytes: 209800,
  },
  {
    path: "webeditor_v3_change_summary.txt",
    sha256: "904c8477f5cebdc0d21381de0709041e18d0c7da4ed6f98cc3baea5b7eeeee45",
    bytes: 5326,
  },
  {
    path: "source_web_server_design.txt",
    sha256: "f3e3a66dd57e4da7fbc49dc156f3c9b2b43c85593a9e35af3150b6d28c029896",
    bytes: 3099,
  },
]);

const ALLOWED_STATES = new Set([
  "NOT STARTED",
  "IN PROGRESS",
  "BLOCKED",
  "IMPLEMENTED",
  "VERIFIED",
  "EXHAUSTIVELY VERIFIED",
  "OPERATIONALLY VERIFIED",
  "RELEASED",
]);

function parsePublishedChecksumFile(source, validation) {
  const entries = [];
  const lines = source.replace(/^\uFEFF/, "").split(/\r?\n/u);

  for (const [index, line] of lines.entries()) {
    if (!/^[0-9a-f]{64}\s/u.test(line)) {
      continue;
    }
    const match =
      /^(?<hash>[0-9a-f]{64})\s+(?<path>\S+)\s+\((?<bytes>\d+) bytes\)$/u.exec(
        line,
      );
    validation.check(
      Boolean(match),
      `Checksum line ${index + 1} has the published format`,
      {
        line,
      },
    );
    if (match?.groups) {
      entries.push({
        path: match.groups.path,
        sha256: match.groups.hash,
        bytes: Number(match.groups.bytes),
      });
    }
  }
  return entries;
}

export async function validatePhase0() {
  const validation = new Validation("Phase 0 source and traceability baseline");
  const observedArtifacts = [];

  for (const artifact of PUBLISHED_ARTIFACTS) {
    try {
      const contents = await readRepositoryFile(artifact.path);
      const observed = {
        path: artifact.path,
        sha256: sha256(contents),
        bytes: await repositoryFileSize(artifact.path),
      };
      observedArtifacts.push(observed);
      validation.equal(
        observed.sha256,
        artifact.sha256,
        `${artifact.path} SHA-256 matches`,
      );
      validation.equal(
        observed.bytes,
        artifact.bytes,
        `${artifact.path} byte length matches`,
      );
    } catch (error) {
      validation.check(false, `${artifact.path} can be read`, {
        error: error.message,
      });
    }
  }

  const checksumText = (
    await readRepositoryFile("webeditor_codex_spec_v3.sha256.txt")
  ).toString("utf8");
  const publishedEntries = parsePublishedChecksumFile(checksumText, validation);
  validation.equal(
    publishedEntries.length,
    5,
    "Checksum manifest contains exactly five artifacts",
  );
  validateExactSet(
    validation,
    publishedEntries.map((entry) => entry.path),
    PUBLISHED_ARTIFACTS.map((entry) => entry.path),
    "Checksum manifest artifact paths",
  );
  for (const expected of PUBLISHED_ARTIFACTS) {
    const declared = publishedEntries.find(
      (entry) => entry.path === expected.path,
    );
    validation.check(
      Boolean(declared),
      `${expected.path} is declared in checksum manifest`,
    );
    if (declared) {
      validation.equal(
        declared.sha256,
        expected.sha256,
        `${expected.path} published SHA-256 is pinned`,
      );
      validation.equal(
        declared.bytes,
        expected.bytes,
        `${expected.path} published byte length is pinned`,
      );
    }
  }

  const traceability = await readJson("docs/requirement-traceability.json");
  validation.check(
    isPlainObject(traceability),
    "Traceability root is an object",
  );
  validation.equal(
    traceability.schemaVersion,
    1,
    "Traceability schema version is 1",
  );
  validation.check(
    Array.isArray(traceability.requirements),
    "Traceability requirements is an array",
  );

  const requirements = Array.isArray(traceability.requirements)
    ? traceability.requirements
    : [];
  const expectedIds = Array.from(
    { length: 37 },
    (_, index) => `REQ-${String(index + 1).padStart(3, "0")}`,
  );
  validation.equal(
    requirements.length,
    37,
    "Traceability contains exactly 37 entries",
  );
  validateExactSet(
    validation,
    requirements.map((requirement) => requirement?.id),
    expectedIds,
    "Traceability requirement IDs",
  );

  for (const [index, requirement] of requirements.entries()) {
    const label = requirement?.id ?? `entry ${index + 1}`;
    validation.check(isPlainObject(requirement), `${label} is an object`);
    validation.equal(
      requirement?.id,
      expectedIds[index],
      `${label} is in canonical numeric order`,
    );
    validation.check(
      typeof requirement?.title === "string" &&
        requirement.title.trim().length > 0,
      `${label} has a title`,
    );
    validation.check(
      Number.isInteger(requirement?.phase) &&
        requirement.phase >= 0 &&
        requirement.phase <= 23,
      `${label} has a valid phase`,
      { phase: requirement?.phase },
    );
    validation.check(
      ALLOWED_STATES.has(requirement?.status),
      `${label} has an allowed status`,
      {
        status: requirement?.status,
      },
    );
    for (const field of ["implementation", "tests", "evidence"]) {
      validation.check(
        Array.isArray(requirement?.[field]),
        `${label}.${field} is an array`,
      );
    }
  }

  return validation.result({
    artifactCount: observedArtifacts.length,
    artifacts: observedArtifacts,
    traceabilityCount: requirements.length,
    firstRequirementId: requirements.at(0)?.id ?? null,
    lastRequirementId: requirements.at(-1)?.id ?? null,
  });
}

async function main() {
  try {
    await finishVerification(
      "artifacts/phase0/source-and-traceability.json",
      await validatePhase0(),
    );
  } catch (error) {
    await finishVerification(
      "artifacts/phase0/source-and-traceability.json",
      unexpectedFailure("Phase 0 source and traceability baseline", error),
    );
  }
}

if (isMainModule(import.meta.url)) {
  await main();
}
