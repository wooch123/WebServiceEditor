import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CANONICAL_PHASE8_ROUTES,
  REQUIRED_DATA_FIELD_TYPES,
  inspectPhase8BrowserEvidence,
  inspectPhase8Contract,
  validatePhase8,
} from "../../scripts/verify-phase8.mjs";

describe("Phase 8 validation", () => {
  it("accepts the authoritative repository without browser evidence", async () => {
    const report = await validatePhase8({
      includeBrowserEvidence: false,
      includePhase7Regression: false,
    });
    assert.equal(report.result, "PASS", JSON.stringify(report.failures));
  });

  it("keeps the canonical route and field inventories exact", () => {
    assert.equal(CANONICAL_PHASE8_ROUTES.length, 12);
    assert.deepEqual(REQUIRED_DATA_FIELD_TYPES, [
      "INTEGER",
      "REAL",
      "TEXT",
      "BOOLEAN",
      "DATE",
      "DATETIME",
      "JSON",
      "BLOB",
    ]);
  });

  it("rejects client-owned physical names and missing recovery behavior", () => {
    const base = {
      domain: `export const DATA_FIELD_TYPES = [${REQUIRED_DATA_FIELD_TYPES.map((value) => `"${value}"`).join(",")}] as const;
        export const DATA_TABLE_TEMPLATES = ["BLANK","ENTITY","TIME_SERIES"] as const;
        export interface CreateDataTableRequest { readonly expectedSchemaRevision:number; readonly expectedProjectRevision:number; readonly idempotencyKey:string; }
        export interface SchemaMigrationPlanDto { readonly target:"test"; }`,
      migration: `const LATEST_METADATA_SCHEMA_VERSION = 7; const databaseDesignerSchemaSql = ${JSON.stringify(
        REQUIRED_SCHEMA_SQL,
      )}; const migrations = [{name:"database-designer-runtime-schema",version:7}];`,
      routes:
        CANONICAL_PHASE8_ROUTES.map(
          ([method, path]) =>
            `server.${method.toLowerCase()}("${path}", handler);`,
        ).join("\n") +
        `\nfunction exactBody(){} const UNKNOWN_REQUEST_FIELD = true;`,
      repository:
        "const production_applied_revision = 0; function deleteOwnedDefinitions(){}",
      service: REQUIRED_SERVICE_SOURCE,
      projectService:
        "const dataSchema=this.schemaRepository.exportDefinition(id); this.schemaRepository.insertImportedDefinition(); this.schemaRepository.deleteOwnedDefinitions();",
      storage: "const webeditor_runtime_schema_state = true;",
      frontend: `const FIELD_TYPES = [${REQUIRED_DATA_FIELD_TYPES.map((value) => `"${value}"`).join(",")}]; const x='데이터베이스 설계 테이블 추가 필드 추가 관계 추가 테이블 이름 필드 이름 Test DB 적용 affectedRowCount schema-header-actions schema-detail-actions schema-dialog-actions value="BLANK" value="ENTITY" value="TIME_SERIES"'; FIELD_TYPES.map(x);`,
      frontendApi: "const confirmDestructive = true;",
      backendTest:
        "server-owned physical Tables and Fields real isolated Test SQLite schema restores the verified backup Relations and rolls back interrupted APPLYING remaps schema identity across clone and import",
      frontendTest:
        "server-owned Table from a GUI form adds a typed Field renames display labels applies the exact server-issued plan second migration impact confirmation",
      adr: "runtime SQLite databases Production Clients never submit SQL",
    };
    assert.equal(inspectPhase8Contract(base).physicalNamesServerOwned, true);
    assert.equal(inspectPhase8Contract(base).rollbackAndRecovery, true);
    assert.equal(
      inspectPhase8Contract({
        ...base,
        domain: `${base.domain}\ninterface Bad { readonly physicalName:string }`,
      }).physicalNamesServerOwned,
      false,
    );
    assert.equal(
      inspectPhase8Contract({
        ...base,
        service: base.service.replace(
          "copyFileSync(backupPath, runtimePath)",
          "restore(backupPath, runtimePath)",
        ),
      }).rollbackAndRecovery,
      false,
    );
  });

  it("rejects unequal browser sibling geometry and Production drift", () => {
    const evidence = browserFixture();
    assert.equal(inspectPhase8BrowserEvidence(evidence).result, true);
    assert.equal(
      inspectPhase8BrowserEvidence(evidence).equalHeaderActions,
      true,
    );
    assert.equal(inspectPhase8BrowserEvidence(evidence).planApplied, true);
    assert.equal(
      inspectPhase8BrowserEvidence({
        ...evidence,
        geometry: {
          ...evidence.geometry,
          headerActionRects: [
            evidence.geometry.headerActionRects[0],
            { x: 0, y: 0, width: 91, height: 40 },
          ],
        },
      }).equalHeaderActions,
      false,
    );
    assert.equal(
      inspectPhase8BrowserEvidence({
        ...evidence,
        planApply: {
          ...evidence.planApply,
          productionChecksumAfter: "changed",
        },
      }).planApplied,
      false,
    );
  });
});

