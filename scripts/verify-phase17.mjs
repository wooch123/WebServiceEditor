import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  REPOSITORY_ROOT,
  Validation,
  finishVerification,
  isMainModule,
  unexpectedFailure,
} from "./lib/verification.mjs";
import { validatePhase16 } from "./verify-phase16.mjs";

export const PHASE17_EVIDENCE_PATH =
  "artifacts/phase17/backup-export-import-recovery-validation.json";
export const PHASE17_BROWSER_EVIDENCE_PATH =
  "artifacts/phase17/browser-backup-recovery-validation.json";

const FILES = {
  adr: "docs/adr/0018-project-backup-export-import-recovery.md",
  domain: "packages/domain/src/backup.ts",
  metadata: "apps/server/src/metadata/database.ts",
  storage: "apps/server/src/backup/backup-storage.ts",
  service: "apps/server/src/backup/backup-service.ts",
  projectRepository: "apps/server/src/projects/project-repository.ts",
  projectService: "apps/server/src/projects/project-service.ts",
  routes: "apps/server/src/routes/backups.ts",
  system: "apps/server/src/routes/system.ts",
  serverTest: "apps/server/test/integration/backup-recovery.test.ts",
  webApi: "apps/web/src/services/backup-api.ts",
  manager: "apps/web/src/features/projects/BackupManager.tsx",
  projectHome: "apps/web/src/features/projects/ProjectHome.tsx",
  styles: "apps/web/src/styles.css",
  webTest: "apps/web/src/features/projects/BackupManager.test.tsx",
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

export function inspectPhase17Contract(source) {
  return {
    architecture:
      /immutable, server-managed snapshot/u.test(source.adr) &&
      /never overwrites the source Project/u.test(source.adr) &&
      /recycle-bin entry never counts as a backup/u.test(source.adr),
    domain:
      /PROJECT_BACKUP_STATUSES/u.test(source.domain) &&
      /ProjectBackupRestoreDto/u.test(source.domain) &&
      /ProjectBackupDrillDto/u.test(source.domain),
    metadataV14:
      /LATEST_METADATA_SCHEMA_VERSION\s*=\s*(?:1[4-9]|[2-9]\d+)/u.test(
        source.metadata,
      ) &&
      /version:\s*14/u.test(source.metadata) &&
      /project-backup-export-import-recovery/u.test(source.metadata) &&
      /CREATE TABLE project_backups/u.test(source.metadata) &&
      /CREATE TABLE backup_commands/u.test(source.metadata) &&
      /CREATE TABLE backup_restore_runs/u.test(source.metadata),
    manifest:
      /backup-manifest\.json/u.test(source.storage) &&
      /project-export\.json/u.test(source.storage) &&
      /payloadChecksum/u.test(source.storage) &&
      /contentChecksum/u.test(source.storage) &&
      /fsyncSync/u.test(source.storage),
    filesystemTrust:
      /BACKUP_PATH_ESCAPE/u.test(source.storage) &&
      /BACKUP_DIRECTORY_UNTRUSTED/u.test(source.storage) &&
      /BACKUP_FILE_CHECKSUM_MISMATCH/u.test(source.storage),
    restoreAsCopy:
      /restoreBackup/u.test(source.projectService) &&
      /RESTORE_COPY/u.test(source.service) &&
      /sourcePayloadChecksum/u.test(source.service),
    drill:
      /READ_ONLY_DRILL/u.test(source.service) &&
      /BACKUP_NOT_VERIFIED/u.test(source.service) &&
      /status = 'INVALID'/u.test(source.service),
    idempotency:
      /IDEMPOTENCY_PAYLOAD_CONFLICT/u.test(source.service) &&
      /PENDING/u.test(source.service) &&
      /recoverPendingCommands/u.test(source.service),
    audit:
      /PROJECT_BACKUP_CREATED/u.test(source.service) &&
      /PROJECT_BACKUP_RESTORED/u.test(source.projectService),
    verifiedPurgeEvidence:
      /hasVerifiedProjectBackup/u.test(source.projectRepository) &&
      /status = 'VERIFIED'/u.test(source.projectRepository) &&
      /hasVerifiedProjectBackup/u.test(source.projectService),
    routes: [
      "/api/v1/backups",
      "/api/v1/backups/:backupId",
      "/api/v1/projects/:projectId/backups",
      "/api/v1/backups/:backupId/verify",
      "/api/v1/backups/:backupId/restore",
    ].every((route) => source.routes.includes(route)),
    readiness:
      /backupStorage:\s*"ready"/u.test(source.system) &&
      /backupService\.assertReady/u.test(source.system),
    serverBehavior:
      /same Runtime data, Asset, and Published navigation/u.test(
        source.serverTest,
      ) &&
      /stored backup payload is tampered/u.test(source.serverTest) &&
      /hasBackup:\s*true/u.test(source.serverTest),
    webApi:
      /createProjectBackup/u.test(source.webApi) &&
      /verifyProjectBackup/u.test(source.webApi) &&
      /restoreProjectBackup/u.test(source.webApi),
    webUi:
      /휴지통과 독립된 복구 사본/u.test(source.manager) &&
      /backup-row-action/u.test(source.manager) &&
      /backup-restore-actions/u.test(source.manager) &&
      /<BackupManager/u.test(source.projectHome),
    webBehavior:
      /creates, verifies, and restores a durable backup/u.test(
        source.webTest,
      ) &&
      /equal sibling actions/u.test(source.webTest) &&
      /retryable load failure/u.test(source.webTest),
    equalGeometry:
      /\.backup-row-action\s*\{[^}]*height:\s*var\(--control-height\)/su.test(
        source.styles,
      ) &&
      /\.backup-restore-actions\s*>\s*button\s*\{[^}]*width:\s*7rem/su.test(
        source.styles,
      ),
    noClientStorage:
      !/(?:readFile|writeFile|better-sqlite3|\bSELECT\b|\bINSERT\b)/u.test(
        `${source.webApi}\n${source.manager}`,
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

export function inspectPhase17BrowserEvidence(evidence) {
  return {
    metadata:
      evidence?.schemaVersion === 1 &&
      evidence?.result === "PASS" &&
      evidence?.target === "isolated local browser session" &&
      /^http:\/\/127\.0\.0\.1:\d+\/$/u.test(evidence?.url ?? ""),
    desktop:
      evidence?.viewport?.width === 1280 && evidence?.viewport?.height === 720,
    flow:
      evidence?.recovery?.backupStatus === "VERIFIED" &&
      evidence?.recovery?.drillStatus === "PASS" &&
      evidence?.recovery?.restoredAsNewProject === true &&
      evidence?.recovery?.sourceProjectUnchanged === true,
    integrity:
      /^[0-9a-f]{64}$/u.test(evidence?.recovery?.payloadChecksum ?? "") &&
      /^[0-9a-f]{64}$/u.test(evidence?.recovery?.contentChecksum ?? "") &&
      evidence?.recovery?.runtimeSentinelPreserved === true &&
      evidence?.recovery?.assetChecksumPreserved === true,
    lifecycle:
      evidence?.lifecycle?.sourceTrashed === true &&
      evidence?.lifecycle?.backupAvailableAfterTrash === true &&
      evidence?.lifecycle?.purgePlanHasVerifiedBackup === true,
    navigation:
      evidence?.navigation?.backupLeftAligned === true &&
      equalRects(evidence?.navigation?.sidebarRects, 5),
    geometry:
      equalRects(evidence?.geometry?.rowActionRects, 2) &&
      equalRects(evidence?.geometry?.restoreActionRects, 2),
    mobile:
      evidence?.responsive419?.viewportWidth === 419 &&
      evidence?.responsive419?.documentScrollWidth === 419 &&
      evidence?.responsive419?.backupReachable === true &&
      evidence?.responsive419?.tableOwnsHorizontalOverflow === true &&
      evidence?.responsive419?.siblingGeometryPreserved === true,
    clean:
      evidence?.consoleErrorCount === 0 && evidence?.failedRequestCount === 0,
  };
}

export async function validatePhase17({
  repositoryRoot = REPOSITORY_ROOT,
  includeBrowserEvidence = true,
  includePhase16Regression = true,
  includeGovernance = true,
} = {}) {
  const validation = new Validation("Phase 17 Backup, Export/Import, Recovery");
  const source = await sources(repositoryRoot);
  const inspection = inspectPhase17Contract(source);
  for (const [name, value] of Object.entries(inspection)) {
    validation.check(value === true, `Phase 17 contract failed: ${name}`);
  }

  let browserInspection = {};
  if (includeBrowserEvidence) {
    try {
      browserInspection = inspectPhase17BrowserEvidence(
        JSON.parse(
          await readFile(
            resolve(repositoryRoot, PHASE17_BROWSER_EVIDENCE_PATH),
            "utf8",
          ),
        ),
      );
      for (const [name, value] of Object.entries(browserInspection)) {
        validation.check(value === true, `Phase 17 browser failed: ${name}`);
      }
    } catch (error) {
      validation.check(false, "Phase 17 browser evidence is missing", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (includeGovernance) {
    const requirements = JSON.parse(source.traceability).requirements;
    const purge = requirements.find(({ id }) => id === "REQ-035");
    const recovery = requirements.find(({ id }) => id === "REQ-036");
    for (const requirement of [purge, recovery]) {
      validation.check(
        requirement?.status === "VERIFIED" &&
          requirement.tests.includes("scripts/verify-phase17.mjs") &&
          requirement.evidence.includes(PHASE17_EVIDENCE_PATH) &&
          requirement.evidence.includes(PHASE17_BROWSER_EVIDENCE_PATH),
        `Phase 17 traceability is incomplete for ${requirement?.id ?? "unknown"}`,
      );
    }
    validation.check(
      /### PHASE 17 — Backup, Export\/Import, Recovery/u.test(source.status) &&
        /State: `VERIFIED`/u.test(source.status) &&
        /## Phase 17 evidence/u.test(source.status) &&
        source.status.includes(PHASE17_EVIDENCE_PATH) &&
        source.status.includes(PHASE17_BROWSER_EVIDENCE_PATH),
      "Phase 17 implementation status is incomplete",
    );
  }

  let phase16Regression = "NOT_RUN";
  if (includePhase16Regression) {
    const previous = await validatePhase16({
      repositoryRoot,
      includeBrowserEvidence: false,
      includePhase15Regression: false,
      includeGovernance: false,
    });
    phase16Regression = previous.result;
    validation.check(
      previous.result === "PASS",
      "Phase 16 regression must remain green",
      { failures: previous.failures },
    );
  }

  return validation.result({
    inspection,
    browserInspection,
    phase16Regression,
    browserEvidencePath: PHASE17_BROWSER_EVIDENCE_PATH,
  });
}

if (isMainModule(import.meta.url)) {
  try {
    await finishVerification(PHASE17_EVIDENCE_PATH, await validatePhase17());
  } catch (error) {
    await finishVerification(
      PHASE17_EVIDENCE_PATH,
      unexpectedFailure("Phase 17 Backup, Export/Import, Recovery", error),
    );
  }
}
