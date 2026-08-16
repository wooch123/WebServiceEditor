import {
  Validation,
  finishVerification,
  isMainModule,
  pathExists,
  readJson,
  readRepositoryFile,
  unexpectedFailure,
} from "./lib/verification.mjs";

export const PHASE24_EVIDENCE_PATH =
  "artifacts/phase24/working-published-showcase-validation.json";
export const PHASE24_BROWSER_EVIDENCE_PATH =
  "artifacts/phase24/browser-working-published-showcase-validation.json";

const FILES = Object.freeze({
  adr: "docs/adr/0023-production-schema-publish-and-working-showcase.md",
  schema: "apps/server/src/data-schema/schema-service.ts",
  pages: "apps/server/src/pages/page-service.ts",
  repository: "apps/server/src/data-relationship/relationship-repository.ts",
  corpus: "apps/server/src/project-corpus/project-corpus-service.ts",
  showcaseTest:
    "apps/server/test/integration/feature-showcase-workflows.test.ts",
  schemaTest: "apps/server/test/integration/database-designer.test.ts",
  relationship:
    "apps/web/src/features/data-relationship/RelationshipCanvas.tsx",
  relationshipTest:
    "apps/web/src/features/data-relationship/RelationshipCanvas.test.tsx",
  pageTest: "apps/web/src/features/pages/PageManager.test.tsx",
  elementTest: "apps/web/src/features/elements/ElementCanvas.test.tsx",
  styles: "apps/web/src/styles.css",
  status: "docs/implementation-status.md",
  traceability: "docs/requirement-traceability.json",
});

async function source(path) {
  return (await readRepositoryFile(path)).toString("utf8");
}

export function inspectWorkingShowcase(input) {
  return {
    publishDeploysProduction:
      /synchronizeProductionForPublish/u.test(input.pages) &&
      /SCHEMA_TEST_NOT_APPLIED/u.test(input.schema) &&
      /PRODUCTION_SCHEMA_DEPLOYED/u.test(input.schema),
    deploymentRecovery:
      /production-schema:after-backup/u.test(input.schema) &&
      /production-schema:after-runtime-swap/u.test(input.schema) &&
      /\.production-schema-deployment\.json/u.test(input.schema) &&
      /#recoverProductionDeployments/u.test(input.schema),
    productionIsolation:
      /"production"/u.test(input.schema) &&
      /webeditor_runtime_mutation_commands/u.test(input.schema) &&
      /rowCountBefore/u.test(input.schema) &&
      /rowCountAfter/u.test(input.schema),
    repairableShowcase:
      /feature-showcase-v3-/u.test(input.corpus) &&
      /FEATURE_SHOWCASE_BINDING_REPAIR_FAILED/u.test(input.corpus) &&
      /test-reset-/u.test(input.corpus),
    activeRelationshipExport:
      /endpointObjectState/u.test(input.repository) &&
      /=== "active"/u.test(input.repository),
    executableRuntimeEvidence:
      /environment: "production"/u.test(input.showcaseTest) &&
      /operation: "CREATE"/u.test(input.showcaseTest) &&
      /42\.5/u.test(input.showcaseTest) &&
      /27\.25/u.test(input.showcaseTest),
    interruptionEvidence:
      /interrupted swap/u.test(input.schemaTest) &&
      /production-schema:after-runtime-swap/u.test(input.schemaTest),
    liveEdgeAttachment:
      /liveOrthogonalPoints/u.test(input.relationship) &&
      /sourceX/u.test(input.relationship) &&
      /targetX/u.test(input.relationship),
    directionalEdgeFlow:
      /relationship-edge-flow/u.test(input.relationship) &&
      /\.relationship-edge-flow/u.test(input.styles) &&
      /stroke-dasharray: 2 13/u.test(input.styles),
    scopedRelationshipWorkspace:
      /relationship-page-scope/u.test(input.relationship) &&
      /relationshipScopeNodeIds/u.test(input.relationship) &&
      /relationship-node-inventory/u.test(input.relationship) &&
      /TabsTrigger value="actions"/u.test(input.relationship) &&
      /TabsTrigger value="database"/u.test(input.relationship),
    toolbarPlacement:
      /relationship-toolbar-groups/u.test(input.relationship) &&
      /aria-label="위치 도구"/u.test(input.relationship),
    dragDangle:
      /animation: editor-dangle/u.test(input.styles) &&
      /react-draggable-dragging > \.element-item-toolbar/u.test(input.styles) &&
      /prefers-reduced-motion: reduce/u.test(input.styles),
    pageOverlayFix:
      /page-manager-heading/u.test(input.styles) &&
      /min-height: max-content/u.test(input.styles) &&
      /page-manager-list/u.test(input.styles) &&
      /flex: 1 1 auto/u.test(input.styles),
    behavioralTests:
      /moving Node and shows source-to-target flow/u.test(
        input.relationshipTest,
      ) &&
      /selected Page, its Elements, and directly used DB Nodes/u.test(
        input.relationshipTest,
      ) &&
      /dangles only the visible Element contents/u.test(input.elementTest) &&
      /editor-dangle/u.test(input.pageTest),
    acceptedDecision:
      /Status: accepted/u.test(input.adr) &&
      /Production schema publish/u.test(input.adr),
    nonWindowsReleaseBoundary:
      /Overall state: `EXHAUSTIVELY VERIFIED`/u.test(input.status) &&
      /canonical release gate remains\s+on `HOLD`/u.test(input.status),
    phaseStatus:
      /### PHASE 24 — Working Published Showcase[\s\S]*State: `OPERATIONALLY VERIFIED`/u.test(
        input.status,
      ) && /\| 24\s+\| OPERATIONALLY VERIFIED\s+\|/u.test(input.status),
  };
}

