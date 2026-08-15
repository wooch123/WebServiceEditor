import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  REPOSITORY_ROOT,
  Validation,
  finishVerification,
  isMainModule,
  unexpectedFailure,
} from "./lib/verification.mjs";
import { validatePhase7 } from "./verify-phase7.mjs";

export const PHASE8_EVIDENCE_PATH =
  "artifacts/phase8/database-designer-validation.json";
export const PHASE8_BROWSER_EVIDENCE_PATH =
  "artifacts/phase8/browser-database-designer-validation.json";

export const REQUIRED_DATA_FIELD_TYPES = Object.freeze([
  "INTEGER",
  "REAL",
  "TEXT",
  "BOOLEAN",
  "DATE",
  "DATETIME",
  "JSON",
  "BLOB",
]);
export const REQUIRED_DATA_TABLE_TEMPLATES = Object.freeze([
  "BLANK",
  "ENTITY",
  "TIME_SERIES",
]);
export const REQUIRED_SCHEMA_TABLES = Object.freeze([
  "project_schema_states",
  "data_tables",
  "data_fields",
  "data_relations",
  "schema_migration_plans",
  "schema_backups",
  "schema_commands",
]);
export const CANONICAL_PHASE8_ROUTES = Object.freeze([
  ["GET", "/api/v1/projects/:projectId/schema"],
  ["POST", "/api/v1/projects/:projectId/tables"],
  ["PATCH", "/api/v1/tables/:tableId"],
  ["DELETE", "/api/v1/tables/:tableId"],
  ["POST", "/api/v1/tables/:tableId/fields"],
  ["PATCH", "/api/v1/fields/:fieldId"],
  ["DELETE", "/api/v1/fields/:fieldId"],
  ["POST", "/api/v1/projects/:projectId/relations"],
  ["PATCH", "/api/v1/relations/:relationId"],
  ["DELETE", "/api/v1/relations/:relationId"],
  ["POST", "/api/v1/projects/:projectId/schema/plan"],
  ["POST", "/api/v1/projects/:projectId/schema/apply"],
]);

const FILES = Object.freeze({
  domain: "packages/domain/src/data-schema.ts",
  migration: "apps/server/src/metadata/database.ts",
  routes: "apps/server/src/routes/data-schema.ts",
  repository: "apps/server/src/data-schema/schema-repository.ts",
  service: "apps/server/src/data-schema/schema-service.ts",
  projectService: "apps/server/src/projects/project-service.ts",
  storage: "apps/server/src/projects/project-storage.ts",
  frontend: "apps/web/src/features/data-schema/DatabaseDesigner.tsx",
  frontendApi: "apps/web/src/services/data-schema-api.ts",
  backendTest: "apps/server/test/integration/database-designer.test.ts",
  frontendTest: "apps/web/src/features/data-schema/DatabaseDesigner.test.tsx",
  adr: "docs/adr/0009-database-designer-and-runtime-schema.md",
});

function extractQuotedArray(source, name) {
  const match = source.match(
    new RegExp(
      `export\\s+const\\s+${name}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*as\\s+const`,
      "u",
    ),
  );
  return match
    ? [...match[1].matchAll(/["']([^"']+)["']/gu)].map((item) => item[1])
    : [];
}

