import {
  Validation,
  finishVerification,
  isMainModule,
  isPlainObject,
  readJson,
  readRepositoryFile,
  sha256,
  unexpectedFailure,
  validateExactSet,
} from "./lib/verification.mjs";

const EXPECTED_FILE_SHA256 =
  "fcbd357c5fe98b21c80ba26e96337864d08c3561849e1300109820ec62680fce";
const EXPECTED_MANIFEST_SHA256 =
  "c5b07adde2715c4a2977b13287ce670eec1b6d33277d8199c78d45edfa3e57bb";
const EXPECTED_DISTRIBUTION = Object.freeze({
  minimal: 10,
  dashboard: 20,
  statistics: 20,
  crud: 15,
  navigation: 15,
  "complex-graph": 10,
  accessibility: 5,
  "stress-recovery": 5,
});
const COVERAGE_FIELDS = Object.freeze([
  { values: "themes", count: "themeCount", expected: 60 },
  { values: "pageTypes", count: "pageTypeCount", expected: 12 },
  { values: "layoutPresets", count: "layoutPresetCount", expected: 22 },
  { values: "elementTypes", count: "elementTypeCount", expected: 55 },
  { values: "bindingTypes", count: "bindingTypeCount", expected: 11 },
]);
const PROJECT_LIST_FIELDS = Object.freeze([
  "pageTypes",
  "layoutPresets",
  "elementTypes",
  "bindingTypes",
  "requiredScenarios",
  "specialScenarios",
]);
const SCALE_FIELDS = Object.freeze([
  "pageCount",
  "elementCount",
  "nodeCount",
  "tableCount",
  "runtimeRowCount",
]);

