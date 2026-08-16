import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  REPOSITORY_ROOT,
  Validation,
  finishVerification,
  isMainModule,
  unexpectedFailure,
} from "./lib/verification.mjs";
import { validatePhase15 } from "./verify-phase15.mjs";

export const PHASE16_EVIDENCE_PATH =
  "artifacts/phase16/validation-system-inventory.json";
export const PHASE16_BROWSER_EVIDENCE_PATH =
  "artifacts/phase16/browser-validation-report.json";

const FILES = {
  adr: "docs/adr/0017-validation-inventory-report.md",
  domain: "packages/domain/src/validation.ts",
  metadata: "apps/server/src/metadata/database.ts",
  inventory: "apps/server/src/validation/feature-inventory.ts",
  service: "apps/server/src/validation/validation-service.ts",
  routes: "apps/server/src/routes/validation.ts",
  serverApp: "apps/server/src/app.ts",
  serverTest: "apps/server/test/integration/validation-report.test.ts",
  webApi: "apps/web/src/services/validation-api.ts",
  report: "apps/web/src/features/validation/ValidationReport.tsx",
  app: "apps/web/src/App.tsx",
  webTest: "apps/web/src/features/validation/ValidationReport.test.tsx",
  traceability: "docs/requirement-traceability.json",
  status: "docs/implementation-status.md",
};

async function sources(root) {
  return Object.fromEntries(
    await Promise.all(
      Object.entries(FILES).map(async ([key, path]) => [
        key,
        await readFile(resolve(root, path), "utf8"),
      ]),
    ),
  );
}

