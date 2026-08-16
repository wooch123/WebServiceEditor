import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  REPOSITORY_ROOT,
  Validation,
  finishVerification,
  isMainModule,
  unexpectedFailure,
} from "./lib/verification.mjs";
import { validatePhase12 } from "./verify-phase12.mjs";

export const PHASE13_EVIDENCE_PATH =
  "artifacts/phase13/crud-binding-runtime-validation.json";
export const PHASE13_BROWSER_EVIDENCE_PATH =
  "artifacts/phase13/browser-crud-binding-validation.json";

const FILES = Object.freeze({
  adr: "docs/adr/0014-transactional-crud-binding-runtime.md",
  domain: "packages/domain/src/binding-query.ts",
  relationshipDomain: "packages/domain/src/data-relationship.ts",
  compiler: "apps/server/src/data-relationship/binding-mutation-compiler.ts",
  relationshipService:
    "apps/server/src/data-relationship/relationship-service.ts",
  runtimeService: "apps/server/src/runtime/runtime-definition-service.ts",
  routes: "apps/server/src/routes/data-relationship.ts",
  backendTest: "apps/server/test/integration/crud-binding-runtime.test.ts",
  relationshipCanvas:
    "apps/web/src/features/data-relationship/RelationshipCanvas.tsx",
  relationshipTest:
    "apps/web/src/features/data-relationship/RelationshipCanvas.test.tsx",
  runtime: "apps/web/src/features/runtime/PublishedRuntime.tsx",
  runtimeRenderer: "apps/web/src/features/runtime/RuntimeElementRenderer.tsx",
  runtimeApi: "apps/web/src/services/runtime-api.ts",
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

export function inspectPhase13Contract(source) {
  const server = `${source.compiler}\n${source.relationshipService}\n${source.runtimeService}`;
  const web = `${source.relationshipCanvas}\n${source.runtime}\n${source.runtimeRenderer}\n${source.runtimeApi}`;
  return {
    adr:
      /Transactional CRUD Binding Runtime/u.test(source.adr) &&
      /IMMEDIATE/u.test(source.adr) &&
      /test\.sqlite/u.test(source.adr) &&
      /production\.sqlite/u.test(source.adr),
    operationInventory:
      /BINDING_MUTATION_OPERATIONS\s*=\s*\[\s*"CREATE",\s*"UPDATE",\s*"DELETE"/u.test(
        source.domain,
      ),
    logicalContract:
      /readonly fieldId:\s*string/u.test(source.domain) &&
      /readonly inputElementId:\s*string/u.test(source.domain) &&
      /readonly mutation\?/u.test(source.relationshipDomain) &&
      !/sql\??:\s*string/u.test(source.domain),
    serverOwnedCompilation:
      /PHYSICAL_TABLE_PATTERN/u.test(source.compiler) &&
      /PHYSICAL_FIELD_PATTERN/u.test(source.compiler) &&
      /compileDefinition/u.test(source.compiler) &&
      /compileStored/u.test(source.compiler),
    preparedStatements:
      /INSERT INTO \$\{tableName\}/u.test(source.compiler) &&
      /UPDATE \$\{tableName\}/u.test(source.compiler) &&
      /DELETE FROM \$\{tableName\}/u.test(source.compiler) &&
      /\.run\(\.\.\./u.test(source.compiler),
    atomicIdempotency:
      /webeditor_runtime_mutation_commands/u.test(source.compiler) &&
      /run\.immediate\(\)/u.test(source.compiler) &&
      /IDEMPOTENCY_PAYLOAD_CONFLICT/u.test(source.compiler),
    errorMapping: [
      "BINDING_MUTATION_VALIDATION_FAILED",
      "BINDING_MUTATION_CONSTRAINT",
      "BINDING_MUTATION_ROW_CONFLICT",
      "BINDING_MUTATION_WRITE_CONFLICT",
    ].every((code) => source.compiler.includes(code)),
    immutableEnvironmentBoundary:
      /executeDraftMutation/u.test(source.runtimeService) &&
      /executePublishedMutation/u.test(source.runtimeService) &&
      /"test"/u.test(source.runtimeService) &&
      /"production"/u.test(source.runtimeService) &&
      /snapshot\.bindings\.find/u.test(source.runtimeService),
    routes:
      /\["CREATE",\s*"UPDATE",\s*"DELETE"\]/u.test(source.routes) &&
      source.routes.includes(
        "`/api/v1/runtime/:projectId/${route}/:bindingId`",
      ) &&
      source.routes.includes(
        "`/api/v1/draft-previews/:previewId/${route}/:bindingId`",
      ),
    relationshipWizard:
      /mutationConfiguration/u.test(source.relationshipCanvas) &&
      /writeFieldMappings/u.test(source.relationshipCanvas) &&
      /inputElementId/u.test(source.relationshipCanvas) &&
      /Number Input/u.test(source.relationshipCanvas),
    runtimeForm:
      /formValues/u.test(source.runtime) &&
      /fieldErrors/u.test(source.runtime) &&
      /executeDraftRuntimeMutation/u.test(source.runtime) &&
      /executePublishedRuntimeMutation/u.test(source.runtime) &&
      /readRefreshRevision/u.test(source.runtime),
    accessiblePendingState:
      /aria-invalid/u.test(source.runtimeRenderer) &&
      /aria-busy/u.test(source.runtimeRenderer) &&
      /disabled=\{presentation\.disabled \|\| pending\}/u.test(
        source.runtimeRenderer,
      ),
    backendBehavior:
      /creates, refreshes, updates, and deletes real Test rows/u.test(
        source.backendTest,
      ) &&
      /productionBefore/u.test(source.backendTest) &&
      /IDEMPOTENCY_PAYLOAD_CONFLICT|replay/u.test(source.backendTest) &&
      /BINDING_MUTATION_CONSTRAINT/u.test(source.backendTest) &&
      /BINDING_MUTATION_ROW_CONFLICT/u.test(source.backendTest),
    frontendBehavior:
      /maps Number Inputs to logical Table fields for a CREATE Binding/u.test(
        source.relationshipTest,
      ) &&
      /submits a Draft CREATE Binding, maps field errors, and refreshes the Data Table/u.test(
        source.runtimeTest,
      ),
    noBrowserSql:
      !/(?:rawSql|physicalTableName|physicalFieldName)/u.test(web) &&
      !/\b(?:INSERT|UPDATE|DELETE)\s+(?:INTO|FROM|SET)/u.test(web),
    serverCoverage:
      /CREATE/u.test(server) &&
      /UPDATE/u.test(server) &&
      /DELETE/u.test(server),
  };
}

function equalRectGroup(rects, count) {
  if (!Array.isArray(rects) || rects.length !== count) return false;
  return rects.every(
    (rect) =>
      rect &&
      rect.width > 0 &&
      rect.height > 0 &&
      Math.abs(rect.width - rects[0].width) <= 0.02 &&
      Math.abs(rect.height - rects[0].height) <= 0.02,
  );
}

export function inspectPhase13BrowserEvidence(evidence) {
  const crud = evidence?.draftCrud;
  const mobile = evidence?.responsive419;
  return {
    metadata:
      evidence?.schemaVersion === 1 &&
      evidence?.result === "PASS" &&
      evidence?.target === "isolated local browser session" &&
      /^http:\/\/127\.0\.0\.1:\d+\/$/u.test(evidence?.url ?? ""),
    desktop:
      evidence?.viewport?.width === 1280 && evidence?.viewport?.height === 720,
    fullCrud:
      Array.isArray(crud?.rowCounts) &&
      JSON.stringify(crud.rowCounts) === JSON.stringify([0, 1, 1, 0]) &&
      crud?.createAffectedRows === 1 &&
      crud?.updateAffectedRows === 1 &&
      crud?.deleteAffectedRows === 1,
    transactionSafety:
      crud?.validationMappedToField === true &&
      crud?.conflictRolledBack === true &&
      crud?.idempotentReplayExact === true,
    environmentIsolation:
      /^[0-9a-f]{64}$/u.test(crud?.productionChecksumBefore ?? "") &&
      crud?.productionChecksumBefore === crud?.productionChecksumAfter &&
      crud?.testChecksumBefore !== crud?.testChecksumAfter,
    refresh: crud?.dataTableRefreshCount >= 3,
    equalControls:
      equalRectGroup(evidence?.formInputRects, 2) &&
      equalRectGroup(evidence?.formActionRects, 3),
    mobile:
      mobile?.viewportWidth === 419 &&
      mobile?.documentScrollWidth === 419 &&
      mobile?.formReachable === true &&
      mobile?.tableReachable === true &&
      mobile?.siblingGeometryPreserved === true,
    clean:
      evidence?.consoleErrorCount === 0 && evidence?.failedRequestCount === 0,
  };
}

export async function validatePhase13({
  repositoryRoot = REPOSITORY_ROOT,
  includeBrowserEvidence = true,
  includePhase12Regression = true,
  includeGovernance = true,
} = {}) {
  const validation = new Validation("Phase 13 Transactional CRUD Runtime");
  const source = await sources(repositoryRoot);
  const inspection = inspectPhase13Contract(source);
  for (const [name, value] of Object.entries(inspection)) {
    validation.check(value === true, `Phase 13 contract failed: ${name}`);
  }

  let browserInspection = {};
  if (includeBrowserEvidence) {
    try {
      const evidence = JSON.parse(
        await readFile(
          resolve(repositoryRoot, PHASE13_BROWSER_EVIDENCE_PATH),
          "utf8",
        ),
      );
      browserInspection = inspectPhase13BrowserEvidence(evidence);
      for (const [name, value] of Object.entries(browserInspection)) {
        validation.check(value === true, `Phase 13 browser failed: ${name}`);
      }
    } catch (error) {
      validation.check(false, "Phase 13 browser evidence is missing", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (includeGovernance) {
    validation.check(
      /## Phase 13 evidence/u.test(source.status) &&
        source.status.includes(PHASE13_EVIDENCE_PATH) &&
        source.status.includes(PHASE13_BROWSER_EVIDENCE_PATH),
      "Phase 13 implementation status evidence is incomplete",
    );
    validation.check(
      source.traceability.includes("scripts/verify-phase13.mjs") &&
        source.traceability.includes(PHASE13_EVIDENCE_PATH) &&
        source.traceability.includes(PHASE13_BROWSER_EVIDENCE_PATH),
      "REQ-018 Phase 13 traceability is incomplete",
    );
  }

  let phase12Regression = "NOT_RUN";
  if (includePhase12Regression) {
    const previous = await validatePhase12({ repositoryRoot });
    phase12Regression = previous.result;
    validation.check(
      previous.result === "PASS",
      "Phase 0–12 regression must remain green",
      { failures: previous.failures },
    );
  }

  return validation.result({
    inspection,
    browserInspection,
    phase12Regression,
    browserEvidencePath: PHASE13_BROWSER_EVIDENCE_PATH,
  });
}

if (isMainModule(import.meta.url)) {
  try {
    await finishVerification(PHASE13_EVIDENCE_PATH, await validatePhase13());
  } catch (error) {
    await finishVerification(
      PHASE13_EVIDENCE_PATH,
      unexpectedFailure("Phase 13 Transactional CRUD Runtime", error),
    );
  }
}
