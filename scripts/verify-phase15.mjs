import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  REPOSITORY_ROOT,
  Validation,
  finishVerification,
  isMainModule,
  unexpectedFailure,
} from "./lib/verification.mjs";
import { validatePhase14 } from "./verify-phase14.mjs";

export const PHASE15_EVIDENCE_PATH =
  "artifacts/phase15/theme-revision-runtime-validation.json";
export const PHASE15_BROWSER_EVIDENCE_PATH =
  "artifacts/phase15/browser-theme-revision-runtime-validation.json";

const FILES = Object.freeze({
  adr: "docs/adr/0016-theme-revision-runtime-policy.md",
  themeDomain: "packages/theme-core/src/theme-revision.ts",
  themeCore: "packages/theme-core/src/theme.ts",
  metadata: "apps/server/src/metadata/database.ts",
  service: "apps/server/src/themes/theme-revision-service.ts",
  routes: "apps/server/src/routes/themes.ts",
  appServer: "apps/server/src/app.ts",
  editor: "apps/web/src/App.tsx",
  picker: "apps/web/src/ThemePicker.tsx",
  runtime: "apps/web/src/features/runtime/PublishedRuntime.tsx",
  preference: "apps/web/src/features/runtime/runtime-theme.ts",
  webApi: "apps/web/src/services/themes-api.ts",
  backendTest: "apps/server/test/integration/theme-revision-runtime.test.ts",
  frontendTest: "apps/web/src/features/runtime/runtime-theme.test.tsx",
  traceability: "docs/requirement-traceability.json",
  status: "docs/implementation-status.md",
});

async function sources(repositoryRoot) {
  return Object.fromEntries(
    await Promise.all(
      Object.entries(FILES).map(async ([key, path]) => [
        key,
        await readFile(resolve(repositoryRoot, path), "utf8"),
      ]),
    ),
  );
}

