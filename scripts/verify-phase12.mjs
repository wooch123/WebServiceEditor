import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  REPOSITORY_ROOT,
  Validation,
  finishVerification,
  isMainModule,
  unexpectedFailure,
} from "./lib/verification.mjs";
import { validatePhase11 } from "./verify-phase11.mjs";

export const PHASE12_EVIDENCE_PATH =
  "artifacts/phase12/runtime-preview-validation.json";
export const PHASE12_BROWSER_EVIDENCE_PATH =
  "artifacts/phase12/browser-runtime-preview-validation.json";

const FILES = Object.freeze({
  adr: "docs/adr/0013-runtime-snapshot-and-draft-preview.md",
  domain: "packages/domain/src/runtime.ts",
  pageRepository: "apps/server/src/pages/page-repository.ts",
  pageService: "apps/server/src/pages/page-service.ts",
  projectService: "apps/server/src/projects/project-service.ts",
  runtimeService: "apps/server/src/runtime/runtime-definition-service.ts",
  relationshipService:
    "apps/server/src/data-relationship/relationship-service.ts",
  compiler: "apps/server/src/data-relationship/binding-query-compiler.ts",
  pageRoutes: "apps/server/src/routes/pages.ts",
  relationshipRoutes: "apps/server/src/routes/data-relationship.ts",
  backendTest:
    "apps/server/test/integration/runtime-definition-preview.test.ts",
  app: "apps/web/src/App.tsx",
  runtime: "apps/web/src/features/runtime/PublishedRuntime.tsx",
  runtimeRenderer: "apps/web/src/features/runtime/RuntimeElementRenderer.tsx",
  runtimeTest: "apps/web/src/features/runtime/PublishedRuntime.test.tsx",
  pageManager: "apps/web/src/features/pages/PageManager.tsx",
  pageManagerTest: "apps/web/src/features/pages/PageManager.test.tsx",
  runtimeApi: "apps/web/src/services/runtime-api.ts",
  styles: "apps/web/src/styles.css",
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

export function inspectPhase12Contract(source) {
  const routes = `${source.pageRoutes}\n${source.relationshipRoutes}`;
  const runtimeTree = `${source.runtime}\n${source.runtimeRenderer}`;
  return {
    adr:
      /Project Definition Snapshot/u.test(source.adr) &&
      /test\.sqlite/u.test(source.adr) &&
      /production\.sqlite/u.test(source.adr) &&
      /(?:5|five) minutes/u.test(source.adr),
    snapshotContract: [
      "definitionSchemaVersion",
      "projectId",
      "sourceProjectRevision",
      "themeId",
      "registryChecksum",
      "pages",
      "elements",
      "layoutRevisions",
      "bindings",
      "dataSchema",
    ].every((field) => source.domain.includes(`readonly ${field}`)),
    boundedPreview:
      /DRAFT_PREVIEW_TTL_MILLISECONDS\s*=\s*5\s*\*\s*60\s*\*\s*1000/u.test(
        source.domain,
      ) &&
      /DRAFT_PREVIEW_CAPACITY\s*=\s*128/u.test(source.domain) &&
      /#purgeExpiredPreviews/u.test(source.runtimeService),
    canonicalChecksum:
      /projectDefinitionChecksum/u.test(source.runtimeService) &&
      /createHash\("sha256"\)/u.test(source.runtimeService) &&
      /stableJson/u.test(source.runtimeService),
    publishSnapshot:
      /runtimeDefinitionService\.buildSnapshot/u.test(source.pageService) &&
      /snapshot:\s*this\.runtimeDefinitionService/u.test(source.pageService),
    runtimeSnapshotOnly:
      /executePublishedBinding/u.test(source.runtimeService) &&
      /snapshot\.bindings\.find/u.test(source.runtimeService) &&
      /snapshot\.dataSchema/u.test(source.runtimeService) &&
      /"production"/u.test(source.runtimeService),
    previewTestOnly:
      /executeDraftBinding/u.test(source.runtimeService) &&
      /"test"/u.test(source.runtimeService) &&
      !/INSERT INTO project_versions/u.test(source.runtimeService),
    immutableCompiler:
      /snapshotSchema\?:\s*DataSchemaExportDto/u.test(source.compiler) &&
      /expectedAppliedRevision\?:\s*number/u.test(source.compiler),
    routes: [
      "/api/v1/runtime/:projectId/navigation",
      "/api/v1/runtime/:projectId/pages/:pageId",
      "/api/v1/runtime/:projectId/query/:bindingId",
      "/api/v1/projects/:projectId/draft-previews",
      "/api/v1/draft-previews/:previewId/navigation",
      "/api/v1/draft-previews/:previewId/pages/:pageId",
      "/api/v1/draft-previews/:previewId/query/:bindingId",
    ].every((route) => routes.includes(route)),
    exportImportSnapshot:
      /definitionSchemaVersion:\s*snapshot\.definitionSchemaVersion/u.test(
        source.projectService,
      ) &&
      /remapSnapshotDataSchema/u.test(source.projectService) &&
      /remapSnapshotBindings/u.test(source.projectService),
    sharedRuntimeShell:
      /function RuntimeApplication/u.test(source.runtime) &&
      /export function PublishedRuntime/u.test(source.runtime) &&
      /export function DraftPreviewRuntime/u.test(source.runtime),
    runtimeSeparated:
      !/(?:ElementCanvas|ElementWorkspace|PageManager|PropertyInspector)/u.test(
        runtimeTree,
      ),
    runtimeData:
      /executePublishedRuntimeBinding/u.test(source.runtime) &&
      /executeDraftRuntimeBinding/u.test(source.runtime) &&
      /renderData:\s*payload\.result\.renderData/u.test(source.runtime),
    deepRoutes:
      /\/runtime\/:projectId\/\*/u.test(source.app) &&
      /\/preview\/:projectId\/:previewId\/\*/u.test(source.app),
    previewControl:
      /createDraftPreview/u.test(source.pageManager) &&
      />\s*미리보기\s*</u.test(source.pageManager),
    equalActions:
      /grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/u.test(
        source.styles,
      ) &&
      /\.page-manager-actions\s*>\s*\[data-slot="button"\][\s\S]*?width:\s*100%/u.test(
        source.styles,
      ),
    backendBehavior:
      /Published navigation immutable/u.test(source.backendTest) &&
      /write-free/u.test(source.backendTest) &&
      /DRAFT_PREVIEW_NOT_FOUND/u.test(source.backendTest) &&
      /publishedVersions/u.test(source.backendTest),
    frontendBehavior:
      /Draft Preview from its immutable Test snapshot/u.test(
        source.runtimeTest,
      ) &&
      /without calling Published routes/u.test(source.runtimeTest) &&
      /server-owned Draft Preview/u.test(source.pageManagerTest),
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

export function inspectPhase12BrowserEvidence(evidence) {
  const desktop = evidence?.desktop;
  const mobile = evidence?.responsive419;
  const separation = evidence?.snapshotSeparation;
  const preview = evidence?.draftPreview;
  return {
    metadata:
      evidence?.schemaVersion === 1 &&
      evidence?.result === "PASS" &&
      evidence?.target === "isolated local browser session" &&
      /^http:\/\/127\.0\.0\.1:\d+\/$/u.test(evidence?.url ?? ""),
    desktop:
      desktop?.viewport?.width === 1280 && desktop?.viewport?.height === 720,
    equalPageActions: equalRectGroup(desktop?.pageActionRects, 3),
    navigation:
      desktop?.navigationOrderExact === true &&
      desktop?.deepLinkExact === true &&
      desktop?.iconOrderExact === true,
    snapshotSeparation:
      separation?.publishedNameBeforeDraft ===
        separation?.publishedNameAfterDraft &&
      separation?.draftName !== separation?.publishedNameAfterDraft &&
      separation?.publishedSnapshotId ===
        separation?.publishedSnapshotIdAfterDraft,
    draftPreview:
      preview?.usesTestDatabase === true &&
      preview?.previewBadgeVisible === true &&
      preview?.pageCount > 0 &&
      preview?.elementCount > 0 &&
      /^[0-9a-f]{64}$/u.test(preview?.definitionChecksum ?? ""),
    mobile:
      mobile?.viewportWidth === 419 &&
      mobile?.documentScrollWidth === 419 &&
      mobile?.navigationReachable === true &&
      mobile?.previewReachable === true &&
      mobile?.siblingGeometryPreserved === true,
    clean:
      evidence?.consoleErrorCount === 0 && evidence?.failedRequestCount === 0,
  };
}

export async function validatePhase12({
  repositoryRoot = REPOSITORY_ROOT,
  includeBrowserEvidence = true,
  includePhase11Regression = true,
  includeGovernance = true,
} = {}) {
  const validation = new Validation("Phase 12 Runtime and Draft Preview");
  const source = await sources(repositoryRoot);
  const inspection = inspectPhase12Contract(source);
  for (const [name, value] of Object.entries(inspection)) {
    validation.check(value === true, `Phase 12 contract failed: ${name}`);
  }

  let browserInspection = {};
  if (includeBrowserEvidence) {
    try {
      const evidence = JSON.parse(
        await readFile(
          resolve(repositoryRoot, PHASE12_BROWSER_EVIDENCE_PATH),
          "utf8",
        ),
      );
      browserInspection = inspectPhase12BrowserEvidence(evidence);
      for (const [name, value] of Object.entries(browserInspection)) {
        validation.check(value === true, `Phase 12 browser failed: ${name}`);
      }
    } catch (error) {
      validation.check(false, "Phase 12 browser evidence is missing", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (includeGovernance) {
    validation.check(
      /## Phase 12 evidence/u.test(source.status) &&
        source.status.includes(PHASE12_EVIDENCE_PATH) &&
        source.status.includes(PHASE12_BROWSER_EVIDENCE_PATH),
      "Phase 12 implementation status evidence is incomplete",
    );
  }

  let phase11Regression = "NOT_RUN";
  if (includePhase11Regression) {
    const previous = await validatePhase11({ repositoryRoot });
    phase11Regression = previous.result;
    validation.check(
      previous.result === "PASS",
      "Phase 0–11 regression must remain green",
      { failures: previous.failures },
    );
  }

  return validation.result({
    inspection,
    browserInspection,
    phase11Regression,
    browserEvidencePath: PHASE12_BROWSER_EVIDENCE_PATH,
  });
}

if (isMainModule(import.meta.url)) {
  try {
    await finishVerification(PHASE12_EVIDENCE_PATH, await validatePhase12());
  } catch (error) {
    await finishVerification(
      PHASE12_EVIDENCE_PATH,
      unexpectedFailure("Phase 12 Runtime and Draft Preview", error),
    );
  }
}
