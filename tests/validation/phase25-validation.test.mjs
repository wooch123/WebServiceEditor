import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  inspectReferenceApplications,
  validatePhase25,
} from "../../scripts/verify-phase25.mjs";

function validInput() {
  return {
    service:
      'SEMICONDUCTOR_YIELD COMMERCE_OPERATIONS PERSONAL_BLOG WORK_MANAGEMENT sample-semiconductor-yield sample-commerce-operations sample-personal-blog sample-work-management #writeRows(project.id, "test" #writeRows(project.id, "production" `${environment}.sqlite` foreign_keys = ON quick_check foreign_key_check .immediate() "ROWS" "SCALAR" "SERIES" "VALUES" "CREATE" "UPDATE" "DELETE" executeRuntimeMutation production-create-check production-update-check production-delete-check pages.length === 4 elements.length >= 19 graph.edges.length >= 13 REFERENCE_APPLICATION_INCOMPLETE backupService.create backupService.verify drill.status === "PASS"',
    integration:
      "totalTestRowCount: 3_938 totalProductionRowCount: 3_938 600, 1_370, 1_012, 956 creates four published domain systems",
    routes: "sample-projects/reference-applications createSuite",
    domain: "REFERENCE_APPLICATION_KINDS ReferenceApplicationSuiteDto",
    home: '예제 프로젝트 4개 시스템 · 실제 데이터 3,938건 reference-application-grid project-entry-button referenceSample <Badge variant="outline">예제</Badge>',
    homeTest:
      "examplesButton, importButton, createButton creates the four real-data example projects",
    styles: "home-hero-actions .project-entry-button",
    adr: "Status: accepted 3,938 rows per environment",
    status:
      "### PHASE 25 — Real-domain Reference Applications\nState: `OPERATIONALLY VERIFIED`\n| 25 | OPERATIONALLY VERIFIED |",
  };
}

describe("Phase 25 validation contract", () => {
  it("accepts four operational real-data applications", () => {
    assert.ok(
      Object.values(inspectReferenceApplications(validInput())).every(Boolean),
    );
  });

  it("rejects a Test-only data seed", () => {
    const input = validInput();
    input.service = input.service.replace(
      '#writeRows(project.id, "production"',
      "copy test database",
    );
    assert.equal(inspectReferenceApplications(input).isolatedRuntime, false);
  });

  it("rejects a sample without executable delete", () => {
    const input = validInput();
    input.service = input.service.replace('"DELETE"', "NO_DELETE");
    assert.equal(inspectReferenceApplications(input).executableBindings, false);
  });

  it("passes the repository contract before browser evidence", async () => {
    const result = await validatePhase25({ includeBrowserEvidence: false });
    assert.equal(result.result, "PASS", JSON.stringify(result.failures));
  });
});