function routeInventory(source) {
  const routes = [];
  const pattern =
    /server\.(get|post|patch|delete)(?:<[\s\S]{0,240}?>)?\(\s*["']([^"']+)["']/gu;
  for (const match of source.matchAll(pattern)) {
    routes.push(`${match[1].toUpperCase()} ${match[2]}`);
  }
  return routes;
}

function exactArray(left, right) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

export function inspectPhase8Contract(sources) {
  const routes = routeInventory(sources.routes);
  const routeSet = new Set(routes);
  const requestSection = sources.domain.slice(
    sources.domain.indexOf("export interface CreateDataTableRequest"),
  );
  const migrationSection = sources.migration.slice(
    sources.migration.indexOf("const databaseDesignerSchemaSql"),
  );
  return {
    fieldTypesExact: exactArray(
      extractQuotedArray(sources.domain, "DATA_FIELD_TYPES"),
      REQUIRED_DATA_FIELD_TYPES,
    ),
    templatesExact: exactArray(
      extractQuotedArray(sources.domain, "DATA_TABLE_TEMPLATES"),
      REQUIRED_DATA_TABLE_TEMPLATES,
    ),
    routesExact: CANONICAL_PHASE8_ROUTES.every(([method, path]) =>
      routeSet.has(`${method} ${path}`),
    ),
    routeCount: routes.length,
    schemaTablesExact: REQUIRED_SCHEMA_TABLES.every((table) =>
      migrationSection.includes(`CREATE TABLE ${table}`),
    ),
    versionSeven:
      /LATEST_METADATA_SCHEMA_VERSION\s*=\s*(?:[7-9]|[1-9]\d+)/u.test(
        sources.migration,
      ) &&
      /name:\s*["']database-designer-runtime-schema["'][\s\S]{0,160}version:\s*7/u.test(
        sources.migration,
      ),
    ownershipConstraints:
      /REFERENCES projects\(id\) ON DELETE CASCADE/u.test(migrationSection) &&
      /FOREIGN KEY \(table_id, project_id\)/u.test(migrationSection) &&
      /FOREIGN KEY \(source_field_id, source_table_id, project_id\)/u.test(
        migrationSection,
      ),
    revisionAndIdempotency:
      /expectedSchemaRevision/u.test(requestSection) &&
      /expectedProjectRevision/u.test(requestSection) &&
      /idempotencyKey/u.test(requestSection) &&
      /UNIQUE\(project_id, idempotency_key\)/u.test(migrationSection),
    physicalNamesServerOwned:
      /function physicalName\(prefix: ["']t["'] \| ["']c["']\)/u.test(
        sources.service,
      ) &&
      /\^t_\[0-9a-f\]\{32\}\$/u.test(sources.service) &&
      /\^c_\[0-9a-f\]\{32\}\$/u.test(sources.service) &&
      !requestSection.includes("readonly physicalName"),
    exactRequestAllowlist:
      /function exactBody/u.test(sources.routes) &&
      /UNKNOWN_REQUEST_FIELD/u.test(sources.routes) &&
      !sources.routes.includes('"physicalName"'),
    testOnlyApply:
      /target:\s*["']test["']/u.test(sources.domain) &&
      /target_environment[^\n]+CHECK \(target_environment = 'test'\)/u.test(
        migrationSection,
      ) &&
      !/schema\/apply[\s\S]{0,500}production/u.test(sources.routes),
    durablePlanSnapshot:
      /snapshot_json/u.test(migrationSection) &&
      /schema_checksum/u.test(migrationSection) &&
      /expires_at/u.test(migrationSection) &&
      /SCHEMA_PLAN_STALE/u.test(sources.service) &&
      /SCHEMA_PLAN_CHECKSUM_MISMATCH/u.test(sources.service),
    verifiedBackup:
      /CREATE TABLE schema_backups/u.test(migrationSection) &&
      /verified INTEGER NOT NULL CHECK \(verified = 1\)/u.test(
        migrationSection,
      ) &&
      /backupChecksum/u.test(sources.service) &&
      /copyFileSync\(runtimePath, backupPath\)/u.test(sources.service),
    stagingAndAtomicSwap:
      /stagingPath/u.test(sources.service) &&
      /renameSync\(stagingPath, runtimePath\)/u.test(sources.service) &&
      /quick_check/u.test(sources.service) &&
      /foreign_key_check/u.test(sources.service) &&
      /#fsyncDirectory/u.test(sources.service),
    rollbackAndRecovery:
      /schema:after-runtime-swap/u.test(sources.service) &&
      /copyFileSync\(backupPath, runtimePath\)/u.test(sources.service) &&
      /applyingPlans\(\)/u.test(sources.service) &&
      /status = 'FAILED'/u.test(sources.service),
    rowPreservation:
      /ATTACH DATABASE \? AS source/u.test(sources.service) &&
      /INSERT INTO[\s\S]{0,240}SELECT[\s\S]{0,160}FROM source/u.test(
        sources.service,
      ),
    productionIsolation:
      /#runtimeState\(projectId, ["']production["']\)/u.test(sources.service) &&
      /readonly: true/u.test(sources.service) &&
      /production_applied_revision/u.test(sources.repository),
    exportImportLifecycle:
      /dataSchema:\s*this\.schemaRepository\.exportDefinition/u.test(
        sources.projectService,
      ) &&
      /insertImportedDefinition/u.test(sources.projectService) &&
      /deleteOwnedDefinitions/u.test(sources.projectService) &&
      /webeditor_runtime_schema_state/u.test(sources.storage),
    guiInventory:
      /데이터베이스 설계/u.test(sources.frontend) &&
      exactArray(
        [
          ...sources.frontend.matchAll(
            /const FIELD_TYPES[\s\S]*?=\s*\[([\s\S]*?)\];/gu,
          ),
        ].flatMap((match) =>
          [...match[1].matchAll(/["']([^"']+)["']/gu)].map((item) => item[1]),
        ),
        REQUIRED_DATA_FIELD_TYPES,
      ) &&
      REQUIRED_DATA_TABLE_TEMPLATES.every((template) =>
        sources.frontend.includes(`value="${template}"`),
      ),
    guiCrud:
      /테이블 추가/u.test(sources.frontend) &&
      /필드 추가/u.test(sources.frontend) &&
      /관계 추가/u.test(sources.frontend) &&
      /테이블 이름/u.test(sources.frontend) &&
      /필드 이름/u.test(sources.frontend),
    guiPlanImpact:
      /Test DB 적용/u.test(sources.frontend) &&
      /affectedRowCount/u.test(sources.frontend) &&
      /confirmDestructive/u.test(sources.frontendApi),
    siblingGeometry:
      /schema-header-actions/u.test(sources.frontend) &&
      /schema-detail-actions/u.test(sources.frontend) &&
      /schema-dialog-actions/u.test(sources.frontend),
    backendBehavior:
      /server-owned physical Tables and Fields/u.test(sources.backendTest) &&
      /real isolated Test SQLite schema/u.test(sources.backendTest) &&
      /restores the verified backup/u.test(sources.backendTest) &&
      /Relations and rolls back interrupted APPLYING/u.test(
        sources.backendTest,
      ) &&
      /remaps schema identity across clone and import/u.test(
        sources.backendTest,
      ),
    frontendBehavior:
      /server-owned Table from a GUI form/u.test(sources.frontendTest) &&
      /adds a typed Field/u.test(sources.frontendTest) &&
      /renames display labels/u.test(sources.frontendTest) &&
      /applies the exact server-issued plan/u.test(sources.frontendTest) &&
      /second migration impact confirmation/u.test(sources.frontendTest),
    adrBoundary:
      /runtime SQLite databases/u.test(sources.adr) &&
      /Production/u.test(sources.adr) &&
      /Clients never submit SQL/u.test(sources.adr),
  };
}

function validRect(rect) {
  return (
    rect &&
    ["x", "y", "width", "height"].every(
      (key) => Number.isFinite(rect[key]) && rect[key] >= 0,
    ) &&
    rect.width > 0 &&
    rect.height > 0
  );
}

function equalRects(rects) {
  return (
    Array.isArray(rects) &&
    rects.length >= 2 &&
    rects.every(validRect) &&
    rects.every(
      (rect) =>
        Math.abs(rect.width - rects[0].width) <= 0.02 &&
        Math.abs(rect.height - rects[0].height) <= 0.02,
    )
  );
}

export function inspectPhase8BrowserEvidence(evidence) {
  const crud = evidence?.crud;
  const apply = evidence?.planApply;
  const responsive = evidence?.responsive419;
  return {
    result: evidence?.result === "PASS",
    target: evidence?.target === "isolated local browser session",
    viewport:
      evidence?.viewport?.width === 1280 && evidence?.viewport?.height === 720,
    fieldInventory:
      evidence?.fieldInventory?.visibleCount === 8 &&
      exactArray(
        evidence?.fieldInventory?.types ?? [],
        REQUIRED_DATA_FIELD_TYPES,
      ),
    equalHeaderActions: equalRects(evidence?.geometry?.headerActionRects),
    equalDetailActions: equalRects(evidence?.geometry?.detailActionRects),
    equalDialogActions: equalRects(evidence?.geometry?.dialogActionRects),
    displayPhysicalSplit:
      crud?.tableDisplayNameBefore !== crud?.tableDisplayNameAfter &&
      crud?.fieldDisplayNameBefore !== crud?.fieldDisplayNameAfter &&
      crud?.tablePhysicalNameBefore === crud?.tablePhysicalNameAfter &&
      crud?.fieldPhysicalNameBefore === crud?.fieldPhysicalNameAfter &&
      /^t_[0-9a-f]{32}$/u.test(crud?.tablePhysicalNameAfter ?? "") &&
      /^c_[0-9a-f]{32}$/u.test(crud?.fieldPhysicalNameAfter ?? ""),
    relationCreated: crud?.relationCount >= 1,
    planApplied:
      apply?.stepCount > 0 &&
      /^[0-9a-f]{64}$/u.test(apply?.backupChecksum ?? "") &&
      apply?.testDriftAfter === false &&
      apply?.testIntegrity === "ok" &&
      apply?.productionChecksumBefore === apply?.productionChecksumAfter &&
      apply?.rowCountBefore === apply?.rowCountAfter,
    destructiveConfirmed:
      apply?.destructiveImpactVisible === true &&
      apply?.secondConfirmationRequired === true,
    responsive:
      responsive?.viewportWidth === 419 &&
      responsive?.documentScrollWidth === 419 &&
      responsive?.controlsReachable === true &&
      responsive?.fieldTableScrollable === true &&
      responsive?.siblingGeometryPreserved === true,
    cleanRuntime:
      evidence?.consoleErrorCount === 0 && evidence?.failedRequestCount === 0,
  };
}

async function readSources(repositoryRoot) {
  return Object.fromEntries(
    await Promise.all(
      Object.entries(FILES).map(async ([key, path]) => [
        key,
        await readFile(resolve(repositoryRoot, path), "utf8"),
      ]),
    ),
  );
}

async function readBrowserEvidence(repositoryRoot) {
  try {
    return JSON.parse(
      await readFile(
        resolve(repositoryRoot, PHASE8_BROWSER_EVIDENCE_PATH),
        "utf8",
      ),
    );
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

export async function validatePhase8({
  repositoryRoot = REPOSITORY_ROOT,
  includeBrowserEvidence = true,
  includePhase7Regression = true,
} = {}) {
  const validation = new Validation("Phase 8 Database Designer");
  const inspection = inspectPhase8Contract(await readSources(repositoryRoot));
  for (const [name, value] of Object.entries(inspection)) {
    if (name === "routeCount") continue;
    validation.check(value === true, `Phase 8 contract failed: ${name}`, {
      value,
    });
  }
  validation.equal(
    inspection.routeCount,
    CANONICAL_PHASE8_ROUTES.length,
    "Phase 8 route inventory must be exact",
  );

  let browserInspection = { result: "NOT_RUN" };
  if (includeBrowserEvidence) {
    browserInspection = inspectPhase8BrowserEvidence(
      await readBrowserEvidence(repositoryRoot),
    );
    for (const [name, value] of Object.entries(browserInspection)) {
      validation.check(
        value === true,
        `Phase 8 browser evidence failed: ${name}`,
        {
          value,
        },
      );
    }
  }

  let phase7Regression = { result: "NOT_RUN", failureCount: 0 };
  if (includePhase7Regression) {
    phase7Regression = await validatePhase7({ repositoryRoot });
    validation.check(
      phase7Regression.result === "PASS",
      "Phase 0–7 regression must remain green",
      { failures: phase7Regression.failures },
    );
  }

  return validation.result({
    inspection,
    browserInspection,
    phase7Regression: phase7Regression.result,
    browserEvidencePath: PHASE8_BROWSER_EVIDENCE_PATH,
  });
}

if (isMainModule(import.meta.url)) {
  try {
    await finishVerification(PHASE8_EVIDENCE_PATH, await validatePhase8());
  } catch (error) {
    await finishVerification(
      PHASE8_EVIDENCE_PATH,
      unexpectedFailure("Phase 8 Database Designer", error),
    );
  }
}
