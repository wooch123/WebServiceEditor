import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  inspectWindowsDeployment,
  validatePhase22,
} from "../../scripts/verify-phase22.mjs";

function validSource() {
  return {
    adr: "Status: accepted 127.0.0.1:3210 Cloudflare Tunnel SQLite online backup API",
    service:
      "<id>WebEditor</id><startmode>Automatic</startmode><delayedAutoStart>true</delayedAutoStart>" +
      '<onfailure action="restart"/><onfailure action="restart"/><onfailure action="restart"/>',
    syntax:
      'Language.Parser]::ParseFile parseErrorCount = 0 $scripts.Count -ne 8 script inventory is not exact Get-FileHash result = "PASS" evidenceComplete = $true',
    build:
      "pnpm build deploy --prod --legacy release-manifest.json Get-FileHash WinSWPath CloudflaredPath Test-WebEditorScripts.ps1 OutputRoot must not already exist schemaVersion = 2 metadata-version-cli.js --operation=supported metadataSchemaVersion sourceTreeClean Could not inspect the release source tree releaseId Release payload contains a symbolic link or reparse point FileAttributes]::ReparsePoint",
    install:
      'schemaVersion -ne 2 sourceTreeClean -ne $true Release checksum mismatch path escapes InstallRoot unmanifested or missing file empty or duplicate path external binary checksum mismatch Release payload contains a symbolic link or reparse point FileAttributes]::ReparsePoint WEBEDITOR_AUTH_REQUIRED=true WEBEDITOR_SECURE_COOKIES=true ProtectedData]::Protect DataProtectionScope]::LocalMachine icacls.exe S-1-5-18 Could not secure the WebEditor data directory cloudflared\\cloudflared.exe") service install sc.exe config cloudflared start= delayed-auto depend= WebEditor WebEditor-DailyBackup New-ScheduledTaskTrigger -Daily WebEditor-WeeklyRestoreDrill New-ScheduledTaskTrigger -Weekly',
    start:
      "ProtectedData]::Unprotect DataProtectionScope]::LocalMachine WEBEDITOR_ADMIN_PASSWORD",
    backup:
      '--operation=create --operation=verify Stop-Service -Name "cloudflared" Stop-Service -Name "WebEditor" WebEditor did not recover after the scheduled backup',
    drill: "--operation=restore-drill liveDataChanged = $false",
    rollback:
      "Rollback release must be separate from InstallRoot Rollback release must differ from the installed release Rollback release checksum mismatch Rollback release contains a symbolic link or reparse point FileAttributes]::ReparsePoint Pre-rollback backup is not verified Rollback release metadata compatibility check failed Move-Item -LiteralPath $installFull -Destination $previousInstallRoot Move-Item -LiteralPath $previousInstallRoot -Destination $installFull $currentMoved = $true $candidateActivated -and rollback-report.json rollbackVerified = $true",
    test: "Get-NetTCPConnection origin is not loopback-only ServicesDependedOn startupOrdered RequireRebootEvidence LastBootUpTime rebootVerified PENDING_REBOOT evidenceComplete = [bool]$RequireRebootEvidence api/v1/health api/v1/ready Public origin is not HTTPS windows-https-report.json dataAclRestricted tasksRunAsSystem recovery task is disabled or does not run as SYSTEM",
    readme:
      "official WinSW release official Cloudflare release Reboot Windows once -RequireRebootEvidence",
    config: 'SERVER_HOST = "127.0.0.1"',
    app: "host: SERVER_HOST",
    offline:
      "async function copyLiveDirectory await database.backup(destinationPath) quick_check mkdtemp contentChecksum",
    offlineTest: "captures committed WAL rows through SQLite online backup",
    metadataVersion:
      "readonly: true fileMustExist: true application_id quick_check LATEST_METADATA_SCHEMA_VERSION",
    metadataVersionTest: "rejects a database owned by another application",
  };
}

describe("Phase 22 validation contract", () => {
  it("accepts the complete Windows production boundary", () => {
    assert.ok(
      Object.values(inspectWindowsDeployment(validSource())).every(Boolean),
    );
  });

  it("rejects a non-loopback origin", () => {
    const source = validSource();
    source.config = 'SERVER_HOST = "0.0.0.0"';
    assert.equal(inspectWindowsDeployment(source).localOriginOnly, false);
  });

  it("rejects deployment evidence without reboot proof", () => {
    const source = validSource();
    source.test = source.test.replace("LastBootUpTime", "installedAt");
    assert.equal(inspectWindowsDeployment(source).rebootGate, false);
  });

  it("rejects backup code that copies live SQLite as an ordinary file", () => {
    const source = validSource();
    source.offline = source.offline.replace(
      "await database.backup(destinationPath)",
      "await copyFile(sourcePath, destinationPath)",
    );
    assert.equal(
      inspectWindowsDeployment(source).onlineConsistentBackup,
      false,
    );
  });

  it("rejects a release installer without exact payload and binary checks", () => {
    const source = validSource();
    source.install = source.install.replace(
      "external binary checksum mismatch",
      "external binary accepted",
    );
    assert.equal(inspectWindowsDeployment(source).releaseFailClosed, false);
  });

  it("rejects release trees that can escape through a reparse point", () => {
    const source = validSource();
    source.rollback = source.rollback.replace(
      "FileAttributes]::ReparsePoint",
      "link accepted",
    );
    assert.equal(
      inspectWindowsDeployment(source).releaseNoReparsePoints,
      false,
    );
  });

  it("rejects a build that does not parse every PowerShell script", () => {
    const source = validSource();
    source.syntax = source.syntax.replace(
      "parseErrorCount = 0",
      "errors ignored",
    );
    assert.equal(inspectWindowsDeployment(source).powershellSyntaxGate, false);
  });

  it("rejects deployment checks that omit data ACL and SYSTEM task proof", () => {
    const source = validSource();
    source.test = source.test.replace("dataAclRestricted", "dataAclUnknown");
    assert.equal(inspectWindowsDeployment(source).securedAuthentication, false);
    source.test = validSource().test.replace("tasksRunAsSystem", "taskOwner");
    assert.equal(inspectWindowsDeployment(source).scheduledRecovery, false);
  });

  it("rejects rollback code that can erase the failed release", () => {
    const source = validSource();
    source.rollback += " Remove-Item";
    assert.equal(inspectWindowsDeployment(source).rollbackFailClosed, false);
  });

  it("passes the repository implementation before Windows operational evidence", async () => {
    const report = await validatePhase22({
      includeOperationalEvidence: false,
      includePhase21Regression: false,
    });
    assert.equal(report.result, "PASS", JSON.stringify(report.failures));
  });
});
