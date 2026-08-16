import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  REPOSITORY_ROOT,
  Validation,
  finishVerification,
  isMainModule,
  unexpectedFailure,
} from "./lib/verification.mjs";
import { validatePhase13 } from "./verify-phase13.mjs";

export const PHASE14_EVIDENCE_PATH =
  "artifacts/phase14/project-variable-navigation-validation.json";
export const PHASE14_BROWSER_EVIDENCE_PATH =
  "artifacts/phase14/browser-project-variable-navigation-validation.json";

const FILES = Object.freeze({
  adr: "docs/adr/0015-project-variable-navigation.md",
  domain: "packages/domain/src/project-variable.ts",
  runtimeDomain: "packages/domain/src/runtime.ts",
  elementDomain: "packages/domain/src/element.ts",
  metadata: "apps/server/src/metadata/database.ts",
  variableService: "apps/server/src/runtime/project-variable-service.ts",
  variableRoutes: "apps/server/src/routes/project-variables.ts",
  dependencyCompiler:
    "apps/server/src/data-relationship/binding-dependency-compiler.ts",
  relationshipService:
    "apps/server/src/data-relationship/relationship-service.ts",
  runtimeService: "apps/server/src/runtime/runtime-definition-service.ts",
  queryCompiler: "apps/server/src/data-relationship/binding-query-compiler.ts",
  relationshipCanvas:
    "apps/web/src/features/data-relationship/RelationshipCanvas.tsx",
  runtime: "apps/web/src/features/runtime/PublishedRuntime.tsx",
  runtimeRenderer: "apps/web/src/features/runtime/RuntimeElementRenderer.tsx",
  backendTest:
    "apps/server/test/integration/project-variable-navigation.test.ts",
  relationshipTest:
    "apps/web/src/features/data-relationship/RelationshipCanvas.test.tsx",
  runtimeTest: "apps/web/src/features/runtime/PublishedRuntime.test.tsx",
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

export function inspectPhase14Contract(source) {
  const browser = `${source.relationshipCanvas}\n${source.runtime}\n${source.runtimeRenderer}`;
  return {
    adr:
      /Project Variable Navigation/u.test(source.adr) &&
      /URL_QUERY/u.test(source.adr) &&
      /SESSION_STATE/u.test(source.adr) &&
      /Back\/Forward/u.test(source.adr),
    variableInventory:
      /PROJECT_VARIABLE_TYPES\s*=\s*\[/u.test(source.domain) &&
      /"string"/u.test(source.domain) &&
      /"number"/u.test(source.domain) &&
      /"boolean"/u.test(source.domain) &&
      /"date"/u.test(source.domain) &&
      /"datetime"/u.test(source.domain) &&
      /PROJECT_VARIABLE_TRANSPORTS/u.test(source.domain),
    immutableSnapshot:
      /variables\?/u.test(source.runtimeDomain) &&
      /actionChains\?/u.test(source.runtimeDomain) &&
      /RuntimeActionChainDto/u.test(source.runtimeDomain),
    rowSelectionPort:
      /id:\s*"selection"/u.test(source.elementDomain) &&
      /valueType:\s*"record"/u.test(source.elementDomain),
    metadataV11:
      /LATEST_METADATA_SCHEMA_VERSION\s*=\s*(?:1[1-9]|[2-9]\d+)/u.test(
        source.metadata,
      ) &&
      /name:\s*"project-variable-navigation"[\s\S]{0,160}version:\s*11/u.test(
        source.metadata,
      ) &&
      /CREATE TABLE project_variables/u.test(source.metadata) &&
      /CREATE TABLE project_variable_commands/u.test(source.metadata) &&
      /sensitive = 0 OR transport = 'SESSION_STATE'/u.test(source.metadata),
    variableCrud:
      /VARIABLE_KEY_CONFLICT/u.test(source.variableService) &&
      /VARIABLE_IN_USE/u.test(source.variableService) &&
      /IDEMPOTENCY_PAYLOAD_CONFLICT/u.test(source.variableService) &&
      /\/api\/v1\/projects\/:projectId\/variables/u.test(
        source.variableRoutes,
      ) &&
      /\/api\/v1\/variables\/:variableId/u.test(source.variableRoutes),
    dependencyCompilation:
      /DEPENDENCY_SOURCE_MUST_BE_DATA_TABLE/u.test(source.dependencyCompiler) &&
      /DEPENDENCY_SOURCE_READ_REQUIRED/u.test(source.dependencyCompiler) &&
      /DEPENDENCY_TARGET_READ_INVALID/u.test(source.dependencyCompiler) &&
      /VARIABLE_FIELD_TYPE_MISMATCH/u.test(source.dependencyCompiler) &&
      /VARIABLE_TRANSPORT_MISMATCH/u.test(source.dependencyCompiler),
    filterAndNavigateBindings:
      /dependencyType/u.test(source.relationshipService) &&
      /compileDefinition/u.test(source.relationshipService) &&
      /"FILTER"/u.test(source.relationshipService) &&
      /"NAVIGATE"/u.test(source.relationshipService),
    boundRuntimeFilter:
      /UNSUPPORTED_BINDING_PARAMETER/u.test(source.runtimeService) &&
      /RUNTIME_VARIABLE_REQUIRED/u.test(source.runtimeService) &&
      /runtimeFilters/u.test(source.runtimeService) &&
      /compileStored[\s\S]*runtimeFilters/u.test(source.runtimeService) &&
      /filters:\s*\[\.\.\.storedFilters,\s*\.\.\.runtimeFilters\]/u.test(
        source.queryCompiler,
      ),
    editorRegistry:
      /projectVariablesApi\.list/u.test(source.relationshipCanvas) &&
      /projectVariablesApi\.create/u.test(source.relationshipCanvas) &&
      /dependencyConfiguration/u.test(source.relationshipCanvas) &&
      /binding-dependency-source-field/u.test(source.relationshipCanvas),
    runtimeNavigation:
      /runtimeVariableParameters/u.test(source.runtime) &&
      /v\.\$\{variable\.key\}/u.test(source.runtime) &&
      /webeditorVariables/u.test(source.runtime) &&
      /targetReadBindingId === binding\.id/u.test(source.runtime),
    accessibleSelection:
      /aria-selected/u.test(source.runtimeRenderer) &&
      /event\.key !== "Enter" && event\.key !== " "/u.test(
        source.runtimeRenderer,
      ) &&
      /onRowSelect/u.test(source.runtimeRenderer),
    backendBehavior:
      /selects one Data Table value, navigates, and executes only the declared filtered READ/u.test(
        source.backendTest,
      ) &&
      /UNSUPPORTED_BINDING_PARAMETER/u.test(source.backendTest) &&
      /exact delete replay/u.test(source.backendTest),
    frontendBehavior:
      /creates a typed Variable and sends only its canonical Data Table selection Navigation dependency/u.test(
        source.relationshipTest,
      ) &&
      /selects a Data Table row, navigates with a typed URL Variable, filters the target Chart, and restores browser history/u.test(
        source.runtimeTest,
      ),
    noBrowserSql:
      !/\b(?:SELECT|INSERT|UPDATE|DELETE)\s+(?:FROM|INTO|SET|\*)/u.test(
        browser,
      ) && !/(?:physicalTable|physicalField|rawSql)/u.test(browser),
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

export function inspectPhase14BrowserEvidence(evidence) {
  const chain = evidence?.actionChain;
  const history = evidence?.history;
  return {
    metadata:
      evidence?.schemaVersion === 1 &&
      evidence?.result === "PASS" &&
      evidence?.target === "isolated local browser session" &&
      /^http:\/\/127\.0\.0\.1:\d+\/$/u.test(evidence?.url ?? ""),
    desktop:
      evidence?.viewport?.width === 1280 && evidence?.viewport?.height === 720,
    variableRegistry:
      evidence?.variableRegistry?.visibleCount >= 1 &&
      evidence?.variableRegistry?.key === "selected_value" &&
      evidence?.variableRegistry?.valueType === "number" &&
      evidence?.variableRegistry?.transport === "URL_QUERY",
    equalControls:
      equalRects(evidence?.variableRegistry?.toolbarRects, 5) &&
      equalRects(evidence?.variableRegistry?.dialogActionRects, 2),
    actionChain:
      chain?.sourceRowValue !== null &&
      chain?.targetRoute === "/analysis" &&
      chain?.queryKey === "v.selected_value" &&
      chain?.filteredRowCount === 1 &&
      chain?.rawFieldIdUsed === true,
    history:
      history?.backRoute === "/lots" &&
      history?.forwardRoute === "/analysis" &&
      history?.deepLinkRoute === "/analysis" &&
      history?.deepLinkFilteredRowCount === 1,
    mobile:
      evidence?.responsive419?.viewportWidth === 419 &&
      evidence?.responsive419?.documentScrollWidth === 419 &&
      evidence?.responsive419?.navigationReachable === true &&
      evidence?.responsive419?.selectedChartReachable === true,
    clean:
      evidence?.consoleErrorCount === 0 && evidence?.failedRequestCount === 0,
  };
}

export async function validatePhase14({
  repositoryRoot = REPOSITORY_ROOT,
  includeBrowserEvidence = true,
  includePhase13Regression = true,
  includeGovernance = true,
} = {}) {
  const validation = new Validation("Phase 14 Project Variable Navigation");
  const source = await sources(repositoryRoot);
  const inspection = inspectPhase14Contract(source);
  for (const [name, value] of Object.entries(inspection)) {
    validation.check(value === true, `Phase 14 contract failed: ${name}`);
  }

  let browserInspection = {};
  if (includeBrowserEvidence) {
    try {
      browserInspection = inspectPhase14BrowserEvidence(
        JSON.parse(
          await readFile(
            resolve(repositoryRoot, PHASE14_BROWSER_EVIDENCE_PATH),
            "utf8",
          ),
        ),
      );
      for (const [name, value] of Object.entries(browserInspection)) {
        validation.check(value === true, `Phase 14 browser failed: ${name}`);
      }
    } catch (error) {
      validation.check(false, "Phase 14 browser evidence is missing", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (includeGovernance) {
    validation.check(
      /## Phase 14 evidence/u.test(source.status) &&
        source.status.includes(PHASE14_EVIDENCE_PATH) &&
        source.status.includes(PHASE14_BROWSER_EVIDENCE_PATH),
      "Phase 14 implementation status evidence is incomplete",
    );
    validation.check(
      source.traceability.includes("scripts/verify-phase14.mjs") &&
        source.traceability.includes(PHASE14_EVIDENCE_PATH) &&
        source.traceability.includes(PHASE14_BROWSER_EVIDENCE_PATH),
      "Phase 14 traceability is incomplete",
    );
  }

  let phase13Regression = "NOT_RUN";
  if (includePhase13Regression) {
    const previous = await validatePhase13({ repositoryRoot });
    phase13Regression = previous.result;
    validation.check(
      previous.result === "PASS",
      "Phase 0–13 regression must remain green",
      { failures: previous.failures },
    );
  }

  return validation.result({
    inspection,
    browserInspection,
    phase13Regression,
    browserEvidencePath: PHASE14_BROWSER_EVIDENCE_PATH,
  });
}

if (isMainModule(import.meta.url)) {
  try {
    await finishVerification(PHASE14_EVIDENCE_PATH, await validatePhase14());
  } catch (error) {
    await finishVerification(
      PHASE14_EVIDENCE_PATH,
      unexpectedFailure("Phase 14 Project Variable Navigation", error),
    );
  }
}
