import {
  Validation,
  finishVerification,
  isMainModule,
  pathExists,
  readJson,
  readRepositoryFile,
  sha256,
  unexpectedFailure,
} from "./lib/verification.mjs";
import { validatePhase21 } from "./verify-phase21.mjs";

export const PHASE22_EVIDENCE_PATH =
  "artifacts/phase22/windows-production-deployment-validation.json";
export const WINDOWS_DEPLOYMENT_REPORT =
  "reports/deployment/windows-https-report.json";
export const WINDOWS_RECOVERY_REPORT =
  "reports/recovery/backup-restore-report.json";
export const POWERSHELL_SYNTAX_REPORT =
  "artifacts/phase22/powershell-syntax-validation.json";

const FILES = {
  adr: "docs/adr/0022-windows-production-deployment.md",
  service: "deployment/windows/webeditor-service.xml",
  syntax: "deployment/windows/Test-WebEditorScripts.ps1",
  build: "deployment/windows/Build-WebEditorRelease.ps1",
  install: "deployment/windows/Install-WebEditor.ps1",
  start: "deployment/windows/Start-WebEditor.ps1",
  backup: "deployment/windows/Backup-WebEditor.ps1",
  drill: "deployment/windows/RestoreDrill-WebEditor.ps1",
  rollback: "deployment/windows/Rollback-WebEditorRelease.ps1",
  test: "deployment/windows/Test-WebEditorDeployment.ps1",
  readme: "deployment/windows/README.md",
  config: "apps/server/src/config.ts",
  app: "apps/server/src/main.ts",
  offline: "apps/server/src/deployment/offline-backup.ts",
  offlineTest: "apps/server/test/unit/offline-backup.test.ts",
  metadataVersion: "apps/server/src/deployment/metadata-version.ts",
  metadataVersionTest: "apps/server/test/unit/metadata-version.test.ts",
  rootPackage: "package.json",
  traceability: "docs/requirement-traceability.json",
  status: "docs/implementation-status.md",
};

async function text(path) {
  return (await readRepositoryFile(path)).toString("utf8");
}