export async function validateCorpus() {
  const validation = new Validation("100-project corpus manifest");
  const source = await readRepositoryFile("webeditor_project_corpus_v3.json");
  validation.equal(
    sha256(source),
    EXPECTED_FILE_SHA256,
    "Corpus source artifact SHA-256 matches",
  );

  const [manifest, themeManifest] = await Promise.all([
    readJson("webeditor_project_corpus_v3.json"),
    readJson("webeditor_theme_presets_v3.json"),
  ]);
  validation.check(
    isPlainObject(manifest),
    "Corpus manifest root is an object",
  );
  validation.equal(
    manifest.schemaVersion,
    "1.0.0",
    "Corpus schema version is 1.0.0",
  );
  validation.equal(
    manifest.manifestSha256,
    EXPECTED_MANIFEST_SHA256,
    "Corpus manifest identity hash is pinned",
  );
  validation.equal(
    manifest.projectCount,
    100,
    "Declared project count is exactly 100",
  );

  const projects = Array.isArray(manifest.projects) ? manifest.projects : [];
  validation.check(Array.isArray(manifest.projects), "projects is an array");
  validation.equal(
    projects.length,
    100,
    "Corpus contains exactly 100 projects",
  );
  validation.equal(
    projects.length,
    manifest.projectCount,
    "Declared and actual project counts agree",
  );

  const actualDistribution = Object.fromEntries(
    Object.keys(EXPECTED_DISTRIBUTION).map((category) => [category, 0]),
  );
  const identities = {
    corpusId: [],
    projectId: [],
    displayName: [],
    structureFingerprint: [],
    projectSentinel: [],
    runtimeRowSentinel: [],
  };
  const actualCoverage = Object.fromEntries(
    COVERAGE_FIELDS.map(({ values }) => [values, new Set()]),
  );
  const declaredCoverage = isPlainObject(manifest.coverage)
    ? manifest.coverage
    : {};

  for (const [index, project] of projects.entries()) {
    const ordinal = index + 1;
    const expectedCorpusId = `CORPUS-${String(ordinal).padStart(3, "0")}`;
    const expectedProjectId = `test-project-${String(ordinal).padStart(3, "0")}`;
    const label = project?.corpusId ?? `project ${ordinal}`;
    validation.check(isPlainObject(project), `${label} is an object`);
    validation.equal(
      project?.corpusId,
      expectedCorpusId,
      `${label} has the canonical corpus ID`,
    );
    validation.equal(
      project?.projectId,
      expectedProjectId,
      `${label} has the canonical project ID`,
    );
    validation.check(
      typeof project?.displayName === "string" &&
        project.displayName.trim().length > 0,
      `${label} has a display name`,
    );
    validation.check(
      Object.hasOwn(EXPECTED_DISTRIBUTION, project?.category),
      `${label} has a valid category`,
      {
        category: project?.category,
      },
    );
    if (Object.hasOwn(actualDistribution, project?.category)) {
      actualDistribution[project.category] += 1;
    }

    identities.corpusId.push(project?.corpusId);
    identities.projectId.push(project?.projectId);
    identities.displayName.push(project?.displayName);
    identities.structureFingerprint.push(project?.structureFingerprint);
    identities.projectSentinel.push(project?.sentinels?.project);
    identities.runtimeRowSentinel.push(project?.sentinels?.runtimeRow);
    validation.check(
      /^[0-9a-f]{64}$/u.test(project?.structureFingerprint ?? ""),
      `${label} structure fingerprint is SHA-256 shaped`,
    );
    validation.check(
      typeof project?.sentinels?.project === "string" &&
        project.sentinels.project.length > 0,
      `${label} has a project sentinel`,
    );
    validation.check(
      typeof project?.sentinels?.runtimeRow === "string" &&
        project.sentinels.runtimeRow.length > 0,
      `${label} has a runtime-row sentinel`,
    );

    validation.check(
      isPlainObject(project?.scale),
      `${label}.scale is an object`,
    );
    for (const scaleField of SCALE_FIELDS) {
      validation.check(
        Number.isInteger(project?.scale?.[scaleField]) &&
          project.scale[scaleField] > 0,
        `${label}.scale.${scaleField} is a positive integer`,
        { value: project?.scale?.[scaleField] },
      );
    }

    for (const field of PROJECT_LIST_FIELDS) {
      validation.check(
        Array.isArray(project?.[field]),
        `${label}.${field} is an array`,
      );
      const values = Array.isArray(project?.[field]) ? project[field] : [];
      validation.equal(
        values.length,
        new Set(values).size,
        `${label}.${field} has no duplicates`,
      );
      if (Object.hasOwn(actualCoverage, field)) {
        for (const value of values) {
          actualCoverage[field].add(value);
          validation.check(
            (declaredCoverage[field] ?? []).includes(value),
            `${label}.${field} value is declared by corpus coverage`,
            { value },
          );
        }
      }
    }
    actualCoverage.themes.add(project?.themeId);
  }

  for (const [category, expectedCount] of Object.entries(
    EXPECTED_DISTRIBUTION,
  )) {
    validation.equal(
      actualDistribution[category],
      expectedCount,
      `${category} actual count is ${expectedCount}`,
    );
    validation.equal(
      manifest.categoryDistribution?.[category],
      expectedCount,
      `${category} declared count is ${expectedCount}`,
    );
  }
  validateExactSet(
    validation,
    Object.keys(manifest.categoryDistribution ?? {}),
    Object.keys(EXPECTED_DISTRIBUTION),
    "Category distribution keys",
  );

  for (const [field, values] of Object.entries(identities)) {
    validation.equal(
      values.length,
      new Set(values).size,
      `${field} values are unique`,
    );
  }

  for (const {
    values: field,
    count: countField,
    expected,
  } of COVERAGE_FIELDS) {
    const declaredValues = Array.isArray(declaredCoverage[field])
      ? declaredCoverage[field]
      : [];
    validation.equal(
      declaredCoverage[countField],
      expected,
      `${countField} is exactly ${expected}`,
    );
    validation.equal(
      declaredValues.length,
      expected,
      `${field} declares exactly ${expected} values`,
    );
    validateExactSet(
      validation,
      declaredValues,
      [...actualCoverage[field]],
      `${field} declared/actual coverage`,
    );
  }

  const themeIds = (themeManifest.themes ?? []).map((theme) => theme.id);
  validation.equal(
    themeIds.length,
    60,
    "Theme foreign-key source contains exactly 60 themes",
  );
  validateExactSet(
    validation,
    declaredCoverage.themes ?? [],
    themeIds,
    "Corpus theme foreign keys",
  );
  for (const project of projects) {
    validation.check(
      themeIds.includes(project?.themeId),
      `${project?.corpusId ?? "project"}.themeId references a provided theme`,
      { themeId: project?.themeId },
    );
  }

  validation.check(
    projects.filter((project) => project?.scale?.pageCount >= 20).length >= 10,
    "At least 10 projects contain 20 or more pages",
  );
  validation.check(
    projects.filter((project) => project?.scale?.elementCount >= 100).length >=
      10,
    "At least 10 projects contain 100 or more elements",
  );
  validation.check(
    projects.filter((project) => project?.scale?.nodeCount >= 100).length >= 5,
    "At least 5 projects contain 100 or more nodes",
  );
  validation.equal(
    manifest.globalAcceptance?.requiredProjectPass,
    "100/100",
    "Acceptance requires 100/100 projects",
  );
  for (const field of [
    "crossProjectSentinelLeaks",
    "orphanRecordsOrFiles",
    "requiredSkippedTests",
    "requiredExpectedFailures",
    "criticalConsoleErrors",
  ]) {
    validation.equal(
      manifest.globalAcceptance?.[field],
      0,
      `Acceptance requires ${field} to be zero`,
    );
  }

  return validation.result({
    projectCount: projects.length,
    categoryDistribution: actualDistribution,
    uniqueCorpusIds: new Set(identities.corpusId).size,
    uniqueProjectIds: new Set(identities.projectId).size,
    uniqueFingerprints: new Set(identities.structureFingerprint).size,
    coverage: Object.fromEntries(
      Object.entries(actualCoverage).map(([field, values]) => [
        field,
        values.size,
      ]),
    ),
    scaleThresholds: {
      pageCountAtLeast20: projects.filter(
        (project) => project?.scale?.pageCount >= 20,
      ).length,
      elementCountAtLeast100: projects.filter(
        (project) => project?.scale?.elementCount >= 100,
      ).length,
      nodeCountAtLeast100: projects.filter(
        (project) => project?.scale?.nodeCount >= 100,
      ).length,
    },
  });
}

async function main() {
  try {
    await finishVerification(
      "artifacts/phase0/corpus-manifest-validation.json",
      await validateCorpus(),
    );
  } catch (error) {
    await finishVerification(
      "artifacts/phase0/corpus-manifest-validation.json",
      unexpectedFailure("100-project corpus manifest", error),
    );
  }
}

if (isMainModule(import.meta.url)) {
  await main();
}