export function inspectPhase15Contract(source) {
  return {
    adr:
      /Theme revision and runtime preference ownership/u.test(source.adr) &&
      /webeditor\.runtime\.theme\.v3\.<projectId>/u.test(source.adr) &&
      /three seconds/u.test(source.adr),
    statuses:
      /"DRAFT"/u.test(source.themeDomain) &&
      /"VALIDATING"/u.test(source.themeDomain) &&
      /"VALID"/u.test(source.themeDomain) &&
      /"INVALID"/u.test(source.themeDomain) &&
      /"PUBLISHED"/u.test(source.themeDomain) &&
      /"SUPERSEDED"/u.test(source.themeDomain),
    inventory:
      /canonicalThemes/u.test(source.themeCore) &&
      /additionalThemes/u.test(source.themeCore) &&
      /themes\s*=\s*\[\.\.\.canonicalThemes, \.\.\.additionalThemes\]/u.test(
        source.themeCore,
      ),
    metadataV12:
      /LATEST_METADATA_SCHEMA_VERSION\s*=\s*(?:1[2-9]|[2-9]\d+)/u.test(
        source.metadata,
      ) &&
      /CREATE TABLE theme_revisions/u.test(source.metadata) &&
      /CREATE TABLE project_theme_settings/u.test(source.metadata) &&
      /CREATE TABLE theme_revision_commands/u.test(source.metadata) &&
      /runtime_theme_version/u.test(source.metadata) &&
      /theme-revision-runtime-policy/u.test(source.metadata),
    routes:
      /\/api\/v1\/themes\/presets/u.test(source.routes) &&
      /theme-revisions/u.test(source.routes) &&
      /\["validate", "publish", "rollback"\]/u.test(source.routes) &&
      /runtime-theme-policy/u.test(source.routes) &&
      /theme-manifest/u.test(source.routes) &&
      /registerThemeRoutes/u.test(source.appServer),
    validation:
      /THEME_TOKEN_NAMES/u.test(source.service) &&
      /THEME_TOKEN_SCHEMA_INVALID/u.test(source.service) &&
      /THEME_CONTRAST_INVALID/u.test(source.service) &&
      /contrastValid/u.test(source.service) &&
      /smokeValid/u.test(source.service),
    safeActivation:
      /#supersedePublished/u.test(source.service) &&
      /#activate/u.test(source.service) &&
      /auto_apply_theme_to_runtime/u.test(source.service) &&
      /runtime_theme_version = runtime_theme_version \+ 1/u.test(
        source.service,
      ) &&
      /IDEMPOTENCY_PAYLOAD_CONFLICT/u.test(source.service),
    manifestFallback:
      /validPublished/u.test(source.service) &&
      /findTheme\(settings\.default_theme_preset_id\)/u.test(source.service) &&
      /fallbackThemeId/u.test(source.service) &&
      /allowedThemeIds/u.test(source.service),
    editorFlow:
      /createThemeRevision/u.test(source.editor) &&
      /validateThemeRevision/u.test(source.editor) &&
      /저장 중/u.test(source.editor) &&
      /검증 중/u.test(source.editor) &&
      /적용됨/u.test(source.editor),
    runtimePreference:
      /webeditor\.runtime\.theme\.v3\./u.test(source.preference) &&
      /localStorage/u.test(source.preference) &&
      /memoryPreferences/u.test(source.preference) &&
      /runtimeThemePreferenceIsAllowed/u.test(source.preference),
    runtimePicker:
      /availableThemes/u.test(source.picker) &&
      /프로젝트 기본값/u.test(source.picker) &&
      /allowedThemeIds/u.test(source.runtime) &&
      /사용자 테마/u.test(source.runtime),
    pollingNoRemount:
      /setInterval/u.test(source.runtime) &&
      /3_000/u.test(source.runtime) &&
      /payload\.version >= current\.version/u.test(source.runtime) &&
      /data-theme-revision/u.test(source.runtime) &&
      /themeTokensToCssVariables/u.test(source.runtime),
    backendBehavior:
      /publishes only validated Drafts/u.test(source.backendTest) &&
      /keeps the old pointer on failure/u.test(source.backendTest) &&
      /explicit publish, rollback, allowed-theme policy, and restart persistence/u.test(
        source.backendTest,
      ) &&
      /exactly 120 immutable preset choices/u.test(source.backendTest),
    frontendBehavior:
      /keeps profiles independent/u.test(source.frontendTest) &&
      /without remounting/u.test(source.frontendTest) &&
      /falls back when removed/u.test(source.frontendTest) &&
      /RUNTIME_THEME_PREFERENCE_PREFIX/u.test(source.frontendTest),
    noClientTokensFromNetworkCode:
      !/\b(?:SELECT|INSERT|UPDATE|DELETE)\s+(?:FROM|INTO|SET|\*)/u.test(
        `${source.runtime}\n${source.preference}\n${source.webApi}`,
      ),
  };
}

function equalRects(rects, count) {
  return (
    Array.isArray(rects) &&
    rects.length === count &&
    rects.every(
      (rect) =>
        rect?.width > 0 &&
        rect?.height > 0 &&
        Math.abs(rect.width - rects[0].width) <= 0.02 &&
        Math.abs(rect.height - rects[0].height) <= 0.02,
    )
  );
}