export function inspectWindowsDeployment(source) {
  return {
    acceptedArchitecture:
      /Status:\s*accepted/u.test(source.adr) &&
      /127\.0\.0\.1:3210/u.test(source.adr) &&
      /Cloudflare Tunnel/u.test(source.adr) &&
      /SQLite online backup API/u.test(source.adr),
    automaticOriginService:
      /<id>WebEditor<\/id>/u.test(source.service) &&
      /<startmode>Automatic<\/startmode>/u.test(source.service) &&
      /<delayedAutoStart>true<\/delayedAutoStart>/u.test(source.service) &&
      (source.service.match(/<onfailure action="restart"/gu)?.length ?? 0) >= 3,
    productionRelease:
      /pnpm build/u.test(source.build) &&
      /deploy --prod --legacy/u.test(source.build) &&
      /release-manifest\.json/u.test(source.build) &&
      /Get-FileHash/u.test(source.build) &&
      /WinSWPath/u.test(source.build) &&
      /CloudflaredPath/u.test(source.build) &&
      /Test-WebEditorScripts\.ps1/u.test(source.build),
    powershellSyntaxGate:
      /Language\.Parser\]::ParseFile/u.test(source.syntax) &&
      /parseErrorCount = 0/u.test(source.syntax) &&
      /scripts\.Count -ne 8/u.test(source.syntax) &&
      /script inventory is not exact/u.test(source.syntax) &&
      /Get-FileHash/u.test(source.syntax) &&
      /result = "PASS"/u.test(source.syntax) &&
      /evidenceComplete = \$true/u.test(source.syntax),
    releaseFailClosed:
      /OutputRoot must not already exist/u.test(source.build) &&
      /Release checksum mismatch/u.test(source.install) &&
      /path escapes InstallRoot/u.test(source.install) &&
      /unmanifested or missing file/u.test(source.install) &&
      /empty or duplicate path/u.test(source.install) &&
      /external binary checksum mismatch/u.test(source.install),
    releaseNoReparsePoints:
      /Release payload contains a symbolic link or reparse point/u.test(
        source.build,
      ) &&
      /Release payload contains a symbolic link or reparse point/u.test(
        source.install,
      ) &&
      /Rollback release contains a symbolic link or reparse point/u.test(
        source.rollback,
      ) &&
      /FileAttributes\]::ReparsePoint/u.test(source.build) &&
      /FileAttributes\]::ReparsePoint/u.test(source.install) &&
      /FileAttributes\]::ReparsePoint/u.test(source.rollback),
    releaseSchemaBound:
      /schemaVersion = 2/u.test(source.build) &&
      /metadata-version-cli\.js/u.test(source.build) &&
      /--operation=supported/u.test(source.build) &&
      /metadataSchemaVersion/u.test(source.build) &&
      /sourceTreeClean/u.test(source.build) &&
      /Could not inspect the release source tree/u.test(source.build) &&
      /releaseId/u.test(source.build) &&
      /schemaVersion -ne 2/u.test(source.install) &&
      /sourceTreeClean -ne \$true/u.test(source.install),
    localOriginOnly:
      /SERVER_HOST = "127\.0\.0\.1"/u.test(source.config) &&
      /host: SERVER_HOST/u.test(source.app) &&
      /Get-NetTCPConnection/u.test(source.test) &&
      /origin is not loopback-only/u.test(source.test),
    securedAuthentication:
      /WEBEDITOR_AUTH_REQUIRED=true/u.test(source.install) &&
      /WEBEDITOR_SECURE_COOKIES=true/u.test(source.install) &&
      /ProtectedData\]::Protect/u.test(source.install) &&
      /DataProtectionScope\]::LocalMachine/u.test(source.install) &&
      /ProtectedData\]::Unprotect/u.test(source.start) &&
      /WEBEDITOR_ADMIN_PASSWORD/u.test(source.start) &&
      /icacls\.exe/u.test(source.install) &&
      /S-1-5-18/u.test(source.install) &&
      /Could not secure the WebEditor data directory/u.test(source.install) &&
      /dataAclRestricted/u.test(source.test) &&
      !/WEBEDITOR_ADMIN_PASSWORD=/u.test(source.install),
    tunnelServiceOrdered:
      /cloudflared\\cloudflared\.exe"\) service install/u.test(
        source.install,
      ) &&
      /sc\.exe config cloudflared start= delayed-auto depend= WebEditor/u.test(
        source.install,
      ) &&
      /ServicesDependedOn/u.test(source.test) &&
      /startupOrdered/u.test(source.test),
    scheduledRecovery:
      /WebEditor-DailyBackup/u.test(source.install) &&
      /New-ScheduledTaskTrigger -Daily/u.test(source.install) &&
      /WebEditor-WeeklyRestoreDrill/u.test(source.install) &&
      /New-ScheduledTaskTrigger -Weekly/u.test(source.install) &&
      /--operation=create/u.test(source.backup) &&
      /--operation=verify/u.test(source.backup) &&
      /--operation=restore-drill/u.test(source.drill) &&
      /Stop-Service -Name "cloudflared"/u.test(source.backup) &&
      /Stop-Service -Name "WebEditor"/u.test(source.backup) &&
      /WebEditor did not recover after the scheduled backup/u.test(
        source.backup,
      ) &&
      /tasksRunAsSystem/u.test(source.test) &&
      /recovery task is disabled or does not run as SYSTEM/u.test(source.test),
    onlineConsistentBackup:
      /async function copyLiveDirectory/u.test(source.offline) &&
      /await database\.backup\(destinationPath\)/u.test(source.offline) &&
      /quick_check/u.test(source.offline) &&
      /captures committed WAL rows through SQLite online backup/u.test(
        source.offlineTest,
      ),
    immutableRestoreDrill:
      /mkdtemp/u.test(source.offline) &&
      /contentChecksum/u.test(source.offline) &&
      /liveDataChanged = \$false/u.test(source.drill),
    metadataCompatibility:
      /readonly: true/u.test(source.metadataVersion) &&
      /fileMustExist: true/u.test(source.metadataVersion) &&
      /application_id/u.test(source.metadataVersion) &&
      /quick_check/u.test(source.metadataVersion) &&
      /LATEST_METADATA_SCHEMA_VERSION/u.test(source.metadataVersion) &&
      /rejects a database owned by another application/u.test(
        source.metadataVersionTest,
      ),
    rollbackFailClosed:
      /Rollback release must be separate from InstallRoot/u.test(
        source.rollback,
      ) &&
      /Rollback release must differ from the installed release/u.test(
        source.rollback,
      ) &&
      /Rollback release checksum mismatch/u.test(source.rollback) &&
      /Pre-rollback backup is not verified/u.test(source.rollback) &&
      /Rollback release metadata compatibility check failed/u.test(
        source.rollback,
      ) &&
      /Move-Item -LiteralPath \$installFull -Destination \$previousInstallRoot/u.test(
        source.rollback,
      ) &&
      /Move-Item -LiteralPath \$previousInstallRoot -Destination \$installFull/u.test(
        source.rollback,
      ) &&
      /\$currentMoved = \$true/u.test(source.rollback) &&
      /\$candidateActivated -and/u.test(source.rollback) &&
      /rollback-report\.json/u.test(source.rollback) &&
      /rollbackVerified = \$true/u.test(source.rollback) &&
      !/Remove-Item/iu.test(source.rollback),
    rebootGate:
      /RequireRebootEvidence/u.test(source.test) &&
      /LastBootUpTime/u.test(source.test) &&
      /rebootVerified/u.test(source.test) &&
      /PENDING_REBOOT/u.test(source.test) &&
      /evidenceComplete = \[bool\]\$RequireRebootEvidence/u.test(source.test),
    healthReadyHttps:
      /api\/v1\/health/u.test(source.test) &&
      /api\/v1\/ready/u.test(source.test) &&
      /Public origin is not HTTPS/u.test(source.test) &&
      /windows-https-report\.json/u.test(source.test),
    operatorInstructions:
      /official WinSW release/u.test(source.readme) &&
      /official Cloudflare release/u.test(source.readme) &&
      /Reboot Windows once/u.test(source.readme) &&
      /-RequireRebootEvidence/u.test(source.readme),
  };
}