const REQUIRED_SCHEMA_SQL = `
CREATE TABLE project_schema_states (project_id TEXT REFERENCES projects(id) ON DELETE CASCADE);
CREATE TABLE data_tables (project_id TEXT REFERENCES projects(id) ON DELETE CASCADE);
CREATE TABLE data_fields (FOREIGN KEY (table_id, project_id) REFERENCES data_tables(id, project_id));
CREATE TABLE data_relations (FOREIGN KEY (source_field_id, source_table_id, project_id) REFERENCES data_fields(id, table_id, project_id));
CREATE TABLE schema_migration_plans (target_environment TEXT CHECK (target_environment = 'test'), snapshot_json TEXT, schema_checksum TEXT, expires_at TEXT);
CREATE TABLE schema_backups (verified INTEGER NOT NULL CHECK (verified = 1));
CREATE TABLE schema_commands (UNIQUE(project_id, idempotency_key));`;

const REQUIRED_SERVICE_SOURCE = `
function physicalName(prefix: "t" | "c"){}
const a=/^t_[0-9a-f]{32}$/; const b=/^c_[0-9a-f]{32}$/;
const production=#runtimeState(projectId, "production"); const source={readonly:true};
const SCHEMA_PLAN_STALE=true, SCHEMA_PLAN_CHECKSUM_MISMATCH=true;
copyFileSync(runtimePath, backupPath); const backupChecksum="";
const stagingPath=""; renameSync(stagingPath, runtimePath); quick_check; foreign_key_check; #fsyncDirectory;
const p="schema:after-runtime-swap"; copyFileSync(backupPath, runtimePath); applyingPlans(); const q="status = 'FAILED'";
ATTACH DATABASE ? AS source; INSERT INTO x SELECT x FROM source.y;`;

function browserFixture() {
  const rect = { x: 1, y: 1, width: 90, height: 40 };
  return {
    result: "PASS",
    target: "isolated local browser session",
    viewport: { width: 1280, height: 720 },
    fieldInventory: { visibleCount: 8, types: [...REQUIRED_DATA_FIELD_TYPES] },
    geometry: {
      headerActionRects: [rect, rect, rect],
      detailActionRects: [rect, rect, rect],
      dialogActionRects: [rect, rect],
    },
    crud: {
      tableDisplayNameBefore: "A",
      tableDisplayNameAfter: "B",
      tablePhysicalNameBefore: `t_${"a".repeat(32)}`,
      tablePhysicalNameAfter: `t_${"a".repeat(32)}`,
      fieldDisplayNameBefore: "C",
      fieldDisplayNameAfter: "D",
      fieldPhysicalNameBefore: `c_${"b".repeat(32)}`,
      fieldPhysicalNameAfter: `c_${"b".repeat(32)}`,
      relationCount: 1,
    },
    planApply: {
      stepCount: 1,
      backupChecksum: "c".repeat(64),
      testDriftAfter: false,
      testIntegrity: "ok",
      productionChecksumBefore: "d".repeat(64),
      productionChecksumAfter: "d".repeat(64),
      rowCountBefore: 1,
      rowCountAfter: 1,
      destructiveImpactVisible: true,
      secondConfirmationRequired: true,
    },
    responsive419: {
      viewportWidth: 419,
      documentScrollWidth: 419,
      controlsReachable: true,
      fieldTableScrollable: true,
      siblingGeometryPreserved: true,
    },
    consoleErrorCount: 0,
    failedRequestCount: 0,
  };
}