export function inspectPhase16Contract(source) {
  return {
    adr:
      /Validation inventory and report ownership/u.test(source.adr) &&
      /Fastify's `onRoute`/u.test(source.adr) &&
      /Phase 19/u.test(source.adr),
    levels:
      /"STATIC"/u.test(source.domain) &&
      /"REFERENCE"/u.test(source.domain) &&
      /"DATABASE"/u.test(source.domain) &&
      /"BINDING"/u.test(source.domain) &&
      /"INVENTORY"/u.test(source.domain),
    inventoryCategories:
      /"REQUIREMENT"/u.test(source.domain) &&
      /"VALIDATION_RULE"/u.test(source.domain) &&
      /"ELEMENT"/u.test(source.domain) &&
      /"LAYOUT_PRESET"/u.test(source.domain) &&
      /"THEME"/u.test(source.domain) &&
      /"API_ROUTE"/u.test(source.domain),
    requirementInventory:
      /length: 37/u.test(source.domain) &&
      /REQUIREMENT_IDS/u.test(source.inventory),
    ruleRegistry:
      /VALIDATION_RULE_IDS/u.test(source.domain) &&
      /PAGE_ROUTE_INVALID/u.test(source.domain) &&
      /BINDING_REFERENCE_BROKEN/u.test(source.domain) &&
      /PHYSICAL_TABLE_MISSING/u.test(source.domain),
    metadataV13:
      /LATEST_METADATA_SCHEMA_VERSION\s*=\s*(?:1[3-9]|[2-9]\d+)/u.test(
        source.metadata,
      ) &&
      /version:\s*13/u.test(source.metadata) &&
      /validation-inventory-report/u.test(source.metadata) &&
      /CREATE TABLE validation_runs/u.test(source.metadata) &&
      /CREATE TABLE validation_run_items/u.test(source.metadata) &&
      /CREATE TABLE validation_commands/u.test(source.metadata),
    inventoryGenerated:
      /ELEMENT_DEFINITIONS\.map/u.test(source.inventory) &&
      /LAYOUT_PRESET_DEFINITIONS\.map/u.test(source.inventory) &&
      /themes\.map/u.test(source.inventory) &&
      /apiRoutes\.map/u.test(source.inventory) &&
      /requiredTests/u.test(source.inventory) &&
      /validation-run:/u.test(source.inventory),
    actualRouteInventory:
      /addHook\("onRoute"/u.test(source.serverApp) &&
      /registeredApiRoutes/u.test(source.serverApp) &&
      /route\.url\.startsWith\("\/api\/v1"\)/u.test(source.serverApp),
    canonicalRoutes:
      /\/api\/v1\/projects\/:projectId\/validate"/u.test(source.routes) &&
      /\/api\/v1\/projects\/:projectId\/validate-inventory/u.test(
        source.routes,
      ) &&
      /\/api\/v1\/projects\/:projectId\/validation-runs\/:runId/u.test(
        source.routes,
      ),
    idempotency:
      /IDEMPOTENCY_PAYLOAD_CONFLICT/u.test(source.service) &&
      /validation_commands/u.test(source.service) &&
      /response_json/u.test(source.service),
    pageValidation:
      /#pageIssues/u.test(source.service) &&
      /PAGE_ROUTE_INVALID/u.test(source.service) &&
      /PAGE_ICON_MISSING/u.test(source.service),
    elementValidation:
      /#elementIssues/u.test(source.service) &&
      /ELEMENT_PAGE_REFERENCE/u.test(source.service) &&
      /ELEMENT_LAYOUT_INVALID/u.test(source.service),
    bindingValidation:
      /#bindingIssues/u.test(source.service) &&
      /BINDING_DIRECTION_INVALID/u.test(source.service) &&
      /BINDING_REFERENCE_BROKEN/u.test(source.service),
    schemaValidation:
      /quick_check/u.test(source.service) &&
      /PHYSICAL_TABLE_MISSING/u.test(source.service) &&
      /PHYSICAL_FIELD_MISSING/u.test(source.service),
    themeValidation:
      /#themeIssues/u.test(source.service) &&
      /THEME_REFERENCE_INVALID/u.test(source.service),
    reportApi:
      /runProjectValidation/u.test(source.webApi) &&
      /listValidationRuns/u.test(source.webApi) &&
      /ValidationApiError/u.test(source.webApi),
    reportUi:
      /ValidationReport/u.test(source.report) &&
      /validation-report-actions/u.test(source.report) &&
      /run\.inventoryVerified/u.test(source.report) &&
      /onNavigate\(issue\.target\)/u.test(source.report),
    deepLinks:
      /ValidationTargetNavigator/u.test(source.app) &&
      /target\.kind === "TABLE"/u.test(source.app) &&
      /target\.kind === "BINDING"/u.test(source.app) &&
      /workspace\.selectElement/u.test(source.app),
    backendBehavior:
      /persists evidence-backed PASS runs/u.test(source.serverTest) &&
      /Broken Page routes, Binding references, and Test DB physical schema/iu.test(
        source.serverTest,
      ) &&
      /PAGE_ROUTE_INVALID/u.test(source.serverTest) &&
      /BINDING_REFERENCE_BROKEN/u.test(source.serverTest) &&
      /PHYSICAL_TABLE_MISSING/u.test(source.serverTest),
    frontendBehavior:
      /loads the latest durable report/u.test(source.webTest) &&
      /navigates from an issue to its Page/u.test(source.webTest) &&
      /sibling action geometry/u.test(source.webTest),
    noClientSql:
      !/\b(?:SELECT|INSERT|UPDATE|DELETE)\s+(?:FROM|INTO|SET|\*)/u.test(
        `${source.webApi}\n${source.report}\n${source.app}`,
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

export function inspectPhase16BrowserEvidence(evidence) {
  return {
    metadata:
      evidence?.schemaVersion === 1 &&
      evidence?.result === "PASS" &&
      evidence?.target === "isolated local browser session" &&
      /^http:\/\/127\.0\.0\.1:\d+\/$/u.test(evidence?.url ?? ""),
    desktop:
      evidence?.viewport?.width === 1280 && evidence?.viewport?.height === 720,
    inventory:
      evidence?.inventory?.required > 200 &&
      evidence?.inventory?.required === evidence?.inventory?.verified &&
      evidence?.inventory?.missingTestReference === 0 &&
      evidence?.inventory?.missingEvidence === 0,
    detection: [
      "PAGE_ROUTE_INVALID",
      "BINDING_REFERENCE_BROKEN",
      "PHYSICAL_TABLE_MISSING",
    ].every((rule) => evidence?.detection?.ruleIds?.includes(rule)),
    navigation:
      evidence?.navigation?.clickedRuleId === "PAGE_ROUTE_INVALID" &&
      evidence?.navigation?.editorStep === "page" &&
      evidence?.navigation?.targetSelected === true,
    durable:
      evidence?.durable?.runId?.length > 0 &&
      evidence?.durable?.sameRunAfterReload === true,
    geometry: equalRects(evidence?.geometry?.actionRects, 2),
    mobile:
      evidence?.responsive419?.viewportWidth === 419 &&
      evidence?.responsive419?.documentScrollWidth === 419 &&
      evidence?.responsive419?.reportReachable === true &&
      evidence?.responsive419?.siblingGeometryPreserved === true,
    clean:
      evidence?.consoleErrorCount === 0 && evidence?.failedRequestCount === 0,
  };
}

export async function validatePhase16({
  repositoryRoot = REPOSITORY_ROOT,
  includeBrowserEvidence = true,
  includePhase15Regression = true,
  includeGovernance = true,
} = {}) {
  const validation = new Validation("Phase 16 Validation System Inventory");
  const source = await sources(repositoryRoot);
  const inspection = inspectPhase16Contract(source);
  for (const [name, value] of Object.entries(inspection)) {
    validation.check(value === true, `Phase 16 contract failed: ${name}`);
  }

  const inventoryTestReferences = [
    ...source.inventory.matchAll(
      /"((?:apps\/server\/test\/(?:integration|unit)|tests\/validation)\/[^"\n]+\.test\.(?:ts|mjs))"/gu,
    ),
  ].map((match) => match[1]);
  const invalidTestReferences = [];
  for (const testReference of new Set(inventoryTestReferences)) {
    try {
      await readFile(resolve(repositoryRoot, testReference));
    } catch {
      invalidTestReferences.push(testReference);
    }
  }
  validation.check(
    inventoryTestReferences.length > 0 && invalidTestReferences.length === 0,
    "Phase 16 inventory Test References must resolve to repository tests",
    { invalidTestReferences },
  );

  let browserInspection = {};
  if (includeBrowserEvidence) {
    try {
      browserInspection = inspectPhase16BrowserEvidence(
        JSON.parse(
          await readFile(
            resolve(repositoryRoot, PHASE16_BROWSER_EVIDENCE_PATH),
            "utf8",
          ),
        ),
      );
      for (const [name, value] of Object.entries(browserInspection)) {
        validation.check(value === true, `Phase 16 browser failed: ${name}`);
      }
    } catch (error) {
      validation.check(false, "Phase 16 browser evidence is missing", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (includeGovernance) {
    const requirement = JSON.parse(source.traceability).requirements.find(
      ({ id }) => id === "REQ-031",
    );
    validation.check(
      requirement?.status === "IN PROGRESS" &&
        requirement.implementation.includes(
          "apps/server/src/validation/validation-service.ts",
        ) &&
        requirement.tests.includes("scripts/verify-phase16.mjs") &&
        requirement.evidence.includes(PHASE16_EVIDENCE_PATH),
      "Phase 16 foundation traceability is incomplete",
    );
    validation.check(
      /### PHASE 16 — Validation System/u.test(source.status) &&
        /State: `VERIFIED`/u.test(source.status) &&
        /## Phase 16 evidence/u.test(source.status) &&
        source.status.includes(PHASE16_EVIDENCE_PATH) &&
        source.status.includes(PHASE16_BROWSER_EVIDENCE_PATH),
      "Phase 16 implementation status is incomplete",
    );
  }

  let phase15Regression = "NOT_RUN";
  if (includePhase15Regression) {
    const previous = await validatePhase15({
      repositoryRoot,
      includeBrowserEvidence: false,
      includePhase14Regression: false,
      includeGovernance: false,
    });
    phase15Regression = previous.result;
    validation.check(
      previous.result === "PASS",
      "Phase 15 regression must remain green",
      { failures: previous.failures },
    );
  }

  return validation.result({
    inspection,
    browserInspection,
    phase15Regression,
    browserEvidencePath: PHASE16_BROWSER_EVIDENCE_PATH,
  });
}

if (isMainModule(import.meta.url)) {
  try {
    await finishVerification(PHASE16_EVIDENCE_PATH, await validatePhase16());
  } catch (error) {
    await finishVerification(
      PHASE16_EVIDENCE_PATH,
      unexpectedFailure("Phase 16 Validation System Inventory", error),
    );
  }
}