function inspectOperationalEvidence(deployment, recovery) {
  return {
    envelope:
      deployment?.schemaVersion === 1 &&
      deployment?.result === "PASS" &&
      deployment?.evidenceComplete === true,
    loopback:
      deployment?.origin?.host === "127.0.0.1" &&
      deployment?.origin?.port === 3210 &&
      deployment?.origin?.loopbackOnly === true,
    health:
      deployment?.origin?.health === "ok" &&
      deployment?.origin?.ready === "ready",
    services:
      deployment?.services?.webeditor?.state === "Running" &&
      deployment?.services?.webeditor?.startMode === "Auto" &&
      deployment?.services?.cloudflared?.state === "Running" &&
      deployment?.services?.cloudflared?.startMode === "Auto" &&
      deployment?.services?.startupOrdered === true,
    security: deployment?.security?.dataAclRestricted === true,
    https:
      deployment?.https?.status === "ok" &&
      deployment?.https?.hostname === "webeditor.dove9999.com" &&
      deployment?.publicOrigin === "https://webeditor.dove9999.com",
    reboot: deployment?.rebootVerified === true,
    recovery:
      recovery?.schemaVersion === 1 &&
      recovery?.result === "PASS" &&
      recovery?.evidenceComplete === true &&
      recovery?.backup?.result === "PASS" &&
      recovery?.restoreDrill?.result === "PASS" &&
      deployment?.recovery?.backupStatus === "PASS" &&
      deployment?.recovery?.restoreDrillStatus === "PASS" &&
      deployment?.recovery?.tasksRunAsSystem === true &&
      deployment?.recovery?.dailyTaskState !== "Disabled" &&
      deployment?.recovery?.weeklyDrillTaskState !== "Disabled",
  };
}