export function inspectPhase15BrowserEvidence(evidence) {
  return {
    metadata:
      evidence?.schemaVersion === 1 &&
      evidence?.result === "PASS" &&
      evidence?.target === "isolated local browser session" &&
      /^http:\/\/127\.0\.0\.1:\d+\/$/u.test(evidence?.url ?? ""),
    desktop:
      evidence?.viewport?.width === 1280 && evidence?.viewport?.height === 720,
    editorRevision:
      evidence?.editorRevision?.draftStatus === "DRAFT" &&
      evidence?.editorRevision?.validatedStatus === "PUBLISHED" &&
      evidence?.editorRevision?.runtimeApplied === true &&
      evidence?.editorRevision?.runtimeVersionAfter >
        evidence?.editorRevision?.runtimeVersionBefore,
    runtimePolling:
      evidence?.runtimePolling?.beforeThemeId !==
        evidence?.runtimePolling?.afterThemeId &&
      evidence?.runtimePolling?.afterRevisionId?.length > 0 &&
      evidence?.runtimePolling?.samePageNode === true &&
      evidence?.runtimePolling?.fullPageReloadCount === 0,
    preference:
      evidence?.preference?.storageKey?.startsWith(
        "webeditor.runtime.theme.v3.",
      ) &&
      evidence?.preference?.sameProfileRetained === true &&
      evidence?.preference?.allowedOnly === true &&
      evidence?.preference?.removedThemeFallback === true &&
      evidence?.preference?.projectDefaultRestored === true,
    geometry:
      equalRects(evidence?.geometry?.runtimeHeaderControlRects, 2) &&
      equalRects(evidence?.geometry?.pickerActionRects, 2),
    mobile:
      evidence?.responsive419?.viewportWidth === 419 &&
      evidence?.responsive419?.documentScrollWidth === 419 &&
      evidence?.responsive419?.pickerReachable === true &&
      evidence?.responsive419?.controlsReachable === true,
    clean:
      evidence?.consoleErrorCount === 0 && evidence?.failedRequestCount === 0,
  };
}

export async function validatePhase15({
  repositoryRoot = REPOSITORY_ROOT,
  includeBrowserEvidence = true,
  includePhase14Regression = true,
  includeGovernance = true,
} = {}) {
  const validation = new Validation("Phase 15 Theme Revision Runtime");
  const source = await sources(repositoryRoot);
  const inspection = inspectPhase15Contract(source);
  for (const [name, value] of Object.entries(inspection)) {
    validation.check(value === true, `Phase 15 contract failed: ${name}`);
  }

  let browserInspection = {};
  if (includeBrowserEvidence) {
    try {
      browserInspection = inspectPhase15BrowserEvidence(
        JSON.parse(
          await readFile(
            resolve(repositoryRoot, PHASE15_BROWSER_EVIDENCE_PATH),
            "utf8",
          ),
        ),
      );
      for (const [name, value] of Object.entries(browserInspection)) {
        validation.check(value === true, `Phase 15 browser failed: ${name}`);
      }
    } catch (error) {
      validation.check(false, "Phase 15 browser evidence is missing", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (includeGovernance) {
    const requirements = JSON.parse(source.traceability).requirements.filter(
      ({ id }) => ["REQ-027", "REQ-028", "REQ-029"].includes(id),
    );
    validation.check(
      requirements.length === 3 &&
        requirements.every(
          (requirement) =>
            requirement.status === "VERIFIED" &&
            requirement.tests.includes("scripts/verify-phase15.mjs") &&
            requirement.evidence.includes(PHASE15_EVIDENCE_PATH) &&
            requirement.evidence.includes(PHASE15_BROWSER_EVIDENCE_PATH),
        ),
      "Phase 15 traceability is incomplete",
    );
    validation.check(
      /## Phase 15 evidence/u.test(source.status) &&
        source.status.includes(PHASE15_EVIDENCE_PATH) &&
        source.status.includes(PHASE15_BROWSER_EVIDENCE_PATH),
      "Phase 15 implementation status evidence is incomplete",
    );
  }

  let phase14Regression = "NOT_RUN";
  if (includePhase14Regression) {
    const previous = await validatePhase14({ repositoryRoot });
    phase14Regression = previous.result;
    validation.check(
      previous.result === "PASS",
      "Phase 0–14 regression must remain green",
      {
        failures: previous.failures,
      },
    );
  }

  return validation.result({
    inspection,
    browserInspection,
    phase14Regression,
    browserEvidencePath: PHASE15_BROWSER_EVIDENCE_PATH,
  });
}

if (isMainModule(import.meta.url)) {
  try {
    await finishVerification(PHASE15_EVIDENCE_PATH, await validatePhase15());
  } catch (error) {
    await finishVerification(
      PHASE15_EVIDENCE_PATH,
      unexpectedFailure("Phase 15 Theme Revision Runtime", error),
    );
  }
}