export async function validatePhase24({ includeBrowserEvidence = true } = {}) {
  const validation = new Validation("Phase 24 Working Published Showcase");
  const input = Object.fromEntries(
    await Promise.all(
      Object.entries(FILES).map(async ([key, path]) => [
        key,
        await source(path),
      ]),
    ),
  );
  const inspection = inspectWorkingShowcase(input);
  for (const [name, passed] of Object.entries(inspection)) {
    validation.equal(passed, true, `Working showcase contract: ${name}`);
  }

  const traceability = JSON.parse(input.traceability);
  for (const id of ["REQ-017", "REQ-018"]) {
    const requirement = traceability.requirements?.find(
      (entry) => entry.id === id,
    );
    validation.check(
      requirement?.implementation?.includes(FILES.adr),
      `${id} references the Phase 24 decision`,
    );
    validation.check(
      requirement?.tests?.includes("scripts/verify-phase24.mjs"),
      `${id} references the Phase 24 verifier`,
    );
    validation.check(
      requirement?.evidence?.includes(PHASE24_EVIDENCE_PATH) &&
        requirement?.evidence?.includes(PHASE24_BROWSER_EVIDENCE_PATH),
      `${id} references both Phase 24 evidence files`,
    );
  }

  let browserEvidence = null;
  if (includeBrowserEvidence) {
    validation.equal(
      await pathExists(PHASE24_BROWSER_EVIDENCE_PATH),
      true,
      "Phase 24 browser evidence exists",
    );
    if (await pathExists(PHASE24_BROWSER_EVIDENCE_PATH)) {
      browserEvidence = await readJson(PHASE24_BROWSER_EVIDENCE_PATH);
      validation.equal(browserEvidence.result, "PASS", "Browser flow passes");
      validation.check(
        /^https:\/\/webeditor\.dove9999\.com\/runtime\//u.test(
          browserEvidence.url ?? "",
        ),
        "Browser evidence targets the public Published Runtime",
      );
      validation.equal(
        browserEvidence.health?.publicRuntimeStatus,
        200,
        "Public Runtime returns HTTP 200",
      );
      validation.equal(
        browserEvidence.health?.publicReadyStatus,
        200,
        "Public Ready returns HTTP 200",
      );
      validation.equal(
        browserEvidence.runtimeMutation?.environment,
        "production",
        "Browser mutation uses Production",
      );
      validation.equal(
        browserEvidence.runtimeMutation?.value,
        42.5,
        "Browser mutation preserves the entered value",
      );
      validation.equal(
        browserEvidence.relationship?.pageScopeVisible,
        true,
        "Page scope is visible",
      );
      validation.equal(
        browserEvidence.relationship?.inventoryTabsVisible,
        true,
        "Action and DB tabs are visible",
      );
      validation.equal(
        browserEvidence.pageManager?.headerRowOverlap,
        false,
        "Page header and rows do not overlap",
      );
      validation.equal(
        browserEvidence.consoleErrorCount,
        0,
        "Browser console has no errors",
      );
      validation.equal(
        browserEvidence.failedRequestCount,
        0,
        "Required browser requests all pass",
      );
    }
  }

  return validation.result({ inspection, browserEvidence });
}

async function main() {
  try {
    await finishVerification(PHASE24_EVIDENCE_PATH, await validatePhase24());
  } catch (error) {
    await finishVerification(
      PHASE24_EVIDENCE_PATH,
      unexpectedFailure("Phase 24 Working Published Showcase", error),
    );
  }
}

if (isMainModule(import.meta.url)) await main();