export async function validatePhase22({
  includeOperationalEvidence = true,
  includePhase21Regression = true,
} = {}) {
  const validation = new Validation("Phase 22 Windows Production Deployment");
  const source = Object.fromEntries(
    await Promise.all(
      Object.entries(FILES).map(async ([key, path]) => [key, await text(path)]),
    ),
  );
  const inspection = inspectWindowsDeployment(source);
  for (const [name, passed] of Object.entries(inspection)) {
    validation.equal(passed, true, `Windows deployment contract: ${name}`);
  }

  const syntaxEvidenceExists = await pathExists(POWERSHELL_SYNTAX_REPORT);
  validation.check(syntaxEvidenceExists, "PowerShell parser evidence exists");
  if (syntaxEvidenceExists) {
    const syntaxEvidence = await readJson(POWERSHELL_SYNTAX_REPORT);
    const expectedScriptChecksums = {
      "Backup-WebEditor.ps1": sha256(source.backup),
      "Build-WebEditorRelease.ps1": sha256(source.build),
      "Install-WebEditor.ps1": sha256(source.install),
      "RestoreDrill-WebEditor.ps1": sha256(source.drill),
      "Rollback-WebEditorRelease.ps1": sha256(source.rollback),
      "Start-WebEditor.ps1": sha256(source.start),
      "Test-WebEditorDeployment.ps1": sha256(source.test),
      "Test-WebEditorScripts.ps1": sha256(source.syntax),
    };
    validation.equal(
      syntaxEvidence.result,
      "PASS",
      "PowerShell parser evidence passes",
    );
    validation.equal(
      syntaxEvidence.evidenceComplete,
      true,
      "PowerShell parser evidence is complete",
    );
    validation.check(
      typeof syntaxEvidence.powershellVersion === "string" &&
        syntaxEvidence.powershellVersion.length > 0,
      "PowerShell parser evidence identifies its runtime",
    );
    validation.check(
      Number.isInteger(syntaxEvidence.scriptCount) &&
        syntaxEvidence.scriptCount >= 8 &&
        syntaxEvidence.scripts?.length === syntaxEvidence.scriptCount &&
        syntaxEvidence.scripts.every(
          ({ sha256: checksum, parseErrorCount }) =>
            /^[a-f0-9]{64}$/u.test(checksum) && parseErrorCount === 0,
        ),
      "Every Windows deployment script parses without error",
    );
    validation.equal(
      syntaxEvidence.scripts?.length,
      Object.keys(expectedScriptChecksums).length,
      "PowerShell parser evidence covers the exact script inventory",
    );
    for (const [name, checksum] of Object.entries(expectedScriptChecksums)) {
      validation.equal(
        syntaxEvidence.scripts?.find((record) => record.name === name)?.sha256,
        checksum,
        `PowerShell parser checksum matches ${name}`,
      );
    }
  }

  const rootPackage = JSON.parse(source.rootPackage);
  validation.equal(
    rootPackage.scripts?.["verify:phase22"],
    "pnpm test && node scripts/verify-phase22.mjs",
    "root exposes the Phase 22 verification gate",
  );
  const traceability = JSON.parse(source.traceability);
  const requirement = traceability.requirements?.find(
    ({ id }) => id === "REQ-019",
  );
  validation.check(
    requirement?.implementation?.includes(
      "deployment/windows/Install-WebEditor.ps1",
    ),
    "REQ-019 references Windows installation",
  );
  validation.check(
    requirement?.tests?.includes("scripts/verify-phase22.mjs"),
    "REQ-019 references the Phase 22 verifier",
  );
  validation.check(
    requirement?.evidence?.includes(WINDOWS_DEPLOYMENT_REPORT),
    "REQ-019 references Windows deployment evidence",
  );
  validation.check(
    /PHASE 22 — Local Windows Production Deployment/u.test(source.status) &&
      /State: `IMPLEMENTED`/u.test(source.status),
    "implementation status tracks Phase 22 as implemented without operational evidence",
  );

  if (includePhase21Regression) {
    const phase21 = await validatePhase21({ includePhase20Regression: false });
    validation.equal(
      phase21.result,
      "PASS",
      "Phase 21 operational verification remains valid",
    );
  }

  let operational = null;
  if (includeOperationalEvidence) {
    const hasDeployment = await pathExists(WINDOWS_DEPLOYMENT_REPORT);
    const hasRecovery = await pathExists(WINDOWS_RECOVERY_REPORT);
    validation.equal(hasDeployment, true, "Windows reboot/HTTPS report exists");
    validation.equal(hasRecovery, true, "Windows backup/restore report exists");
    if (hasDeployment && hasRecovery) {
      operational = inspectOperationalEvidence(
        await readJson(WINDOWS_DEPLOYMENT_REPORT),
        await readJson(WINDOWS_RECOVERY_REPORT),
      );
      for (const [name, passed] of Object.entries(operational)) {
        validation.equal(passed, true, `Windows operational evidence: ${name}`);
      }
    }
  }

  return validation.result({
    implementation: inspection,
    operational,
    deploymentReport: WINDOWS_DEPLOYMENT_REPORT,
    recoveryReport: WINDOWS_RECOVERY_REPORT,
  });
}

async function main() {
  try {
    await finishVerification(PHASE22_EVIDENCE_PATH, await validatePhase22());
  } catch (error) {
    await finishVerification(
      PHASE22_EVIDENCE_PATH,
      unexpectedFailure("Phase 22 Windows Production Deployment", error),
    );
  }
}

if (isMainModule(import.meta.url)) await main();
